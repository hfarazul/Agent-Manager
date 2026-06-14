import { store } from "./store.js";
import { sendNotification } from "./notify.js";
import type { NotifyLevel, Session, SessionStatus } from "./types.js";

/**
 * OS-notification trigger (future-features.md §1). Subscribes to store changes,
 * diffs each session's status against the last seen one, and fires on the EDGE —
 * a real transition INTO an alertable state — not on every snapshot (the store
 * emits "change" constantly). One fire per transition = natural per-session
 * dedupe.
 *
 * Level is read live from the store each time, so the HUD toggle takes effect
 * immediately:
 *   - "off"     → never
 *   - "waiting" → only when a session starts blocking on you (the loud case)
 *   - "all"     → also when a session finishes a turn ("ready" / your move)
 */

const lastStatus = new Map<string, SessionStatus>();
let started = false;

export function startNotifier(): void {
  if (started) return;
  started = true;
  // Baseline current sessions WITHOUT firing — a session already waiting at
  // daemon startup isn't a transition we caused or should alert on.
  for (const s of store.getState().sessions) lastStatus.set(s.sessionId, s.status);
  store.on("change", onChange);
}

function onChange(): void {
  const state = store.getState();
  const level = state.notify.level;
  const live = new Set<string>();

  for (const s of state.sessions) {
    live.add(s.sessionId);
    const before = lastStatus.get(s.sessionId);
    lastStatus.set(s.sessionId, s.status); // always track, even when level=off

    if (before === undefined) continue; // first sighting — no transition

    const kind = notificationFor(before, s.status, level);
    if (kind === "waiting") fireWaiting(s);
    else if (kind === "ready") fireReady(s);
  }

  // Drop sessions that have gone away so re-use of an id later baselines clean.
  for (const id of [...lastStatus.keys()]) if (!live.has(id)) lastStatus.delete(id);
}

/**
 * Decide what (if anything) to notify for a status transition. Pure — the edge
 * + level policy in one testable place. Returns null for non-events.
 */
export function notificationFor(
  before: SessionStatus,
  after: SessionStatus,
  level: NotifyLevel,
): "waiting" | "ready" | null {
  if (level === "off" || before === after) return null;
  if (after === "waiting") return "waiting"; // the loud case, both levels
  if (after === "ready" && level === "all") return "ready";
  return null;
}

function fireWaiting(s: Session): void {
  sendNotification({
    title: s.projectName || "Claude Code",
    subtitle: taskName(s),
    message: s.lastMessage || "needs your input",
    sessionId: s.sessionId,
    sound: true,
  });
}

function fireReady(s: Session): void {
  sendNotification({
    title: s.projectName || "Claude Code",
    subtitle: taskName(s),
    message: "Finished — your move",
    sessionId: s.sessionId,
    sound: false,
  });
}

function taskName(s: Session): string {
  return s.name || `session ${s.sessionId.slice(0, 6)}`;
}
