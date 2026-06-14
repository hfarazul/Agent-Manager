import { test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { store } from "./store.js";

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

test("ready demotes to idle after the threshold, but not while fresh", async () => {
  store.upsertSession("r1", "/tmp/p", "ready");
  store.demoteReadyToIdle();
  assert.equal(get("r1")?.status, "ready", "fresh ready stays ready");

  await delay(80); // test threshold is 50ms (set in the test script)
  store.demoteReadyToIdle();
  assert.equal(get("r1")?.status, "idle");
});
