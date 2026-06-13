import { spawn, type ChildProcess } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { store } from "./store.js";
import type { SleepState } from "./types.js";

const execFileP = promisify(execFile);

/**
 * Sleep control (vision.md §5). Two INDEPENDENT mechanisms:
 *
 *  - idleAwake  : a long-lived `caffeinate -dimsu` child. Kill it to release.
 *                 No privilege required. Blocks idle sleep with the lid OPEN.
 *  - clamshell  : `sudo pmset -a disablesleep 1|0`. Requires root, granted via
 *                 a tightly-scoped sudoers NOPASSWD drop-in. Blocks sleep with
 *                 the lid CLOSED. caffeinate alone does NOT do this.
 */
class SleepController {
  private caffeinate: ChildProcess | null = null;

  /** Reconcile real OS state into the store at startup. */
  async syncFromOs(): Promise<void> {
    const clamshell = await readClamshell();
    store.setSleep({ idleAwake: this.caffeinate !== null, clamshell });
  }

  /** Block/allow idle sleep by spawning/killing the caffeinate child. */
  setIdleAwake(on: boolean): void {
    if (on && !this.caffeinate) {
      // -d display, -i idle, -m disk, -s system, -u declare user active.
      // -w <pid>: watch the daemon's own pid and self-exit when it dies. This
      // guarantees no orphaned caffeinate keeps the Mac awake forever if the
      // daemon is SIGKILL'd / crashes (a graceful SIGTERM handler can't cover
      // that case).
      this.caffeinate = spawn(
        "/usr/bin/caffeinate",
        ["-dimsu", "-w", String(process.pid)],
        { stdio: "ignore" },
      );
      this.caffeinate.on("exit", () => {
        // If it dies for any reason, reflect that we're no longer awake.
        this.caffeinate = null;
        store.setSleep({ idleAwake: false });
      });
    } else if (!on && this.caffeinate) {
      this.caffeinate.kill("SIGTERM");
      this.caffeinate = null;
    }
    store.setSleep({ idleAwake: this.caffeinate !== null });
  }

  /**
   * Block/allow clamshell sleep via pmset. Requires the sudoers drop-in from
   * setup/sudoers-agent-hud. Throws if sudo is denied (no password prompt
   * available to a launchd daemon) so the caller can surface a clear error.
   */
  async setClamshell(on: boolean): Promise<void> {
    const value = on ? "1" : "0";
    try {
      await execFileP("/usr/bin/sudo", [
        "-n", // never prompt; fail instead of hanging if sudoers isn't set up
        "/usr/bin/pmset",
        "-a",
        "disablesleep",
        value,
      ]);
    } catch (err) {
      throw new Error(
        `Failed to set clamshell sleep (pmset disablesleep ${value}). ` +
          `Is the sudoers drop-in installed? See setup/sudoers-agent-hud. ` +
          `Original: ${(err as Error).message}`,
      );
    }
    const clamshell = await readClamshell();
    store.setSleep({ clamshell });
  }

  /** Kill the caffeinate child on shutdown so we don't leak it. */
  shutdown(): void {
    if (this.caffeinate) {
      this.caffeinate.kill("SIGTERM");
      this.caffeinate = null;
    }
  }
}

/** Read the OS's current clamshell-disable state from `pmset -g`. */
async function readClamshell(): Promise<boolean> {
  try {
    const { stdout } = await execFileP("/usr/bin/pmset", ["-g"]);
    // Line looks like: " SleepDisabled         1"
    const match = stdout.match(/SleepDisabled\s+(\d)/i);
    return match ? match[1] === "1" : false;
  } catch {
    return false;
  }
}

export const sleepController = new SleepController();
