import { store } from "./store.js";
import { debugCapture, debugPath } from "./debug.js";
import type { UsageState, UsageWindow } from "./types.js";

/**
 * Usage ingestion (vision.md §6). The statusLine script forwards Claude Code's
 * raw statusLine stdin JSON here; we extract the rate-limit windows.
 *
 * Facts baked in (vision.md §6):
 *  - `rate_limits` exists only on Claude Code >= v2.1.80, and only while a
 *    session is live. Degrade gracefully when absent.
 *  - `resets_at` is a Unix timestamp in SECONDS.
 *  - `used_percentage` has had accuracy bugs (>100% seen). We display it but
 *    never gate behavior on it — so we clamp nothing here, just pass it through.
 *
 * MUST be tolerant of unknown shapes — schema varies by version.
 */

/** Loose shape — every field optional. */
interface StatusLinePayload {
  session_id?: string;
  session_name?: string;
  cwd?: string;
  workspace?: { current_dir?: string; project_dir?: string };
  rate_limits?: unknown;
  cost?: { total_cost_usd?: number; [k: string]: unknown };
  [k: string]: unknown;
}

export async function ingestUsage(body: unknown): Promise<UsageState> {
  // Capture the raw payload for schema debugging (opt-in via AGENT_HUD_DEBUG).
  debugCapture("agent-hud-statusline.jsonl", body);

  const payload = (body ?? {}) as StatusLinePayload;

  // statusLine is the ONLY source of a session's task name. Attach it to the
  // matching session (by session_id) so the HUD can show "Review vision.md
  // document" instead of just the folder name.
  if (payload.session_id && payload.session_name) {
    const cwd = payload.cwd ?? payload.workspace?.current_dir;
    store.setSessionName(payload.session_id, payload.session_name, cwd);
  }

  const usage = parseUsage(payload);
  store.setUsage(usage);
  return usage;
}

function parseUsage(payload: StatusLinePayload): UsageState {
  const now = new Date().toISOString();
  const rl = payload.rate_limits;

  const usage: UsageState = { source: "none", updatedAt: now };

  if (rl && typeof rl === "object") {
    usage.source = "statusline";
    const r = rl as Record<string, unknown>;
    // Window key names vary by version; probe the likely ones for each bucket.
    usage.session = pickWindow(r, ["session", "five_hour", "5h", "primary"]);
    usage.weekly = pickWindow(r, ["weekly", "seven_day", "7d", "week"]);
    usage.weeklySonnet = pickWindow(r, [
      "weekly_sonnet",
      "weekly_opus",
      "weekly_model",
      "sonnet",
    ]);
  }

  const cost = payload.cost?.total_cost_usd;
  if (typeof cost === "number") usage.costToday = cost;

  return usage;
}

/** Pull a {used_percentage, resets_at} window from the first matching key. */
function pickWindow(
  obj: Record<string, unknown>,
  candidateKeys: string[],
): UsageWindow | undefined {
  for (const key of candidateKeys) {
    const w = obj[key];
    if (w && typeof w === "object") {
      const o = w as Record<string, unknown>;
      const pct = numField(o, ["used_percentage", "usedPercent", "percent"]);
      const reset = numField(o, ["resets_at", "resetsAt", "reset"]);
      if (pct !== undefined) {
        return { usedPercent: pct, resetsAt: reset ?? 0 };
      }
    }
  }
  return undefined;
}

function numField(o: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) if (typeof o[k] === "number") return o[k] as number;
  return undefined;
}

export const RAW_STATUSLINE_LOG_PATH = debugPath("agent-hud-statusline.jsonl");
