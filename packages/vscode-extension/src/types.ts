// Mirror of the daemon's state model (vision.md §4). Kept as a small local copy
// so the extension has no build-time dependency on the daemon package.

export type SessionStatus = "running" | "waiting" | "ready" | "idle";

export type AgentKind = "claude-code" | "codex";

export interface Session {
  sessionId: string;
  cwd: string;
  projectName: string;
  /** Which agent tool this session belongs to. */
  agent: AgentKind;
  /** Claude Code session task name, e.g. "Review vision.md document". */
  name?: string;
  status: SessionStatus;
  lastMessage?: string;
  /** Why the session needs attention (the UI may ignore this). */
  attentionReason?: "notification" | "question";
  /** PID chain from the hook up to the terminal shell — the shell PID matches
   * `terminal.processId`, letting us focus this session's tab on click. */
  ancestorPids?: number[];
  agentPid?: number;
  updatedAt: string;
}

export interface SleepState {
  idleAwake: boolean;
  clamshell: boolean;
}

export interface UsageWindow {
  usedPercent: number;
  resetsAt: number;
}

export interface UsageState {
  session?: UsageWindow;
  weekly?: UsageWindow;
  weeklySonnet?: UsageWindow;
  tokensToday?: number;
  costToday?: number;
  source: "statusline" | "oauth" | "ccusage" | "codex" | "none";
  updatedAt: string;
}

export type NotifyLevel = "off" | "waiting" | "all";

export interface NotifyState {
  level: NotifyLevel;
}

export interface HudState {
  sleep: SleepState;
  sessions: Session[];
  usage: UsageState;
  codexUsage?: UsageState;
  notify: NotifyState;
}
