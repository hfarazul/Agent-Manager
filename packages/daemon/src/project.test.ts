import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveProjectName } from "./project.js";

test("resolves to the git-root name from a nested subfolder", () => {
  const root = mkdtempSync(join(tmpdir(), "agent-hud-repo-"));
  mkdirSync(join(root, ".git"));
  const nested = join(root, "packages", "daemon", "src");
  mkdirSync(nested, { recursive: true });

  // basename would say "src"; we want the repo root's name.
  assert.equal(resolveProjectName(nested), root.split("/").pop());
  assert.equal(resolveProjectName(root), root.split("/").pop());
  rmSync(root, { recursive: true, force: true });
});

test("falls back to cwd basename when there is no .git", () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-hud-norepo-"));
  const sub = join(dir, "loose");
  mkdirSync(sub);
  assert.equal(resolveProjectName(sub), "loose");
  rmSync(dir, { recursive: true, force: true });
});

test("worktree-style .git file also counts as a root", () => {
  const root = mkdtempSync(join(tmpdir(), "agent-hud-wt-"));
  writeFileSync(join(root, ".git"), "gitdir: /somewhere/else\n");
  const sub = join(root, "a", "b");
  mkdirSync(sub, { recursive: true });
  assert.equal(resolveProjectName(sub), root.split("/").pop());
  rmSync(root, { recursive: true, force: true });
});

test("empty cwd → 'unknown'", () => {
  assert.equal(resolveProjectName(""), "unknown");
});
