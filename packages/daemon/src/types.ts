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

/** Which tool drives the session. */
export type AgentKind = "claude-code" | "codex";

export interface Session {
  sessionId: string;
  cwd: string;
  /** Derived from cwd basename — used to group sessions by project. */
  projectName: string;
  /** Which agent tool this session belongs to (default "claude-code"). */
  agent: AgentKind;
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
  /**
   * The PID chain from the hook process up to the terminal — captured by the
   * hook forwarder (setup/hook.mjs). The integrated terminal's shell PID is in
   * here, so the extension can match this session to its terminal tab
   * (`terminal.processId`) and focus it on click. Localhost-only, like cwd.
   */
  ancestorPids?: number[];
  /**
   * The PID of the agent process itself (`claude` or `codex`), from the hook
   * forwarder. Used for liveness: an idle-but-alive session fires no hooks, so we
   * keep it as long as this process exists rather than time-pruning it.
   * localhost-only.
   */
  agentPid?: number;
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
  source: "statusline" | "oauth" | "ccusage" | "codex" | "none";
  updatedAt: string;
}

/** OS-notification level (future-features.md §1). */
export type NotifyLevel = "off" | "waiting" | "all";

export interface NotifyState {
  level: NotifyLevel;
}

/** The full snapshot every client polls / receives over WS. */
export interface HudState {
  sleep: SleepState;
  sessions: Session[];
  usage: UsageState;
  /** Codex's own 5h/weekly limits (read from its rollout). Separate from `usage`
   * because it's a different account/plan with independent windows. */
  codexUsage?: UsageState;
  notify: NotifyState;
}
