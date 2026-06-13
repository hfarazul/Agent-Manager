import type { HudState } from "./types.js";

/** Compact status-bar text, e.g. "🟢 3 · ⚠ 1 · 5h 38% · wk 62%" (vision.md §8). */
export function statusBarText(state: HudState | null, connected: boolean): string {
  if (!connected || !state) return "$(debug-disconnect) HUD";

  const count = (st: string) =>
    state.sessions.filter((s) => s.status === st).length;
  const waiting = count("waiting");
  const ready = count("ready");
  const running = count("running");

  // Alarm-first: lead with what needs you (waiting, then ready), then running.
  const parts: string[] = [];
  if (waiting > 0) parts.push(`$(warning) ${waiting}`);
  if (ready > 0) parts.push(`$(bell) ${ready}`);
  parts.push(`$(pulse) ${running}`);

  const sleepOn = state.sleep.idleAwake || state.sleep.clamshell;
  parts.push(sleepOn ? "$(eye) awake" : "$(eye-closed)");

  if (state.usage.session) parts.push(`5h ${Math.round(state.usage.session.usedPercent)}%`);
  if (state.usage.weekly) parts.push(`wk ${Math.round(state.usage.weekly.usedPercent)}%`);

  return parts.join(" · ");
}

/** Tooltip with per-session detail. */
export function statusBarTooltip(state: HudState | null, connected: boolean): string {
  if (!connected || !state) return "Agent HUD daemon not reachable (port 7842).";
  const lines = ["Agent HUD", ""];
  if (state.sessions.length === 0) lines.push("No active Claude Code sessions.");
  for (const s of state.sessions) {
    const badge =
      s.status === "waiting"
        ? "⚠"
        : s.status === "ready"
          ? "◆"
          : s.status === "running"
            ? "●"
            : "○";
    lines.push(`${badge} ${s.name ?? s.projectName} — ${s.status}`);
    if (s.status === "waiting" && s.lastMessage) lines.push(`    ${s.lastMessage}`);
  }
  lines.push("");
  lines.push(
    `Sleep: idle ${state.sleep.idleAwake ? "on" : "off"}, ` +
      `clamshell ${state.sleep.clamshell ? "on" : "off"}`,
  );
  return lines.join("\n");
}
