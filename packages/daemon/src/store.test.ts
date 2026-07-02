import { test } from "node:test";
import assert from "node:assert/strict";
import { store, demoteStaleRunning } from "./store.js";
import type { Session } from "./types.js";

const get = (id: string) => store.getState().sessions.find((s) => s.sessionId === id);

test("setSessionName only enriches EXISTING sessions, never creates one", () => {
  store.setSessionName("ghost", "Some task", "/tmp/p");
  assert.equal(get("ghost"), undefined, "statusLine must not invent a session");

  store.upsertSession("real", "/tmp/proj", "running");
  store.setSessionName("real", "Review vision.md", "/tmp/proj");
  assert.equal(get("real")?.name, "Review vision.md");
  assert.equal(get("real")?.status, "running", "name must not change status");
});

test("question attention sets and clears, scoped to its own reason", () => {
  store.upsertSession("q1", "/tmp/p", "running");
  store.setQuestionAttention("q1", true, "Claude is asking a question");
  assert.equal(get("q1")?.status, "waiting");
  assert.equal(get("q1")?.attentionReason, "question");

  store.setQuestionAttention("q1", false, "");
  assert.equal(get("q1")?.status, "running");
});

test("scanner must NOT clear a permission (notification) waiting", () => {
  store.upsertSession("q2", "/tmp/p", "waiting", { lastMessage: "permission" }); // notification-driven
  store.setQuestionAttention("q2", false, "");
  assert.equal(get("q2")?.status, "waiting", "permission waiting is left alone");
});

test("liveness: a session with a dead claude PID is pruned, a live one is kept", () => {
  // process.pid is definitely alive; 999999 is above macOS's max PID → dead.
  store.upsertSession("alive", "/tmp/p", "running", { agentPid: process.pid });
  store.upsertSession("dead", "/tmp/p", "running", { agentPid: 999999 });
  store.pruneDeadSessions();
  assert.ok(get("alive"), "session with a live claude process is kept");
  assert.equal(get("dead"), undefined, "session with a dead claude process is pruned");
});

test("acknowledge demotes ready → idle (click-driven, not time-driven)", () => {
  store.upsertSession("r1", "/tmp/p", "ready");
  store.acknowledgeSession("r1");
  assert.equal(get("r1")?.status, "idle", "clicking a ready session marks it idle");
});

test("acknowledge does not touch non-ready sessions", () => {
  store.upsertSession("r2", "/tmp/p", "waiting", { lastMessage: "permission" });
  store.acknowledgeSession("r2");
  assert.equal(get("r2")?.status, "waiting", "waiting still needs a real response");
  store.upsertSession("r3", "/tmp/p", "running");
  store.acknowledgeSession("r3");
  assert.equal(get("r3")?.status, "running");
});

test("setUnread toggles the follow-up flag and survives non-running updates", () => {
  store.upsertSession("u1", "/tmp/p", "ready");
  store.setUnread("u1"); // toggle on
  assert.equal(get("u1")?.unread, true, "toggled on");
  // A non-running update (e.g. acknowledge → idle) keeps the flag.
  store.acknowledgeSession("u1");
  assert.equal(get("u1")?.status, "idle");
  assert.equal(get("u1")?.unread, true, "unread persists through idle");
  store.setUnread("u1"); // toggle off
  assert.equal(get("u1")?.unread, false, "toggled off");
});

test("unread auto-clears when the session goes running (re-engaged)", () => {
  store.upsertSession("u2", "/tmp/p", "ready");
  store.setUnread("u2", true);
  assert.equal(get("u2")?.unread, true);
  store.upsertSession("u2", "/tmp/p", "running");
  assert.equal(get("u2")?.unread, false, "running clears the follow-up flag");
});

test("clearing unread on an already-running session still broadcasts", () => {
  // Flag a session that's already running, then a later running upsert clears the
  // flag with NO status change — visiblyEqual must not suppress that broadcast,
  // or the HUD would keep showing a stale flag until an unrelated change.
  store.upsertSession("u3", "/tmp/p", "running");
  store.setUnread("u3", true);
  assert.equal(get("u3")?.unread, true);
  let events = 0;
  const onChange = () => { events++; };
  store.on("change", onChange);
  store.upsertSession("u3", "/tmp/p", "running"); // same status, clears unread
  store.off("change", onChange);
  assert.equal(get("u3")?.unread, false, "flag cleared");
  assert.ok(events > 0, "a change event fired so clients re-render");
});

test("demoteStaleRunning shows a long-silent 'running' session as idle", () => {
  const mk = (status: Session["status"], updatedAt: string): Session => ({
    sessionId: "d1", cwd: "/tmp/p", projectName: "p", agent: "claude-code",
    status, createdAt: updatedAt, updatedAt,
  });
  const cut = 1000; // epoch-ms cutoff
  // running + updated before the cutoff → demoted to idle
  assert.equal(demoteStaleRunning(mk("running", new Date(500).toISOString()), cut).status, "idle");
  // running + updated after the cutoff → stays running
  assert.equal(demoteStaleRunning(mk("running", new Date(1500).toISOString()), cut).status, "running");
  // non-running is never touched, however old
  assert.equal(demoteStaleRunning(mk("waiting", new Date(0).toISOString()), cut).status, "waiting");
  assert.equal(demoteStaleRunning(mk("ready", new Date(0).toISOString()), cut).status, "ready");
});

test("getState returns sessions in canonical (createdAt, sessionId) order", () => {
  // The exact order is a pure function of the snapshot, so every window renders
  // the shared sessions identically regardless of connect time or Map churn.
  const list = store.getState().sessions;
  for (let i = 1; i < list.length; i++) {
    const prev = list[i - 1];
    const cur = list[i];
    const ok =
      prev.createdAt < cur.createdAt ||
      (prev.createdAt === cur.createdAt && prev.sessionId <= cur.sessionId);
    assert.ok(ok, `out of order at ${i}: ${prev.sessionId} before ${cur.sessionId}`);
  }
});

test("createdAt is stamped once and preserved across updates", () => {
  store.upsertSession("ca1", "/tmp/p", "running");
  const first = get("ca1")?.createdAt;
  assert.ok(first, "createdAt set on first upsert");
  store.upsertSession("ca1", "/tmp/p", "waiting", { lastMessage: "x" });
  assert.equal(get("ca1")?.createdAt, first, "createdAt unchanged by later updates");
});
