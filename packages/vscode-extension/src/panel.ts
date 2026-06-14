import type { HudState, Session } from "./types.js";

/**
 * Agent HUD panel — "Console v3" (Claude Design handoff).
 *
 * Monospace ops dashboard, attention-first. Sessions cluster under collapsible
 * REPO groups whose headers read "human" (colored monogram + sans-serif name +
 * roll-up status dot) while the rows stay "terminal" (monospace). Keep-awake is
 * a single segmented control (Sleep · Awake · Lid closed) with a plain-language
 * result line. Four states — waiting (loud) · ready (soft) · running · idle.
 *
 * One self-contained HTML string, theme-variable driven (light + dark), all
 * motion gated behind prefers-reduced-motion.
 *
 * `collapsed` is the set of project names the user has folded; it's owned by the
 * extension so it survives the wholesale re-render on every poll.
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
    font-size:12.5px;line-height:1.4;color:var(--vscode-foreground);}
  button{font:inherit;}
  .sans{font-family:-apple-system,'Segoe UI',system-ui,sans-serif;}
  .hud{--green:var(--vscode-charts-green,#2f8a2f);--yellow:var(--vscode-charts-yellow,#9a7400);
    --warn:var(--vscode-editorWarning-foreground,#c89000);--err:var(--vscode-errorForeground,#e06c5d);
    --blue:var(--vscode-charts-blue,#3b86d6);
    /* Fixed strong blue for the keep-awake pill, matching the design — the
       theme's button bg is washed-out in some themes. */
    --accent:#3b86d6;
    --widget:var(--vscode-editorWidget-background,rgba(127,127,127,.1));
    --border:var(--vscode-panel-border,rgba(127,127,127,.25));
    --dim:var(--vscode-descriptionForeground,#808080);}
  .hud-sec{padding:11px 14px;border-top:1px solid var(--border);}
  .hud-row{display:flex;align-items:center;gap:11px;padding:8px 4px 8px 10px;}
  .hud-go{cursor:pointer;}
  .hud-go:hover{background:var(--widget);}
  .hud-go:hover .hud-goto{opacity:1;}
  .hud-goto{opacity:0;color:var(--dim);font-size:10px;flex:none;transition:opacity .12s ease;}
  .hud-label{display:inline-flex;align-items:center;gap:8px;width:80px;flex:none;}
  .hud-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .hud-age{color:var(--dim);font-size:11px;flex:none;}
  .hud-eqbar{width:3px;height:11px;transform-origin:bottom;transform:scaleY(.4);}
  .gauge{letter-spacing:2px;font-variant-numeric:tabular-nums;}
  .grp-head{width:100%;text-align:left;background:none;border:none;cursor:pointer;padding:0;display:flex;align-items:center;gap:10px;margin:14px 0 7px;color:inherit;}
  .grp-head:hover .grp-name{text-decoration:underline;text-underline-offset:2px;}
  .mono-chip{width:19px;height:19px;border-radius:6px;color:#fff;font-size:11px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;flex:none;}
  @keyframes hudPulse{0%,100%{opacity:1;}50%{opacity:.32;}}
  @keyframes hudGlow{0%,100%{box-shadow:0 0 0 0 color-mix(in srgb,var(--warn) 38%,transparent);}50%{box-shadow:0 0 0 5px color-mix(in srgb,var(--warn) 0%,transparent);}}
  @keyframes hudEq{0%,100%{transform:scaleY(.32);}50%{transform:scaleY(1);}}
  @media (prefers-reduced-motion: no-preference){
    .hud-pulse{animation:hudPulse 1.6s ease-in-out infinite;}
    .hud-glow{animation:hudGlow 2.4s ease-in-out infinite;}
    .hud-eqbar{animation:hudEq .9s ease-in-out infinite;}
  }
</style></head>
<body><div class="hud">${inner}</div>
<script>
  const vscode = acquireVsCodeApi();
  document.querySelectorAll('[data-level]').forEach((b) =>
    b.addEventListener('click', () => vscode.postMessage({ cmd: 'sleepLevel', level: Number(b.dataset.level) })));
  document.querySelectorAll('[data-group]').forEach((b) =>
    b.addEventListener('click', () => vscode.postMessage({ cmd: 'toggleGroup', group: b.dataset.group })));
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
  return `<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--border);">
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

  // Attention-first: Sessions (the product) → Limits (glanceable budget) →
  // Keep-awake (occasional control, footer).
  return `${header(true)}
  <div style="padding:12px 14px 2px;display:flex;align-items:center;gap:8px;">
    <span style="font-size:10px;letter-spacing:.11em;color:var(--dim);">SESSIONS</span>
    <span style="margin-left:auto;font-size:11px;color:var(--dim);">${summary(count("running"), count("waiting"), count("ready"), count("idle"))}</span>
  </div>
  <div style="padding:2px 14px 14px;">
    ${s.sessions.length === 0 ? emptySessions() : renderGroups(s.sessions, collapsed)}
  </div>
  ${limits(s.usage)}
  ${awakeSection(s.sleep)}
  ${notifySection(s.notify)}`;
}

function summary(run: number, wait: number, ready: number, idle: number): string {
  const parts: string[] = [];
  if (wait > 0) parts.push(`${wait} <span style="color:var(--warn);">waiting</span>`);
  if (ready > 0) parts.push(`${ready} <span style="color:var(--blue);">ready</span>`);
  parts.push(`${run} <span style="color:var(--green);">running</span>`);
  if (idle > 0) parts.push(`${idle} idle`);
  return parts.join(" · ");
}

/* ─────────────────────────── keep-awake (segmented) ─────────────────────────── */

function awakeSection(sleep: HudState["sleep"]): string {
  // Map our two booleans to the one escalating choice the user actually makes.
  const level = sleep.clamshell ? 2 : sleep.idleAwake ? 1 : 0;
  const lines = [
    "Sleeps normally — agents pause when the Mac does.",
    "Awake while the lid’s open — sleeps when you close it.",
    "Awake even with the lid closed (clamshell mode).",
  ];
  const seg = (lbl: string, lvl: number) => {
    const active = lvl === level;
    // Active segment sits on the strong-blue pill → white, bold, for contrast.
    const color = active ? "#fff" : "var(--vscode-foreground)";
    return `<button data-level="${lvl}" style="position:relative;z-index:1;flex:1;padding:7px 6px;border:none;background:transparent;border-radius:6px;cursor:pointer;font-family:inherit;font-size:11px;font-weight:${active ? 700 : 600};color:${color};transition:color .16s ease;">${lbl}</button>`;
  };
  return `<div class="hud-sec">
    <div style="font-size:10px;letter-spacing:.11em;color:var(--dim);margin-bottom:8px;">KEEP MAC AWAKE</div>
    <div style="position:relative;display:flex;padding:3px;background:var(--widget);border:1px solid var(--border);border-radius:8px;">
      <div style="position:absolute;top:3px;bottom:3px;left:3px;width:calc((100% - 6px)/3);border-radius:6px;background:var(--accent);transform:translateX(${level * 100}%);transition:transform .16s ease;"></div>
      ${seg("Sleep", 0)}${seg("Awake", 1)}${seg("Always", 2)}
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-top:9px;font-size:11px;">
      <span style="width:7px;height:7px;border-radius:50%;flex:none;background:${level > 0 ? "var(--green)" : "var(--dim)"};opacity:${level > 0 ? 1 : 0.5};"></span>
      <span style="color:var(--dim);line-height:1.4;">${lines[level]}</span>
    </div>
  </div>`;
}

/* ─────────────────────────── notifications (segmented) ─────────────────────────── */

function notifySection(notify: HudState["notify"]): string {
  const level = notify?.level ?? "waiting";
  const idx = level === "off" ? 0 : level === "waiting" ? 1 : 2;
  const lines = [
    "No pop-ups.",
    "Pings you when an agent needs you.",
    "Pings on needs-you and finished turns.",
  ];
  const seg = (lbl: string, i: number, value: string) => {
    const active = i === idx;
    const color = active ? "#fff" : "var(--vscode-foreground)";
    return `<button data-notify="${value}" style="position:relative;z-index:1;flex:1;padding:7px 6px;border:none;background:transparent;border-radius:6px;cursor:pointer;font-family:inherit;font-size:11px;font-weight:${active ? 700 : 600};color:${color};transition:color .16s ease;">${lbl}</button>`;
  };
  return `<div class="hud-sec">
    <div style="font-size:10px;letter-spacing:.11em;color:var(--dim);margin-bottom:8px;">NOTIFY</div>
    <div style="position:relative;display:flex;padding:3px;background:var(--widget);border:1px solid var(--border);border-radius:8px;">
      <div style="position:absolute;top:3px;bottom:3px;left:3px;width:calc((100% - 6px)/3);border-radius:6px;background:var(--accent);transform:translateX(${idx * 100}%);transition:transform .16s ease;"></div>
      ${seg("Off", 0, "off")}${seg("Waiting", 1, "waiting")}${seg("All", 2, "all")}
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-top:9px;font-size:11px;">
      <span style="width:7px;height:7px;border-radius:50%;flex:none;background:${idx > 0 ? "var(--green)" : "var(--dim)"};opacity:${idx > 0 ? 1 : 0.5};"></span>
      <span style="color:var(--dim);line-height:1.4;">${lines[idx]}</span>
    </div>
  </div>`;
}

/* ─────────────────────────── repo groups ─────────────────────────── */

/** Ordering priority — most "needs you" first: waiting → ready → running → idle. */
function statusRank(st: Session["status"]): number {
  return st === "waiting" ? 0 : st === "ready" ? 1 : st === "running" ? 2 : 3;
}

function renderGroups(sessions: Session[], collapsed: Set<string>): string {
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

  return ordered
    .map(({ project, rows }) => {
      const isOpen = !collapsed.has(project);
      const body = isOpen
        ? `<div style="display:flex;flex-direction:column;gap:3px;">${rows.map(renderRow).join("")}</div>`
        : "";
      return `${groupHeader(project, rows, isOpen)}${body}`;
    })
    .join("");
}

function groupHeader(project: string, rows: Session[], open: boolean): string {
  const chevron = open ? "▾" : "▸"; // ▾ / ▸
  return `<button data-group="${esc(project)}" class="grp-head" title="${open ? "Collapse" : "Expand"} ${esc(project)}">
    <span style="color:var(--dim);font-size:9px;width:9px;flex:none;">${chevron}</span>
    <span class="mono-chip sans" style="background:${monoColor(project)};">${esc(monogram(project))}</span>
    <span class="grp-name sans" style="font-size:13px;font-weight:600;color:var(--vscode-foreground);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(project)}</span>
    <span style="flex:1;height:1px;background:var(--border);min-width:8px;"></span>
    ${rollup(rows)}
  </button>`;
}

/** Roll-up status chip for a group: its worst (most urgent) status. */
function rollup(rows: Session[]): string {
  const n = (st: Session["status"]) => rows.filter((r) => r.status === st).length;
  const chip = (text: string, color: string, dot: string) =>
    `<span style="display:inline-flex;align-items:center;gap:6px;font-size:10px;color:${color};flex:none;">${text}${dot}</span>`;
  const pulseDot = (color: string) =>
    `<span class="hud-pulse" style="width:7px;height:7px;border-radius:50%;background:${color};"></span>`;
  const solidDot = (color: string) =>
    `<span style="width:7px;height:7px;border-radius:50%;background:${color};"></span>`;

  if (n("waiting")) return chip(`${n("waiting")} waiting`, "var(--warn)", pulseDot("var(--warn)"));
  if (n("ready")) return chip(`${n("ready")} ready`, "var(--blue)", `<span style="font-size:9px;">◆</span>`);
  if (n("running")) return chip(`${n("running")} running`, "var(--green)", solidDot("var(--green)"));
  return chip(`${rows.length} idle`, "var(--dim)", solidDot("var(--dim)"));
}

/** Stable colored monogram from the repo name (hashed → palette). */
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

/* ─────────────────────────── session rows ─────────────────────────── */

function renderRow(x: Session): string {
  if (x.status === "waiting") return waitingCard(x);
  if (x.status === "ready") return readyRow(x);
  if (x.status === "running") return runningRow(x);
  return idleRow(x);
}

/** Row label = the session's task within the repo (the repo is in the header). */
function label(x: Session): string {
  return x.name || `session ${x.sessionId.slice(0, 6)}`;
}

function waitingCard(x: Session): string {
  const msg = x.lastMessage || "Claude needs your input";
  return `<div class="hud-glow hud-go" data-goto="${esc(x.sessionId)}" title="Go to this session's terminal" style="border:1px solid color-mix(in srgb,var(--warn) 48%,transparent);border-left:2px solid var(--warn);background:color-mix(in srgb,var(--warn) 13%,transparent);border-radius:9px;overflow:hidden;">
    <div style="display:flex;align-items:center;gap:11px;padding:9px 12px;">
      <span style="display:inline-flex;align-items:center;gap:8px;width:80px;flex:none;color:var(--warn);">
        <span style="width:13px;display:inline-flex;justify-content:center;"><span class="hud-pulse" style="width:8px;height:8px;border-radius:50%;background:var(--warn);box-shadow:0 0 0 3px color-mix(in srgb,var(--warn) 22%,transparent);"></span></span>
        <span style="font-size:11px;font-weight:700;">waiting</span>
      </span>
      <span class="hud-name" style="color:var(--vscode-foreground);font-weight:600;">${esc(label(x))}</span>
      <span class="hud-age">${relAge(x.updatedAt)}</span>
    </div>
    <div style="display:flex;align-items:center;gap:9px;margin:0 12px 11px;padding:8px 10px;background:var(--widget);border:1px solid var(--border);border-radius:7px;">
      <span style="color:var(--dim);letter-spacing:-2px;font-size:14px;flex:none;line-height:1;">⠿</span>
      <span class="hud-name" style="font-size:11.5px;color:var(--vscode-foreground);">${esc(msg)}</span>
      <span style="margin-left:auto;font-size:10px;color:var(--warn);font-weight:700;letter-spacing:.04em;flex:none;">RESPOND →</span>
    </div>
  </div>`;
}

function runningRow(x: Session): string {
  const delays = ["0s", ".18s", ".36s"];
  const bars = delays
    .map((d) => `<span class="hud-eqbar" style="background:var(--green);animation-delay:${d};"></span>`)
    .join("");
  return `<div class="hud-row hud-go" data-goto="${esc(x.sessionId)}" title="Go to this session's terminal" style="border-left:2px solid var(--green);">
    <span class="hud-label" style="color:var(--green);">
      <span style="width:13px;display:inline-flex;align-items:flex-end;justify-content:center;gap:2px;height:11px;">${bars}</span>
      <span style="font-size:11px;">running</span>
    </span>
    <span class="hud-name" style="color:var(--vscode-foreground);">${esc(label(x))}</span>
    <span class="hud-goto">↪</span>
    <span class="hud-age">${relAge(x.updatedAt)}</span>
  </div>`;
}

function readyRow(x: Session): string {
  return `<div class="hud-row hud-go" data-goto="${esc(x.sessionId)}" title="Go to this session's terminal" style="border-left:2px solid var(--blue);">
    <span class="hud-label" style="color:var(--blue);">
      <span style="width:13px;display:inline-flex;justify-content:center;font-size:9px;line-height:1;">◆</span>
      <span style="font-size:11px;">ready</span>
    </span>
    <span class="hud-name" style="color:var(--vscode-foreground);">${esc(label(x))}</span>
    <span style="margin-left:auto;display:inline-flex;align-items:center;gap:9px;flex:none;">
      <span class="hud-goto">↪</span>
      <span style="font-size:10px;color:var(--blue);font-weight:600;letter-spacing:.03em;">your move</span>
      <span class="hud-age">${relAge(x.updatedAt)}</span>
    </span>
  </div>`;
}

function idleRow(x: Session): string {
  return `<div class="hud-row hud-go" data-goto="${esc(x.sessionId)}" title="Go to this session's terminal" style="border-left:2px solid var(--border);">
    <span class="hud-label" style="color:var(--dim);">
      <span style="width:13px;display:inline-flex;justify-content:center;"><span style="width:7px;height:7px;border-radius:50%;border:1.5px solid var(--dim);opacity:.55;"></span></span>
      <span style="font-size:11px;">idle</span>
    </span>
    <span class="hud-name">${esc(label(x))}</span>
    <span class="hud-goto">↪</span>
    <span class="hud-age">${relAge(x.updatedAt)}</span>
  </div>`;
}

function emptySessions(): string {
  return `<div style="padding:14px 4px;color:var(--dim);font-size:11.5px;text-align:center;">no active sessions</div>`;
}

/* ─────────────────────────── limits ─────────────────────────── */

function limits(usage: HudState["usage"]): string {
  if (!usage.session && !usage.weekly) {
    return `<div class="hud-sec">
      <div style="font-size:10px;letter-spacing:.11em;color:var(--dim);margin-bottom:6px;">CLAUDE CODE LIMITS</div>
      <div style="font-size:11px;color:var(--dim);">no data yet · statusline pushes while a session is live</div>
    </div>`;
  }
  return `<div class="hud-sec">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:9px;">
      <span style="font-size:10px;letter-spacing:.11em;color:var(--dim);">CLAUDE CODE LIMITS</span>
      <span style="margin-left:auto;font-size:10px;color:var(--dim);">via ${usage.source}</span>
    </div>
    ${usage.session ? gaugeRow("5h", usage.session) : ""}
    ${usage.weekly ? gaugeRow("7d", usage.weekly, true) : ""}
  </div>`;
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
  return `<div style="display:flex;align-items:center;gap:10px;font-size:11.5px;${spaced ? "margin-top:6px;" : ""}">
    <span style="color:var(--dim);width:20px;flex:none;">${tag}</span>
    <span class="gauge" style="color:${color};">${bar}</span>
    <span style="font-variant-numeric:tabular-nums;width:34px;flex:none;">${Math.round(pct)}%</span>
    <span style="margin-left:auto;color:var(--dim);flex:none;">${reset}</span>
  </div>`;
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
