import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectWaiting } from "./attention.js";

function transcript(name: string, lines: object[]): string {
  const path = join(tmpdir(), `agent-hud-test-${name}.jsonl`);
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return path;
}

test("detects a dangling AskUserQuestion (no tool_result)", () => {
  const p = transcript("dangling", [
    { type: "assistant", message: { content: [{ type: "tool_use", name: "AskUserQuestion", id: "t1" }] } },
  ]);
  const pending = detectWaiting(p);
  assert.equal(pending?.name, "AskUserQuestion");
  rmSync(p, { force: true });
});

test("answered question (tool_result present) → not waiting", () => {
  const p = transcript("answered", [
    { type: "assistant", message: { content: [{ type: "tool_use", name: "AskUserQuestion", id: "t1" }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1" }] } },
  ]);
  assert.equal(detectWaiting(p), null);
  rmSync(p, { force: true });
});

test("a normal running tool is NOT treated as waiting", () => {
  const p = transcript("running", [
    { type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", id: "b1" }] } },
  ]);
  assert.equal(detectWaiting(p), null);
  rmSync(p, { force: true });
});

test("ExitPlanMode also counts as waiting", () => {
  const p = transcript("plan", [
    { type: "assistant", message: { content: [{ type: "tool_use", name: "ExitPlanMode", id: "e1" }] } },
  ]);
  assert.equal(detectWaiting(p)?.name, "ExitPlanMode");
  rmSync(p, { force: true });
});

test("missing transcript file → null, no throw", () => {
  assert.equal(detectWaiting(join(tmpdir(), "does-not-exist-xyz.jsonl")), null);
});
