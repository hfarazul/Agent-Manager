import { openSync, fstatSync, readSync, closeSync } from "node:fs";
import { store } from "./store.js";

/**
 * AskUserQuestion attention scanner (vision.md §7 fallback).
 *
 * AskUserQuestion / ExitPlanMode prompts fire NO hook — Claude Code treats them
 * as a tool call in flight — so the hook pipeline can't see those waits. We
 * close that gap by tailing each session's transcript JSONL and detecting a
 * "dangling" question tool_use: one with no matching tool_result yet.
 *
 * A plain running tool (e.g. a long Bash) is also a dangling tool_use, so we
 * only treat the two tools that ALWAYS need the user as "waiting".
 */

const WAIT_TOOLS = /^(AskUserQuestion|ExitPlanMode)$/;
const TAIL_BYTES = 64 * 1024; // a pending question is always near the end
const SCAN_INTERVAL_MS = 2000;

interface PendingQuestion {
  id: string;
  name: string;
}

/** Read the tail of a JSONL transcript and detect a dangling question. */
export function detectWaiting(transcriptPath: string): PendingQuestion | null {
  let fd: number;
  try {
    fd = openSync(transcriptPath, "r");
  } catch {
    return null; // transcript gone / unreadable
  }
  try {
    const { size } = fstatSync(fd);
    const len = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);

    const lines = buf.toString("utf8").split("\n");
    if (size > len) lines.shift(); // drop the partial first line

    let pending: PendingQuestion | null = null;
    for (const line of lines) {
      if (!line.trim()) continue;
      let entry: any;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const content = entry?.message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (block?.type === "tool_use" && WAIT_TOOLS.test(block.name ?? "")) {
          pending = { id: block.id, name: block.name };
        } else if (
          block?.type === "tool_result" &&
          pending &&
          block.tool_use_id === pending.id
        ) {
          pending = null; // the question was answered
        }
      }
    }
    return pending;
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

let timer: NodeJS.Timeout | null = null;

/** Start the periodic scan. Idempotent. */
export function startAttentionScanner(): void {
  if (timer) return;
  timer = setInterval(scanOnce, SCAN_INTERVAL_MS);
  timer.unref?.(); // don't keep the process alive just for the scanner
}

export function stopAttentionScanner(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

function scanOnce(): void {
  // Fade finished "ready" sessions to "idle" once untouched a while.
  store.demoteReadyToIdle();

  for (const { sessionId, transcriptPath } of store.getScanTargets()) {
    const pending = detectWaiting(transcriptPath);
    store.setQuestionAttention(
      sessionId,
      pending !== null,
      pending?.name === "ExitPlanMode"
        ? "Claude is waiting for plan approval"
        : "Claude is asking a question",
    );
  }
}
