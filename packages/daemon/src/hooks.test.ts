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

test("malformed / missing-field bodies never throw", async () => {
  await assert.doesNotReject(ingestHook({ garbage: true }));
  await assert.doesNotReject(ingestHook(null));
  await assert.doesNotReject(ingestHook("not an object"));
  const res = await ingestHook({});
  assert.equal(res.ok, false);
  assert.equal(res.action, "ignored");
});
