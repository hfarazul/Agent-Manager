import { store } from "./store.js";
import { debugCapture, debugPath } from "./debug.js";
import type { SessionStatus } from "./types.js";

/**
 * Hook ingestion (vision.md §4 + §6). Claude Code pipes each hook event's JSON
 * on stdin; the curl hook forwards it as the POST body. We map the event to a
 * session-status change.
 *
 * MUST be tolerant of unknown fields AND unknown event names — schemas vary by
 * Claude Code version (vision.md §4). We never throw on shape; worst case we
 * log and ignore.
 */

/** Loose shape — every field optional because versions differ. */
interface HookPayload {
  session_id?: string;
  hook_event_name?: string;
  cwd?: string;
  transcript_path?: string;
  message?: string;
  /** PID chain injected by the hook forwarder (setup/hook.mjs) — used to map a
   * session to its terminal tab for click-to-session. */
  agent_hud_ancestor_pids?: unknown;
  [k: string]: unknown;
}

/** Read the forwarder's ancestor-PID array, tolerating any shape. */
function extractAncestorPids(payload: HookPayload): number[] | undefined {
  const raw = payload.agent_hud_ancestor_pids;
  if (!Array.isArray(raw)) return undefined;
  const pids = raw.filter((n): n is number => typeof n === "number" && n > 0);
  return pids.length ? pids : undefined;
}

/** Map a Claude Code hook event name → our session status transition. */
const STATUS_BY_EVENT: Record<string, SessionStatus> = {
  SessionStart: "running",
  // Stop = the turn finished → "ready" (your move), NOT a blocked alarm.
  Stop: "ready",
  // These flip a session back to running once you respond / work resumes —
  // without them a session would stay amber until the turn ends.
  UserPromptSubmit: "running", // user sent a message
  PreToolUse: "running", // a tool started (e.g. after a permission grant)
  PostToolUse: "running",
  // Notification is classified separately (see ingestHook) — its meaning depends
  // on the message: a permission request is a loud "waiting", but the generic
  // "Claude is waiting for your input" just means a finished turn ("ready").
};

/** A Notification whose message is the generic finished-turn prompt, not a
 * permission/blocking request. */
function isFinishedTurnNotification(message: string | undefined): boolean {
  return /waiting for your input/i.test(message ?? "");
}

export interface HookResult {
  ok: boolean;
  event?: string;
  action: "upsert" | "remove" | "ignored";
}

export async function ingestHook(body: unknown): Promise<HookResult> {
  // Capture the raw payload for schema debugging (opt-in via AGENT_HUD_DEBUG).
  debugCapture("agent-hud-hooks.jsonl", body);

  const payload = (body ?? {}) as HookPayload;
  const event = payload.hook_event_name;
  const sessionId = payload.session_id;

  if (!event || !sessionId) {
    return { ok: false, event, action: "ignored" };
  }

  // SessionEnd removes the session entirely.
  if (event === "SessionEnd") {
    store.removeSession(sessionId);
    return { ok: true, event, action: "remove" };
  }

  // Notification's status depends on its message (permission vs finished-turn).
  let status: SessionStatus | undefined;
  let message: string | undefined;
  if (event === "Notification") {
    message = extractMessage(payload);
    status = isFinishedTurnNotification(message) ? "ready" : "waiting";
    // A finished-turn notification carries no actionable message to surface.
    if (status === "ready") message = undefined;
  } else {
    status = STATUS_BY_EVENT[event];
  }

  if (!status) {
    // Unknown event — tolerated, just refresh activity so the session
    // doesn't go stale, but don't change its status.
    return { ok: true, event, action: "ignored" };
  }

  store.upsertSession(
    sessionId,
    payload.cwd ?? "",
    status,
    message,
    // Capture transcript path so the AskUserQuestion scanner can tail it.
    typeof payload.transcript_path === "string" ? payload.transcript_path : undefined,
    // Capture the PID chain so the extension can focus this session's terminal.
    extractAncestorPids(payload),
  );

  return { ok: true, event, action: "upsert" };
}

function extractMessage(payload: HookPayload): string | undefined {
  if (typeof payload.message === "string") return payload.message;
  return undefined;
}

export const RAW_HOOK_LOG_PATH = debugPath("agent-hud-hooks.jsonl");
