import { spawn, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config } from "./config.js";

/** Brand the native banner with the HUD icon. Lives in the daemon package's
 * assets/, resolved relative to the compiled dist/. */
const ICON_PATH = join(dirname(fileURLToPath(import.meta.url)), "../assets/notify-icon.png");
const ICON = existsSync(ICON_PATH) ? ICON_PATH : null;

/**
 * OS notifications (future-features.md §1). Fired from the daemon — the single
 * source of truth for session transitions — so multiple editor windows don't
 * each pop their own copy, and so it works even when the editor is backgrounded.
 *
 * If `terminal-notifier` is present we use it: the notification is CLICKABLE and
 * its action POSTs /focus, which routes through the cross-window focus path
 * (future-features.md §2) to jump straight to the session. Otherwise we fall
 * back to `osascript display notification` (alert + sound only, no click).
 *
 * Best-effort and detached: a missing binary or a notification-permission denial
 * must never disturb the daemon.
 */

let tnPath: string | null | undefined;

function terminalNotifier(): string | null {
  if (tnPath !== undefined) return tnPath;
  const candidates: string[] = [];
  try {
    const found = execSync("command -v terminal-notifier || true", {
      encoding: "utf8",
    }).trim();
    if (found) candidates.push(found);
  } catch {
    /* ignore */
  }
  candidates.push(
    "/opt/homebrew/bin/terminal-notifier",
    "/usr/local/bin/terminal-notifier",
  );
  tnPath = candidates.find((p) => p && existsSync(p)) ?? null;
  return tnPath;
}

export interface HudNotification {
  title: string;
  subtitle?: string;
  message: string;
  /** Session to focus when the notification is clicked. */
  sessionId: string;
  sound?: boolean;
}

export function sendNotification(n: HudNotification): void {
  const tn = terminalNotifier();
  try {
    if (tn) {
      // Click → focus the session via the daemon's cross-window focus path.
      const body = JSON.stringify({ sessionId: n.sessionId });
      const focusCmd =
        `curl -s --max-time 2 -X POST http://127.0.0.1:${config.port}/focus ` +
        `-H 'Content-Type: application/json' -d '${body}'`;
      // NOTE: deliberately NO -group. terminal-notifier's -group SILENTLY
      // replaces a prior notification in the same group (no re-banner, no sound),
      // which would swallow a legitimate re-alert (waiting → answered → waiting).
      // The notifier already fires only on real edge transitions, so each call
      // is a distinct alert that should actually surface.
      const args = [
        "-title", n.title,
        "-message", n.message,
        "-execute", focusCmd,
      ];
      if (ICON) args.push("-appIcon", ICON);
      if (n.subtitle) args.push("-subtitle", n.subtitle);
      spawn(tn, args, { detached: true, stdio: "ignore" }).unref();
    } else {
      const script =
        `display notification ${q(n.message)} with title ${q(n.title)}` +
        (n.subtitle ? ` subtitle ${q(n.subtitle)}` : "");
      spawn("/usr/bin/osascript", ["-e", script], {
        detached: true,
        stdio: "ignore",
      }).unref();
    }
    // Play the sound ourselves — macOS gates terminal-notifier's own sound behind
    // its per-app notification settings, so -sound is unreliable. afplay always
    // works and keeps sound independent of the notification path.
    if (n.sound) playSound();
  } catch {
    /* best-effort — never throw from a notification */
  }
}

function playSound(): void {
  try {
    spawn("/usr/bin/afplay", ["/System/Library/Sounds/Glass.aiff"], {
      detached: true,
      stdio: "ignore",
    }).unref();
  } catch {
    /* no sound — not fatal */
  }
}

/** Quote + escape a string for embedding in an AppleScript literal. */
function q(s: string): string {
  return `"${s.replace(/[\\"]/g, "\\$&")}"`;
}
