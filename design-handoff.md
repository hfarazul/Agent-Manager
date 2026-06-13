# Agent HUD — Design Handoff

**For:** a Claude design session
**Goal:** redesign the look & feel of the Agent HUD VS Code webview panel (and, secondarily, the status-bar item). Make the design calls yourself — this doc gives you the constraints and the data, not a prescription.

You own the visual design. Pick the layout, hierarchy, color logic, density, motion, empty/error states, and typography. The sections below are the *box you must stay inside* (the platform) and the *content you must show* (the data). Everything else is yours.

---

## 1. What this is

Agent HUD is a local macOS tool that gives a glanceable view + control over running **Claude Code** agents. The thing you're redesigning is its **VS Code webview panel** — a side panel inside VS Code / Cursor that shows three things and offers a couple of controls. It polls a local daemon every ~3–5s and re-renders.

It has three jobs, and the panel has one section for each:

1. **Sleep control** — toggle whether the Mac stays awake so agents keep running (two independent toggles: lid-open and lid-closed).
2. **Sessions** — the list of Claude Code agents, each with a status, and crucially **which one needs my attention** (waiting on a permission prompt / input).
3. **Usage** — rate-limit budget: a 5-hour "session" window and a 7-day "weekly" window, each a percent-used with a reset time.

The single most important job of the design: **make "an agent needs my attention" impossible to miss at a glance**, while staying calm and ignorable when nothing needs me. This is an ambient/peripheral tool — it lives open in a side panel all day. It should reward a glance, not demand attention unless something actually needs it.

---

## 2. What it looks like today (the thing to improve)

The current panel is a bare-bones first pass — uppercase section headers, two pill buttons, a flat session list with tiny colored dots, and two thin usage bars. It's functional but undesigned: weak hierarchy, no sense of state urgency, the attention state ("Claude is waiting for your input") looks identical in weight to "idle", and the usage bars are an afterthought. Treat the current screenshot as *the content inventory*, not a layout to preserve. You're free to completely rethink the arrangement.

Current sections, top to bottom: `SLEEP` (two buttons) → `SESSIONS (n)` (rows) → `USAGE` (two labeled bars).

---

## 3. Hard platform constraints (cannot be designed around)

This renders as **HTML/CSS inside a VS Code webview**. That imposes real limits — please design within them so the result is buildable as-is:

- **Single self-contained HTML string.** The whole panel is one `panelHtml()` function returning inline `<style>` + markup. No external CSS/JS/font/image files, no CDN, no web fonts. (An inline `<svg>` or `<style>`-driven asset is fine; a `<link>` to anything is not.)
- **Use VS Code theme variables, don't hardcode chrome colors.** The panel must look native in *both* light and dark themes and inherit the user's theme. Use CSS custom properties like:
  - `var(--vscode-foreground)`, `var(--vscode-font-family)`, `var(--vscode-font-size)`
  - `var(--vscode-editor-background)`, `var(--vscode-editorWidget-background)`
  - `var(--vscode-button-background)` / `--vscode-button-foreground` / `--vscode-button-hoverBackground`
  - `var(--vscode-progressBar-background)`, `var(--vscode-panel-border)`, `var(--vscode-descriptionForeground)`
  - For semantic status, prefer VS Code's own: `var(--vscode-charts-green/yellow/red/blue)`, `--vscode-testing-iconPassed`, `--vscode-editorWarning-foreground`, `--vscode-errorForeground`. You *may* hardcode a small set of status hues if you give each a light- and dark-theme-safe value, but lean on theme vars first.
- **Width is variable and often narrow.** The user docks this as a side panel — assume anything from ~280px to ~700px wide. Design fluid/responsive; no fixed pixel widths that break when narrow. The session rows especially must degrade gracefully (the "needs attention" message can be long).
- **The panel re-renders wholesale every poll (~3–5s).** The entire HTML is regenerated and swapped. So: CSS-only transitions survive fine, but any JS animation state resets each tick. Keep motion subtle and CSS-driven (e.g. a gentle pulse on the attention badge). Don't rely on JS animation that needs to persist across renders.
- **Interactivity is limited to `postMessage`.** Buttons/toggles send a message to the extension host; that's the only way to act. Keep interactive elements to what's listed in §5. No client-side routing, no forms beyond simple toggles.
- **Icons:** VS Code Codicons are available in the status bar via `$(name)` syntax but **not** automatically in the webview. In the webview, use inline SVG or unicode/emoji. Don't assume an icon font is present.

If a design idea needs something outside these limits, flag it as "would require X" rather than assuming it.

---

## 4. The data you're designing for

Every render gets a `HudState` snapshot (or `null` when the daemon is unreachable). Shape:

```ts
type SessionStatus = "running" | "idle" | "needs_attention";

interface Session {
  sessionId: string;
  projectName: string;     // e.g. "platform", "vscode-extension" — derived from cwd basename. NOT unique (see note)
  cwd: string;             // full working dir path, available if you want to disambiguate duplicates
  status: SessionStatus;
  lastMessage?: string;    // only meaningful when needs_attention, e.g. "Claude is waiting for your input"
  updatedAt: string;       // ISO timestamp — last event for this session
}

interface UsageWindow {
  usedPercent: number;     // 0–100, but CAN exceed 100 due to upstream bugs — clamp visually, see note
  resetsAt: number;        // Unix seconds (multiply by 1000 for JS Date)
}

interface HudState {
  sleep:   { idleAwake: boolean; clamshell: boolean };
  sessions: Session[];     // 0..N, realistically 0–10
  usage:   {
    session?: UsageWindow;       // 5-hour window — may be absent
    weekly?:  UsageWindow;       // 7-day window — may be absent
    weeklySonnet?: UsageWindow;  // optional secondary weekly window, often absent
    tokensToday?: number;        // optional enrichment, often absent
    costToday?:  number;         // optional enrichment, often absent
    source: "statusline" | "oauth" | "ccusage" | "none";  // "none" = no data yet
    updatedAt: string;
  };
}
```

**Data realities to design around (these shape the states you must handle):**

- **`projectName` is not unique.** Two agents can run in the same folder — note the screenshot shows `vscode-extension` twice. Don't rely on name as identity; you may want a secondary disambiguator (a short cwd tail, an index, or `updatedAt`-relative "2m ago"). Your call.
- **Sessions can be empty.** Design a real empty state, not blank space.
- **Usage can be entirely absent** (`source: "none"`, both windows undefined). statusLine only pushes usage *while a Claude Code session is live*, so on a fresh open there may be nothing. Design the "no usage data yet" state intentionally.
- **`usedPercent` can be buggy/>100.** Display it but never let it break layout (clamp the bar to 100%). Don't gate any behavior on it. A 2% and a 98% reading should *feel* obviously different — low usage calm, high usage warning-tinted. You decide the thresholds and color ramp.
- **`resetsAt` is Unix seconds.** Today it renders as a raw locale datetime (`13/06/2026, 23:20:00`) which is clunky. A relative countdown ("resets in 3h 12m") is probably friendlier — your call.
- **Disconnected state matters.** When the daemon is down, `state` is `null` / `connected:false`. Today it just says "Daemon not reachable on port 7842." Design this as a first-class state, not an error dump.

---

## 5. Controls (the only interactive elements)

Keep these — you can restyle, relabel, relocate, or merge them, but the two underlying actions must remain reachable:

1. **Toggle idle keep-awake (lid open)** — boolean. Label reflects current state ("Enable" vs "Disable"). On click, sends `{cmd:"idle", value:<new bool>}`.
2. **Toggle clamshell keep-awake (lid closed)** — boolean. Same pattern, `cmd:"clamshell"`.

These are *toggles*, not momentary buttons — the design should communicate on/off state clearly (today they're two pill buttons that don't visually read as "currently on"). A switch, a toggle-pill with an active state, segmented control — your choice. Consider showing a single clear "Mac is staying awake / sleeping normally" summary since the two toggles together determine one real-world outcome.

(There's also a status-bar quick-pick fallback for the same toggles — out of scope for the panel design, but don't remove the commands.)

---

## 6. The status-bar item (secondary, optional polish)

Besides the panel, the extension shows a one-line status-bar item (bottom of VS Code). It uses Codicon `$(name)` syntax and `·`-separated parts. Current format:

```
$(pulse) 3 · $(warning) 1 · $(eye) awake · 5h 38% · wk 62%
```

…i.e. running count, attention count (only if >0), sleep state, then the two usage percents. Disconnected shows `$(debug-disconnect) HUD`. If you want to propose a tighter/clearer string format that's still pure-text-with-`$(codicon)`, include it — but the panel is the priority.

---

## 7. What I want back from you

A buildable redesign of the panel, plus rationale. Concretely:

1. **A short rationale** — the design direction, the hierarchy you chose, and *how the attention state is made unmissable* without making the calm state noisy.
2. **The actual HTML/CSS** — a complete, drop-in `panelHtml(state, connected)` implementation (one self-contained string, theme-variable-driven, handling all the states in §4: normal, attention, idle-only, empty sessions, no-usage, disconnected). It can call small helpers; keep it in the spirit of the current single-file `panel.ts`.
3. **State coverage notes** — confirm each edge state is handled and how it looks.
4. *(Optional)* the status-bar string tweak from §6.

Design for the common case (a few sessions, one occasionally needing attention, low usage) but don't let the rare cases (10 sessions, 100%+ usage, disconnected, duplicate names) break the layout.

---

## 8. Taste notes (non-binding — overrule me if you have a better idea)

- This is a *peripheral/ambient* tool. Calm by default; loud only for attention. Think "good dashboard," not "busy app."
- Native-to-VS-Code is good — it should feel like part of the editor, not a bolted-on web app. But native ≠ bland; a confident, distinctive treatment within the theme is welcome.
- The attention state is the product. If a glance from across the room can tell me "one agent is waiting," the design succeeded.
- Density: lean compact (this is a tool for someone running many agents) but not cramped.
- Respect reduced-motion. Any pulse/animation should be subtle and gated behind `@media (prefers-reduced-motion: no-preference)`.

---

## 9. Reference files (in this repo)

- `vision.md` — full product spec (architecture, daemon, the "needs attention" ~85% gap, etc.). Read §8 for the original panel/status-bar intent.
- `packages/vscode-extension/src/panel.ts` — current panel HTML (the thing to replace).
- `packages/vscode-extension/src/format.ts` — current status-bar string.
- `packages/vscode-extension/src/types.ts` — the `HudState` types (source of truth for §4).
- `packages/vscode-extension/src/extension.ts` — how the panel is mounted and how `postMessage` toggles are wired (shows the interaction contract).
