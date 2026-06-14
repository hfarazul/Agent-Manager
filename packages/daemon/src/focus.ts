import { spawn, execSync } from "node:child_process";
import { existsSync } from "node:fs";

/**
 * Cross-window focus: raise the Cursor/VS Code window that has `folder` open.
 *
 * Each editor window runs its own extension host, so a click in window A can't
 * reach a terminal in window B directly. The owning window reveals its own
 * terminal tab; this raises that window to the foreground. We use the editor's
 * CLI (`cursor <folder>`) rather than AppleScript — opening an already-open
 * folder focuses its existing window, and the CLI needs no Accessibility grant.
 */

let cliPath: string | null | undefined;

function findCli(): string | null {
  if (cliPath !== undefined) return cliPath;
  const candidates: string[] = [];
  try {
    // May be absent from launchd's PATH; the app-bundle paths below are the
    // reliable fallback.
    const found = execSync("command -v cursor || command -v code || true", {
      encoding: "utf8",
    }).trim();
    if (found) candidates.push(...found.split("\n").filter(Boolean));
  } catch {
    /* ignore */
  }
  candidates.push(
    "/Applications/Cursor.app/Contents/Resources/app/bin/cursor",
    "/opt/homebrew/bin/cursor",
    "/usr/local/bin/cursor",
    "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
  );
  cliPath = candidates.find((p) => p && existsSync(p)) ?? null;
  return cliPath;
}

/** Raise the window with `folder` open. Best-effort; returns false if no CLI. */
export function raiseWindow(folder: string): boolean {
  const cli = findCli();
  if (!cli || !folder) return false;
  try {
    // Plain `<cli> <folder>` focuses the existing window for that folder. NOT
    // --reuse-window, which would hijack the currently-active window instead.
    const child = spawn(cli, [folder], { detached: true, stdio: "ignore" });
    child.unref();
    return true;
  } catch {
    return false;
  }
}
