import { readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { store } from "./store.js";

/**
 * Peer names. Claude Code gives every live session a peer name (e.g.
 * "agent-manager-c1") — the address other sessions use with SendMessage. It is
 * NOT the task name shown in the HUD, which is why handing one session another's
 * task name doesn't work. Claude Code writes it to `~/.claude/sessions/<pid>.json`
 * as `{ sessionId, name, ... }`, and it can change mid-session (rename), so a
 * periodic sweep copies it onto the matching HUD session. Best-effort: missing
 * or half-written files are skipped.
 */

const SESSIONS_DIR = join(homedir(), ".claude", "sessions");
const SWEEP_INTERVAL_MS = 5_000;

let timer: NodeJS.Timeout | null = null;

export function startPeerSweep(): void {
  if (timer) return;
  sweep();
  timer = setInterval(sweep, SWEEP_INTERVAL_MS);
  timer.unref?.();
}

function sweep(): void {
  try {
    const names = readPeerNames(SESSIONS_DIR);
    for (const s of store.getState().sessions) {
      if (s.agent !== "claude-code") continue;
      const peer = names.get(s.sessionId);
      if (peer && s.peerName !== peer) store.setPeerName(s.sessionId, peer);
    }
  } catch {
    /* ignore */
  }
}

/** sessionId → peer name, from every `<pid>.json` in the sessions dir. */
export function readPeerNames(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return out;
  }
  for (const f of files) {
    try {
      const o = JSON.parse(readFileSync(join(dir, f), "utf8"));
      if (typeof o.sessionId === "string" && typeof o.name === "string" && o.name) {
        out.set(o.sessionId, o.name);
      }
    } catch {
      /* skip unreadable / half-written file */
    }
  }
  return out;
}
