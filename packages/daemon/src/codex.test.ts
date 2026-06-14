import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseCodexUsage } from "./codex.js";

test("parseCodexUsage reads the last token_count rate_limits (5h + weekly)", () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-hud-codex-"));
  const f = join(dir, "rollout.jsonl");
  const lines = [
    JSON.stringify({ type: "session_meta", payload: { id: "x" } }),
    // an earlier, stale token_count
    JSON.stringify({ type: "event_msg", payload: { type: "token_count", rate_limits: { primary: { used_percent: 5, window_minutes: 300, resets_at: 111 }, secondary: { used_percent: 1, window_minutes: 10080, resets_at: 222 } } } }),
    // the latest one — this is what we want
    JSON.stringify({ type: "event_msg", payload: { type: "token_count", rate_limits: { primary: { used_percent: 22, window_minutes: 300, resets_at: 1781482321 }, secondary: { used_percent: 19, window_minutes: 10080, resets_at: 1781790828 } } } }),
    JSON.stringify({ type: "event_msg", payload: { type: "task_complete" } }),
  ];
  writeFileSync(f, lines.join("\n") + "\n");

  const u = parseCodexUsage(f);
  assert.ok(u, "parsed usage");
  assert.equal(u!.source, "codex");
  assert.equal(u!.session?.usedPercent, 22);
  assert.equal(u!.session?.resetsAt, 1781482321);
  assert.equal(u!.weekly?.usedPercent, 19);
  assert.equal(u!.weekly?.resetsAt, 1781790828);
  rmSync(dir, { recursive: true, force: true });
});

test("parseCodexUsage returns null when no rate_limits present", () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-hud-codex-"));
  const f = join(dir, "rollout.jsonl");
  writeFileSync(f, JSON.stringify({ type: "session_meta", payload: { id: "x" } }) + "\n");
  assert.equal(parseCodexUsage(f), null);
  rmSync(dir, { recursive: true, force: true });
});
