import { test } from "node:test";
import assert from "node:assert/strict";
import { ingestHook } from "./hooks.js";
import { store } from "./store.js";

const findStatus = (id: string) =>
  store.getState().sessions.find((s) => s.sessionId === id)?.status;

test("SessionStart → running", async () => {
  await ingestHook({ session_id: "s1", hook_event_name: "SessionStart", cwd: "/tmp/p" });
  assert.equal(findStatus("s1"), "running");
});

test("Notification (permission) → waiting", async () => {
  await ingestHook({
    session_id: "s2",
    hook_event_name: "Notification",
    cwd: "/tmp/p",
    message: "Claude needs your permission to run Bash",
  });
  assert.equal(findStatus("s2"), "waiting");
});

test("Notification ('waiting for your input') → ready, not waiting", async () => {
  await ingestHook({
    session_id: "s3",
    hook_event_name: "Notification",
    cwd: "/tmp/p",
    message: "Claude is waiting for your input",
  });
  assert.equal(findStatus("s3"), "ready");
});

test("Stop → ready", async () => {
  await ingestHook({ session_id: "s4", hook_event_name: "SessionStart", cwd: "/tmp/p" });
  await ingestHook({ session_id: "s4", hook_event_name: "Stop", cwd: "/tmp/p" });
  assert.equal(findStatus("s4"), "ready");
});

test("UserPromptSubmit clears a waiting session back to running", async () => {
  await ingestHook({ session_id: "s5", hook_event_name: "Notification", cwd: "/tmp/p", message: "permission" });
  assert.equal(findStatus("s5"), "waiting");
  await ingestHook({ session_id: "s5", hook_event_name: "UserPromptSubmit", cwd: "/tmp/p" });
  assert.equal(findStatus("s5"), "running");
});

test("SessionEnd removes the session", async () => {
  await ingestHook({ session_id: "s6", hook_event_name: "SessionStart", cwd: "/tmp/p" });
  await ingestHook({ session_id: "s6", hook_event_name: "SessionEnd" });
  assert.equal(findStatus("s6"), undefined);
});

test("unknown event is tolerated, leaves status unchanged", async () => {
  await ingestHook({ session_id: "s7", hook_event_name: "SessionStart", cwd: "/tmp/p" });
  const res = await ingestHook({ session_id: "s7", hook_event_name: "FutureUnknownEvent" });
  assert.equal(res.action, "ignored");
  assert.equal(findStatus("s7"), "running");
});

const findSession = (id: string) =>
  store.getState().sessions.find((s) => s.sessionId === id);
const findPids = (id: string) => findSession(id)?.ancestorPids;

test("Codex PermissionRequest → waiting", async () => {
  await ingestHook({ session_id: "c1", hook_event_name: "SessionStart", cwd: "/tmp/p", agent_hud_agent: "codex" });
  await ingestHook({ session_id: "c1", hook_event_name: "PermissionRequest", cwd: "/tmp/p", agent_hud_agent: "codex" });
  assert.equal(findSession("c1")?.status, "waiting");
});

test("agent provenance: agent_hud_agent tags the session", async () => {
  await ingestHook({ session_id: "c2", hook_event_name: "SessionStart", cwd: "/tmp/p", agent_hud_agent: "codex" });
  assert.equal(findSession("c2")?.agent, "codex");
  await ingestHook({ session_id: "c3", hook_event_name: "SessionStart", cwd: "/tmp/p" });
  assert.equal(findSession("c3")?.agent, "claude-code", "defaults to claude-code when unset");
});

test("forwarder's ancestor PIDs are captured and preserved across hooks", async () => {
  await ingestHook({
    session_id: "p1",
    hook_event_name: "SessionStart",
    cwd: "/tmp/p",
    agent_hud_ancestor_pids: [101, 202, 303],
  });
  assert.deepEqual(findPids("p1"), [101, 202, 303]);

  // A later hook without pids must not wipe the chain.
  await ingestHook({ session_id: "p1", hook_event_name: "Stop", cwd: "/tmp/p" });
  assert.deepEqual(findPids("p1"), [101, 202, 303]);
});

test("garbage ancestor_pids shapes are ignored, never throw", async () => {
  await ingestHook({ session_id: "p2", hook_event_name: "SessionStart", cwd: "/tmp/p", agent_hud_ancestor_pids: "nope" });
  assert.equal(findPids("p2"), undefined);
  await ingestHook({ session_id: "p3", hook_event_name: "SessionStart", cwd: "/tmp/p", agent_hud_ancestor_pids: [0, -1, "x", 5] });
  assert.deepEqual(findPids("p3"), [5], "only positive numbers survive");
});

test("malformed / missing-field bodies never throw", async () => {
  await assert.doesNotReject(ingestHook({ garbage: true }));
  await assert.doesNotReject(ingestHook(null));
  await assert.doesNotReject(ingestHook("not an object"));
  const res = await ingestHook({});
  assert.equal(res.ok, false);
  assert.equal(res.action, "ignored");
});
