import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/**
 * Resolve a session's project/repo name from its cwd.
 *
 * A Claude Code session's cwd is often a SUBFOLDER of the repo (e.g.
 * `…/Agent-Manager/packages/daemon/src`), so `basename(cwd)` would label the
 * group "src". Instead we walk up to the git root and use its name, so every
 * session in a repo groups under the repo no matter which subdirectory it runs
 * in. Falls back to the cwd basename when there's no `.git` (not a repo).
 *
 * Results are cached per cwd — the filesystem walk happens once per unique dir.
 */
const cache = new Map<string, string>();

export function resolveProjectName(cwd: string): string {
  if (!cwd) return "unknown";
  const cached = cache.get(cwd);
  if (cached) return cached;

  let dir = cwd;
  let result = basename(cwd);
  while (true) {
    // `.git` is a dir in a normal clone, a file in a worktree — both count.
    if (existsSync(join(dir, ".git"))) {
      result = basename(dir);
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break; // hit filesystem root → keep basename fallback
    dir = parent;
  }

  cache.set(cwd, result);
  return result;
}
