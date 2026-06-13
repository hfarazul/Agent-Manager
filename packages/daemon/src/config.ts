/**
 * Central config. Everything tunable lives here so the rest of the code
 * never hardcodes a port or path. (vision.md §3: "centralize in config".)
 */
export const config = {
  /** Daemon HTTP/WS port. Arbitrary; chosen in vision.md §3. */
  port: Number(process.env.AGENT_HUD_PORT ?? 7842),

  /** Bind to loopback only — this is a local-only daemon, never exposed. */
  host: process.env.AGENT_HUD_HOST ?? "127.0.0.1",

  /**
   * A session with no hook activity for this long is considered stale and
   * dropped from /state, so a crashed Claude Code process doesn't linger.
   */
  sessionStaleMs: Number(process.env.AGENT_HUD_SESSION_STALE_MS ?? 1000 * 60 * 30),

  /**
   * A "ready" session (finished a turn, awaiting your next prompt) that sits
   * untouched for this long demotes to "idle" — the soft "your move" cue fades
   * to calm once you've clearly not engaged.
   */
  readyToIdleMs: Number(process.env.AGENT_HUD_READY_TO_IDLE_MS ?? 1000 * 60 * 5),
} as const;
