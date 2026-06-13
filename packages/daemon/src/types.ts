/**
 * State model — mirrors vision.md §4. In-memory only for v1; no DB.
 */

/**
 * - running : actively working (tools firing / prompt submitted)
 * - waiting : BLOCKED on you — permission prompt or AskUserQuestion (loud)
 * - ready   : finished a turn, awaiting your next message (soft cue)
 * - idle    : finished and sat untouched a while (calm)
 */
export type SessionStatus = "running" | "waiting" | "ready" | "idle";

export interface Session {
  sessionId: string;
  cwd: string;
  /** Derived from cwd basename — used to group sessions by project. */
  projectName: string;
  /**
   * The Claude Code session's task name (e.g. "Review vision.md document").
   * Comes from the statusLine payload's `session_name`, not from hooks, so it
   * populates a beat after SessionStart once the first statusLine push lands.
   */
  name?: string;
  status: SessionStatus;
  /** e.g. the Notification text that put this session into needs_attention. */
  lastMessage?: string;
  /**
   * Why a session is in needs_attention — so the hook-driven signal (permission
   * prompts via Notification) and the transcript scanner (AskUserQuestion) don't
   * clobber each other. Internal-ish; the UI can ignore it.
   */
  attentionReason?: "notification" | "question";
  /** Path to the session's transcript JSONL (from hook payloads). For the
   * AskUserQuestion scanner. Local path; only exposed on localhost /state. */
  transcriptPath?: string;
  /** ISO timestamp of last update. */
  updatedAt: string;
}

export interface SleepState {
  /** caffeinate child process running → blocks idle sleep (lid open). */
  idleAwake: boolean;
  /** pmset disablesleep = 1 → blocks clamshell sleep (lid closed). */
  clamshell: boolean;
}

export interface UsageWindow {
  usedPercent: number;
  /** Unix timestamp in SECONDS (vision.md §6). */
  resetsAt: number;
}

export interface UsageState {
  /** 5-hour rolling window. */
  session?: UsageWindow;
  /** 7-day rolling window. */
  weekly?: UsageWindow;
  weeklySonnet?: UsageWindow;
  tokensToday?: number;
  costToday?: number;
  source: "statusline" | "oauth" | "ccusage" | "none";
  updatedAt: string;
}

/** The full snapshot every client polls / receives over WS. */
export interface HudState {
  sleep: SleepState;
  sessions: Session[];
  usage: UsageState;
}
