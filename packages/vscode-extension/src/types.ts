// Mirror of the daemon's state model (vision.md §4). Kept as a small local copy
// so the extension has no build-time dependency on the daemon package.

export type SessionStatus = "running" | "waiting" | "ready" | "idle";

export interface Session {
  sessionId: string;
  cwd: string;
  projectName: string;
  /** Claude Code session task name, e.g. "Review vision.md document". */
  name?: string;
  status: SessionStatus;
  lastMessage?: string;
  /** Why the session needs attention (the UI may ignore this). */
  attentionReason?: "notification" | "question";
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
  source: "statusline" | "oauth" | "ccusage" | "none";
  updatedAt: string;
}

export interface HudState {
  sleep: SleepState;
  sessions: Session[];
  usage: UsageState;
}
