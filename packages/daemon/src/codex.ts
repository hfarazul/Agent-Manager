import { openSync, fstatSync, readSync, closeSync, readFileSync } from "node:fs";
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

/** Read the newest live Codex session's rollout for the latest rate_limits. */
function refreshUsage(): void {
  const codex = store
    .getState()
    .sessions.filter((s) => s.agent === "codex" && s.transcriptPath)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  if (!codex.length) return; // no live Codex session → keep last-known limits

  const usage = parseCodexUsage(codex[0].transcriptPath!);
  if (usage) store.setCodexUsage(usage);
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
        const rl = JSON.parse(line)?.payload?.rate_limits;
        if (rl) return toUsage(rl);
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

function toUsage(rl: any): UsageState {
  const win = (x: any) =>
    x && typeof x.used_percent === "number"
      ? { usedPercent: x.used_percent, resetsAt: typeof x.resets_at === "number" ? x.resets_at : 0 }
      : undefined;
  return {
    session: win(rl.primary), // 5h window
    weekly: win(rl.secondary), // weekly window
    source: "codex",
    updatedAt: new Date().toISOString(),
  };
}
