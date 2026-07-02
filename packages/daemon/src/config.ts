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
   * A session still marked "running" but silent for this long is almost
   * certainly NOT running — an actively-working agent fires hooks every few
   * seconds. Past this cutoff we DISPLAY it as "idle" (grey, not green) so
   * abandoned headless sessions (e.g. IDE-panel `claude --output-format
   * stream-json` that never cleanly exited) stop looking active. Display-only;
   * the stored status is untouched, so a fresh hook flips it back to running.
   */
  staleRunningMs: Number(process.env.AGENT_HUD_STALE_RUNNING_MS ?? 1000 * 60 * 20),

  /**
   * When set, raw hook/statusLine payloads are appended to JSONL files under
   * $TMPDIR for schema debugging (Step 0). OFF by default — these payloads
   * contain local paths + session metadata and the files grow unbounded.
   */
  debug: !!process.env.AGENT_HUD_DEBUG,

  /**
   * Default OS-notification level. "off" = none, "waiting" = only when a session
   * blocks on you (permission/question — the high-value alert), "all" = also when
   * a session finishes a turn ("ready"). Runtime-toggleable from the HUD (POST
   * /notify); this is just the startup default.
   */
  notifyLevel: parseNotifyLevel(process.env.AGENT_HUD_NOTIFY),
} as const;

function parseNotifyLevel(v: string | undefined): "off" | "waiting" | "all" {
  return v === "off" || v === "all" || v === "waiting" ? v : "waiting";
}
