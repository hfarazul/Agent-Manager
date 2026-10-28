import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readPeerNames } from "./peers.js";

test("readPeerNames maps sessionId → peer name and skips bad files", () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-hud-peers-"));
  writeFileSync(join(dir, "100.json"), JSON.stringify({ pid: 100, sessionId: "s1", name: "agent-manager-c1" }));
  writeFileSync(join(dir, "200.json"), JSON.stringify({ pid: 200, sessionId: "s2" })); // no name yet
  writeFileSync(join(dir, "300.json"), "{ half-written");
  writeFileSync(join(dir, "300.abc.key"), "not json");

  const m = readPeerNames(dir);
  assert.equal(m.get("s1"), "agent-manager-c1");
  assert.equal(m.has("s2"), false);
  assert.equal(m.size, 1);
  rmSync(dir, { recursive: true, force: true });
});

test("readPeerNames returns empty when the dir is missing", () => {
  assert.equal(readPeerNames(join(tmpdir(), "agent-hud-no-such-dir")).size, 0);
});
