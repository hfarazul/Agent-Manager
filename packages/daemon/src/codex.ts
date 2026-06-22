import { openSync, fstatSync, readSync, closeSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { store } from "./store.js";
import type { UsageState } from "./types.js";

/**
 * Codex enrichment. Codex has no statusLine, so two things we need live in its
 * files instead of the hook payloads:
 *
 *  - Session NAME: `~/.codex/session_index.jsonl` maps session id → `thread_name`
 *    (e.g. "review of the Repo"), Codex's own auto-generated title.
 *  - 5h / weekly LIMITS: each session's rollout JSONL carries `token_count`
 *    events whose `rate_limits` hold `primary` (5h) and `secondary` (weekly)
 *    `{ used_percent, resets_at }` — the same shape as Claude's rate_limits.
 *
 * A periodic sweep reads both and pushes them into the store. Best-effort: any
 * missing/locked file is simply skipped.
 */

const INDEX_PATH = join(homedir(), ".codex", "session_index.jsonl");
const TAIL_BYTES = 64 * 1024; // the latest token_count is near the end
const SWEEP_INTERVAL_MS = 10_000;

let timer: NodeJS.Timeout | null = null;

export function startCodexSweep(): void {
  if (timer) return;
  sweep();
  timer = setInterval(sweep, SWEEP_INTERVAL_MS);
  timer.unref?.();
}

/** Run the Codex names+usage sweep immediately (manual "refresh" button). */
export function refreshCodexNow(): void {
  sweep();
}

function sweep(): void {
  try {
    refreshNames();
  } catch {
    /* ignore */
  }
  try {
    refreshUsage();
  } catch {
    /* ignore */
  }
}

/** Set each live Codex session's name from session_index.jsonl's thread_name. */
function refreshNames(): void {
  const codex = store.getState().sessions.filter((s) => s.agent === "codex");
  if (!codex.length) return;

  let raw: string;
  try {
    raw = readFileSync(INDEX_PATH, "utf8");
  } catch {
    return;
  }
  const names = new Map<string, string>();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line);
      if (typeof o.id === "string" && typeof o.thread_name === "string") {
        names.set(o.id, o.thread_name);
      }
    } catch {
      /* skip bad line */
    }
  }
  for (const s of codex) {
    const name = names.get(s.sessionId);
    if (name && s.name !== name) store.setSessionName(s.sessionId, name);
  }
}

/** Read the latest Codex rate_limits. Prefers a live session's rollout; falls
 * back to the newest rollout on disk so the limits are shown (and survive daemon
 * restarts) even when no Codex session is currently running. */
function refreshUsage(): void {
  const live = store
    .getState()
    .sessions.filter((s) => s.agent === "codex" && s.transcriptPath)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

  const path = live.length ? live[0].transcriptPath! : newestRolloutPath();
  if (!path) return; // no Codex usage on this machine → section stays hidden

  const usage = parseCodexUsage(path);
  if (usage) store.setCodexUsage(usage);
}

/** Newest rollout JSONL on disk. Codex stores them under
 * ~/.codex/sessions/<year>/<month>/<day>/rollout-<ISO>-<id>.jsonl, so descend
 * the lexically-greatest year→month→day and take the last file. Returns null if
 * Codex isn't present (so Claude-only users never see an empty Codex section). */
function newestRolloutPath(): string | null {
  const latestDir = (dir: string): string | null => {
    try {
      const subs = readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort();
      return subs.length ? join(dir, subs[subs.length - 1]) : null;
    } catch {
      return null;
    }
  };
  const base = join(homedir(), ".codex", "sessions");
  const year = latestDir(base);
  const month = year && latestDir(year);
  const day = month && latestDir(month);
  if (!day) return null;
  try {
    const files = readdirSync(day)
      .filter((f) => f.startsWith("rollout-") && f.endsWith(".jsonl"))
      .sort();
    return files.length ? join(day, files[files.length - 1]) : null;
  } catch {
    return null;
  }
}

/** Extract 5h/weekly limits from the last token_count event in a rollout. */
export function parseCodexUsage(rolloutPath: string): UsageState | null {
  let fd: number;
  try {
    fd = openSync(rolloutPath, "r");
  } catch {
    return null;
  }
  try {
    const { size } = fstatSync(fd);
    const len = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString("utf8").split("\n");
    if (size > len) lines.shift(); // drop partial first line

    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line.includes("rate_limits")) continue;
      try {
        const obj = JSON.parse(line);
        const rl = obj?.payload?.rate_limits;
        // Use the rollout entry's own timestamp so "updated" reflects when Codex
        // actually recorded these limits, not when our sweep happened to read it.
        if (rl) return toUsage(rl, typeof obj.timestamp === "string" ? obj.timestamp : undefined);
      } catch {
        /* keep scanning upward */
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

function toUsage(rl: any, at?: string): UsageState {
  const win = (x: any) =>
    x && typeof x.used_percent === "number"
      ? { usedPercent: x.used_percent, resetsAt: typeof x.resets_at === "number" ? x.resets_at : 0 }
      : undefined;
  return {
    session: win(rl.primary), // 5h window
    weekly: win(rl.secondary), // weekly window
    source: "codex",
    updatedAt: at ?? new Date().toISOString(),
  };
}
