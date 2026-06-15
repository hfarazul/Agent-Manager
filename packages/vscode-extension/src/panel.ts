import type { HudState, Session } from "./types.js";

/**
 * Agent HUD panel — "Console v4" (Claude Design handoff).
 *
 * Carded repos + minimal sessions: each repo is its own card whose warm LEFT
 * EDGE appears only when it needs you (amber = waiting, blue = ready); running/
 * idle-only repos stay neutral. Every session is a single line — status dot ·
 * name · inline action (respond ↵ / your move / running / idle) · age. The whole
 * line is click-to-session. The footer sections (Claude limits, Codex limits,
 * Keep Awake, Notify) keep their original look but are now COLLAPSIBLE.
 *
 * One self-contained HTML string, theme-variable driven (light + dark), all
 * motion gated behind prefers-reduced-motion.
 *
 * `collapsed` is the set of FOOTER SECTION keys the user has folded (claude /
 * codex / awake / notify); owned by the extension so it survives re-renders.
 */
export function panelHtml(
  state: HudState | null,
  connected: boolean,
  collapsed: Set<string> = new Set(),
): string {
  const inner = !connected || !state ? disconnected() : content(state, collapsed);
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  *{box-sizing:border-box;}
  body{margin:0;padding:0;background:var(--vscode-sideBar-background,var(--vscode-editor-background));
    font-family:'SF Mono',Menlo,Monaco,'Cascadia Code','Courier New',monospace;
    font-size:12.5px;line-height:1.45;color:var(--vscode-foreground);}
  button{font:inherit;}
  .sans{font-family:-apple-system,'Segoe UI',system-ui,sans-serif;}
  .hud{--green:var(--vscode-charts-green,#2f8a2f);--yellow:var(--vscode-charts-yellow,#9a7400);
    --warn:var(--vscode-editorWarning-foreground,#c89000);--err:var(--vscode-errorForeground,#e06c5d);
    --blue:var(--vscode-charts-blue,#3b86d6);
    /* Fixed strong blue for the segmented pills — the theme's button bg is
       washed-out in some themes. */
    --accent:#3b86d6;
    --widget:var(--vscode-editorWidget-background,rgba(127,127,127,.1));
    --border:var(--vscode-panel-border,rgba(127,127,127,.25));
    --dim:var(--vscode-descriptionForeground,#808080);}
  .hud-sec{padding:11px 15px;border-top:1px solid var(--border);}
  .sec-head{width:100%;display:flex;align-items:center;gap:8px;background:none;border:none;cursor:pointer;padding:0;color:inherit;text-align:left;}
  .sec-head:hover{opacity:.78;}
  .sess{display:flex;align-items:center;gap:9px;padding:3px 4px;border-radius:6px;cursor:pointer;}
  .sess:hover{background:color-mix(in srgb,var(--vscode-foreground) 8%,transparent);}
  .name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .age{color:var(--dim);font-size:10.5px;width:28px;text-align:right;flex:none;}
  .gauge{letter-spacing:2px;font-variant-numeric:tabular-nums;}
  @keyframes hudPulse{0%,100%{opacity:1;}50%{opacity:.4;}}
  @media (prefers-reduced-motion: no-preference){
    .hud-pulse{animation:hudPulse 1.7s ease-in-out infinite;}
  }
</style></head>
<body><div class="hud">${inner}</div>
<script>
  const vscode = acquireVsCodeApi();
  document.querySelectorAll('[data-level]').forEach((b) =>
    b.addEventListener('click', () => vscode.postMessage({ cmd: 'sleepLevel', level: Number(b.dataset.level) })));
  document.querySelectorAll('[data-section]').forEach((b) =>
    b.addEventListener('click', () => vscode.postMessage({ cmd: 'toggleSection', section: b.dataset.section })));
  document.querySelectorAll('[data-goto]').forEach((el) =>
    el.addEventListener('click', () => vscode.postMessage({ cmd: 'goToSession', sessionId: el.dataset.goto })));
  document.querySelectorAll('[data-notify]').forEach((b) =>
    b.addEventListener('click', () => vscode.postMessage({ cmd: 'notifyLevel', level: b.dataset.notify })));
</script></body></html>`;
}

/* ─────────────────────────── header ─────────────────────────── */

function header(connected: boolean): string {
  const right = connected
    ? `<span style="display:inline-flex;align-items:center;gap:5px;color:var(--green);font-size:11px;"><span style="width:6px;height:6px;border-radius:50%;background:var(--green);"></span>:7842</span>`
    : `<span style="display:inline-flex;align-items:center;gap:5px;color:var(--err);font-size:11px;"><span style="width:6px;height:6px;border-radius:50%;background:var(--err);"></span>offline</span>`;
  return `<div style="display:flex;align-items:center;gap:8px;padding:10px 15px;border-bottom:1px solid var(--border);">
    <span style="font-weight:700;letter-spacing:.05em;">AGENT·HUD</span>
    <span style="margin-left:auto;">${right}</span>
  </div>`;
}

function disconnected(): string {
  return `${header(false)}
  <div style="padding:26px 16px;text-align:center;color:var(--dim);">
    <div style="font-size:11px;letter-spacing:.11em;margin-bottom:6px;">DAEMON OFFLINE</div>
    <div style="font-size:11.5px;line-height:1.6;">No connection on <span style="color:var(--vscode-foreground);">:7842</span>.<br>
      Is the agent-hud daemon running?</div>
  </div>`;
}

/* ─────────────────────────── main content ─────────────────────────── */

function content(s: HudState, collapsed: Set<string>): string {
  const count = (st: Session["status"]) =>
    s.sessions.filter((x) => x.status === st).length;

  return `${header(true)}
  <div style="padding:13px 15px 5px;">
    <div style="font-size:9.5px;letter-spacing:.13em;color:var(--dim);margin-bottom:5px;">SESSIONS</div>
    <div style="font-size:10.5px;color:var(--dim);">${summary(count("running"), count("waiting"), count("ready"), count("idle"))}</div>
  </div>
  <div style="padding:8px 11px 5px;display:flex;flex-direction:column;gap:8px;">
    ${s.sessions.length === 0 ? emptySessions() : repoCards(s.sessions)}
  </div>
  ${claudeLimits(s.usage, collapsed)}
  ${s.codexUsage && (s.codexUsage.session || s.codexUsage.weekly) ? codexLimits(s.codexUsage, collapsed) : ""}
  ${awakeSection(s.sleep, collapsed)}
  ${notifySection(s.notify, collapsed)}`;
}

function summary(run: number, wait: number, ready: number, idle: number): string {
  const parts: string[] = [];
  if (wait > 0) parts.push(`${wait} <span style="color:var(--warn);">waiting</span>`);
  if (ready > 0) parts.push(`${ready} <span style="color:var(--blue);">ready</span>`);
  parts.push(`${run} <span style="color:var(--green);">running</span>`);
  if (idle > 0) parts.push(`${idle} idle`);
  return parts.join(" · ");
}

/* ─────────────────────────── repo cards ─────────────────────────── */

/** Ordering priority — most "needs you" first: waiting → ready → running → idle. */
function statusRank(st: Session["status"]): number {
  return st === "waiting" ? 0 : st === "ready" ? 1 : st === "running" ? 2 : 3;
}

function repoCards(sessions: Session[]): string {
  const groups = new Map<string, Session[]>();
  for (const s of sessions) {
    const key = s.projectName || "unknown";
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(s);
  }

  const ordered = [...groups.entries()]
    .map(([project, rows]) => {
      rows.sort(
        (a, b) =>
          statusRank(a.status) - statusRank(b.status) ||
          Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
      );
      const rank = Math.min(...rows.map((r) => statusRank(r.status)));
      const recency = Math.max(...rows.map((r) => Date.parse(r.updatedAt) || 0));
      return { project, rows, rank, recency };
    })
    .sort((a, b) => a.rank - b.rank || b.recency - a.recency);

  return ordered.map(({ project, rows }) => repoCard(project, rows)).join("");
}

function repoCard(project: string, rows: Session[]): string {
  // Warm left edge ONLY when the repo needs you: amber for waiting, else blue
  // for ready. Running/idle-only repos stay neutral.
  const edge = rows.some((r) => r.status === "waiting")
    ? "var(--warn)"
    : rows.some((r) => r.status === "ready")
      ? "var(--blue)"
      : "";
  const leftBorder = edge ? `border-left:2px solid ${edge};` : "";
  return `<div style="background:var(--widget);border:1px solid var(--border);${leftBorder}border-radius:10px;padding:9px 12px;">
    <div style="display:flex;align-items:center;gap:9px;margin-bottom:6px;">
      ${monoChip(project)}
      <span class="sans" style="font-size:12.5px;font-weight:600;color:var(--vscode-foreground);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(project)}</span>
    </div>
    ${rows.map(sessionLine).join("")}
  </div>`;
}

/** Tinted monogram chip from the repo name (hashed → palette). */
const MONO_PALETTE = [
  "#5b8def", "#a36ad1", "#c7754d", "#3fae7a",
  "#d1689a", "#5aa9c4", "#c9a13b", "#7b86d6", "#5fb05f", "#cc6a6a",
];
function monoColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return MONO_PALETTE[h % MONO_PALETTE.length];
}
function monogram(name: string): string {
  return (name.trim()[0] || "?").toUpperCase();
}
function monoChip(project: string): string {
  const c = monoColor(project);
  return `<span class="sans" style="width:17px;height:17px;border-radius:5px;background:color-mix(in srgb,${c} 22%,transparent);color:${c};font-size:9.5px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;flex:none;">${esc(monogram(project))}</span>`;
}

/* ─────────────────────────── session lines ─────────────────────────── */

/** Row label = the session's task within the repo (the repo is on the card). */
function label(x: Session): string {
  return x.name || `session ${x.sessionId.slice(0, 6)}`;
}

function sessionLine(x: Session): string {
  const dot =
    x.status === "running"
      ? `<span class="hud-pulse" style="width:6px;height:6px;border-radius:50%;background:var(--green);flex:none;"></span>`
      : x.status === "waiting"
        ? `<span style="width:6px;height:6px;border-radius:50%;background:var(--warn);flex:none;"></span>`
        : x.status === "ready"
          ? `<span style="width:6px;height:6px;border-radius:50%;background:var(--blue);flex:none;"></span>`
          : `<span style="width:6px;height:6px;border-radius:50%;border:1.5px solid var(--dim);flex:none;"></span>`;

  const action =
    x.status === "waiting"
      ? `<span style="font-size:10px;color:var(--warn);font-weight:700;flex:none;letter-spacing:.02em;">respond ↵</span>`
      : x.status === "ready"
        ? `<span style="font-size:10px;color:var(--blue);font-weight:700;flex:none;">your move</span>`
        : `<span style="font-size:10px;color:var(--dim);flex:none;">${x.status}</span>`;

  const nameColor = x.status === "idle" ? "var(--dim)" : "var(--vscode-foreground)";

  return `<div class="sess" data-goto="${esc(x.sessionId)}" title="Go to this session's terminal">
    ${dot}
    <span class="name" style="color:${nameColor};">${esc(label(x))}</span>
    ${action}
    <span class="age">${relAge(x.updatedAt)}</span>
  </div>`;
}

function emptySessions(): string {
  return `<div style="padding:14px 4px;color:var(--dim);font-size:11.5px;text-align:center;">no active sessions</div>`;
}

/* ─────────────────────────── collapsible footer sections ─────────────────────────── */

function sectionHead(key: string, title: string, open: boolean, rightLabel?: string): string {
  return `<button data-section="${esc(key)}" class="sec-head">
    <span style="color:var(--dim);font-size:11px;width:11px;flex:none;line-height:1;">${open ? "▾" : "▸"}</span>
    <span style="font-size:9.5px;letter-spacing:.13em;color:var(--dim);">${esc(title)}</span>
    ${rightLabel ? `<span style="margin-left:auto;font-size:9.5px;color:var(--dim);">${esc(rightLabel)}</span>` : ""}
  </button>`;
}

/* limits ---------------------------------------------------------------- */

function claudeLimits(usage: HudState["usage"], collapsed: Set<string>): string {
  const open = !collapsed.has("claude");
  const hasData = !!(usage.session || usage.weekly);
  const body = hasData
    ? gauges(usage)
    : `<div style="font-size:11px;color:var(--dim);">no data yet · statusline pushes while a session is live</div>`;
  return `<div class="hud-sec">
    ${sectionHead("claude", "CLAUDE CODE LIMITS", open, hasData ? `via ${usage.source}` : undefined)}
    ${open ? `<div style="margin-top:10px;">${body}</div>` : ""}
  </div>`;
}

function codexLimits(usage: HudState["usage"], collapsed: Set<string>): string {
  const open = !collapsed.has("codex");
  return `<div class="hud-sec">
    ${sectionHead("codex", "CODEX LIMITS", open, `via ${usage.source}`)}
    ${open ? `<div style="margin-top:10px;">${gauges(usage)}</div>` : ""}
  </div>`;
}

function gauges(usage: HudState["usage"]): string {
  return `${usage.session ? gaugeRow("5h", usage.session) : ""}${usage.weekly ? gaugeRow("7d", usage.weekly, true) : ""}`;
}

function gaugeRow(
  tag: string,
  w: { usedPercent: number; resetsAt: number },
  spaced = false,
): string {
  const pct = w.usedPercent;
  const filled = Math.max(0, Math.min(10, Math.round(pct / 10)));
  const bar = "▓".repeat(filled) + "░".repeat(10 - filled);
  const color = pct < 50 ? "var(--green)" : pct < 80 ? "var(--yellow)" : "var(--err)";
  const reset = w.resetsAt ? `resets ${relReset(w.resetsAt)}` : "";
  return `<div style="display:flex;align-items:center;gap:9px;font-size:11px;${spaced ? "margin-top:6px;" : ""}">
    <span style="color:var(--dim);width:18px;flex:none;">${tag}</span>
    <span class="gauge" style="color:${color};">${bar}</span>
    <span style="font-variant-numeric:tabular-nums;width:30px;flex:none;">${Math.round(pct)}%</span>
    <span style="margin-left:auto;color:var(--dim);flex:none;">${reset}</span>
  </div>`;
}

/* keep-awake (segmented) ------------------------------------------------ */

function awakeSection(sleep: HudState["sleep"], collapsed: Set<string>): string {
  const open = !collapsed.has("awake");
  const level = sleep.clamshell ? 2 : sleep.idleAwake ? 1 : 0;
  const lines = [
    "Sleeps normally — agents pause when the Mac does.",
    "Awake while the lid’s open — sleeps when you close it.",
    "Awake even with the lid closed (clamshell mode).",
  ];
  const body = `<div style="position:relative;display:flex;padding:3px;background:var(--widget);border:1px solid var(--border);border-radius:8px;">
      <div style="position:absolute;top:3px;bottom:3px;left:3px;width:calc((100% - 6px)/3);border-radius:6px;background:var(--accent);transform:translateX(${level * 100}%);transition:transform .16s ease;"></div>
      ${pillBtn("Sleep", 0, level, "data-level")}${pillBtn("Awake", 1, level, "data-level")}${pillBtn("Always", 2, level, "data-level")}
    </div>
    <div style="display:flex;align-items:center;gap:7px;margin-top:8px;font-size:10.5px;">
      <span style="width:6px;height:6px;border-radius:50%;flex:none;background:${level > 0 ? "var(--green)" : "var(--dim)"};opacity:${level > 0 ? 1 : 0.5};"></span>
      <span style="color:var(--dim);line-height:1.4;">${lines[level]}</span>
    </div>`;
  return `<div class="hud-sec">
    ${sectionHead("awake", "KEEP MAC AWAKE", open)}
    ${open ? `<div style="margin-top:10px;">${body}</div>` : ""}
  </div>`;
}

/* notifications (segmented) --------------------------------------------- */

function notifySection(notify: HudState["notify"], collapsed: Set<string>): string {
  const open = !collapsed.has("notify");
  const level = notify?.level ?? "waiting";
  const idx = level === "off" ? 0 : level === "waiting" ? 1 : 2;
  const lines = [
    "No pop-ups.",
    "Pings you when an agent needs you.",
    "Pings on needs-you and finished turns.",
  ];
  const body = `<div style="position:relative;display:flex;padding:3px;background:var(--widget);border:1px solid var(--border);border-radius:8px;">
      <div style="position:absolute;top:3px;bottom:3px;left:3px;width:calc((100% - 6px)/3);border-radius:6px;background:var(--accent);transform:translateX(${idx * 100}%);transition:transform .16s ease;"></div>
      ${pillBtn("Off", 0, idx, "data-notify", "off")}${pillBtn("Waiting", 1, idx, "data-notify", "waiting")}${pillBtn("All", 2, idx, "data-notify", "all")}
    </div>
    <div style="display:flex;align-items:center;gap:7px;margin-top:8px;font-size:10.5px;">
      <span style="width:6px;height:6px;border-radius:50%;flex:none;background:${idx > 0 ? "var(--green)" : "var(--dim)"};opacity:${idx > 0 ? 1 : 0.5};"></span>
      <span style="color:var(--dim);line-height:1.4;">${lines[idx]}</span>
    </div>`;
  return `<div class="hud-sec">
    ${sectionHead("notify", "NOTIFY", open)}
    ${open ? `<div style="margin-top:10px;">${body}</div>` : ""}
  </div>`;
}

/** A segmented-control button. `attr` is the data-attribute the click script
 * listens on (data-level for sleep, data-notify for notify). */
function pillBtn(lbl: string, i: number, active: number, attr: string, value?: string): string {
  const on = i === active;
  const color = on ? "#fff" : "var(--vscode-foreground)";
  return `<button ${attr}="${value ?? i}" style="position:relative;z-index:1;flex:1;padding:6px 4px;border:none;background:transparent;border-radius:6px;cursor:pointer;font-family:inherit;font-size:10.5px;font-weight:${on ? 700 : 600};color:${color};transition:color .16s ease;">${lbl}</button>`;
}

/* ─────────────────────────── helpers ─────────────────────────── */

function relAge(iso: string): string {
  let ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms) || ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function relReset(unixSec: number): string {
  const diff = unixSec * 1000 - Date.now();
  if (diff <= 0) return "now";
  const totalMin = Math.floor(diff / 60000);
  const days = Math.floor(totalMin / 1440);
  const hrs = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `${days}d ${hrs}h`;
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

function esc(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );
}
