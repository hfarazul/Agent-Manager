# Future Features

Planned enhancements for Agent HUD. Both build on the existing daemon → WS → client
pipeline (see [`vision.md`](./vision.md) and [`README.md`](./README.md)); neither
requires the daemon to own or spawn agents.

---

## 1. Pop-up notifications ✅ SHIPPED

**Status:** built and verified. Implementation as shipped:

- **Daemon-side, single source.** Fired from the daemon (`notify.ts` + `notifier.ts`),
  not per-window — so multiple editor windows don't each pop a copy, and it works
  when the editor is backgrounded. `notifier.ts` diffs store snapshots and fires on
  the EDGE into `waiting` (and `ready` at level `all`), deduped per session.
- **Clickable → jump.** Uses `terminal-notifier` with `-execute` POSTing `/focus`,
  which routes through the cross-window focus path (§2). Falls back to `osascript`
  (alert only) when terminal-notifier is absent.
- **Reliable sound + branding.** Sound via `afplay` (macOS gates terminal-notifier's
  own `-sound` behind per-app settings, so we play it ourselves); branded with the
  HUD app icon (`packages/daemon/assets/notify-icon.png`).
- **Levels + opt-out.** `off` / `waiting` / `all` (default `waiting`), toggled from a
  NOTIFY segmented control in the HUD → `POST /notify` → store. Env default
  `AGENT_HUD_NOTIFY`.
- **Gotcha learned:** terminal-notifier's `-group` SILENTLY replaces a prior
  notification (no re-banner/sound) — omitted, since the notifier already dedupes at
  the source, so a real re-wait must re-alert.
- The original `osascript` "display notification" hooks in `~/.claude/settings.json`
  were removed once this landed — the daemon is now the sole notification system.

Original notes below.

---

**Goal:** when a session flips to `waiting` (blocked on a permission prompt or an
`AskUserQuestion`/`ExitPlanMode`), surface a native OS notification so you don't
have to be watching the sidebar to know an agent needs you.

**Why:** the whole point of the HUD is *which one needs you* — but that signal is
only useful if it reaches you when the editor isn't focused. Today you have to be
looking at the panel.

**How it fits the architecture:**

- The daemon already knows the exact moment a session enters `waiting` — both the
  hook-driven permission case (`hooks.ts`) and the transcript-scanner question case
  (`attention.ts` → `store.setQuestionAttention`). The store emits `change` on every
  such transition.
- The client (`packages/vscode-extension`) already receives every state snapshot
  over the `/events` WebSocket. It can diff successive snapshots and fire a
  `vscode.window.showWarningMessage` (or a native notification) when a session
  transitions *into* `waiting`.

**Behaviour to nail down:**

- **Fire on the edge, not the level.** Notify only on the `→ waiting` transition, not
  on every snapshot where a session happens to be waiting (the WS pushes repeatedly).
  The client should track the previous status per `sessionId`.
- **Dedupe per session.** One notification per wait, not one per WS message.
- **Content.** Use `session.name` (task name from statusLine) + `projectName` +
  `lastMessage` (the permission text or "Claude is asking a question").
- **Action button.** The notification should offer a "Go to session" action — which
  is exactly feature #2.
- **Throttle / opt-out.** A setting (`agentHud.notifications`: `all` | `waiting-only`
  | `off`) so many parallel agents don't become a notification storm.

**Open question:** in-editor toast (`showWarningMessage`, simplest, no permissions)
vs. true OS notification (survives editor being backgrounded, but needs a notifier —
`terminal-notifier`, the daemon shelling out, or `node-notifier`). Edge case: lid
closed / display asleep while clamshell keep-awake is on — a banner is useless then,
so consider a sound or a Slack/push hook as a later escalation.

---

## 2. Click to go to the session ✅ SHIPPED

**Status:** built and verified, including cross-window. Implementation as shipped:

- **Identity via PID chain.** The hook forwarder (`setup/hook.mjs`) walks its own
  process ancestry and injects `agent_hud_ancestor_pids`. The integrated terminal's
  shell PID is in that chain and equals `terminal.processId`, so a row maps to its
  exact tab — unique even when two agents share a repo (`cwd` alone can't).
- **Same window:** `revealLocalTerminal()` matches `ancestorPids` against each
  `vscode.window.terminals[].processId` and calls `terminal.show(false)`.
- **Cross window:** the clicker POSTs `/focus`; the daemon broadcasts a focus frame
  over WS and waits ≤1.2s for a claim. The owning window reveals its tab and POSTs
  `/focus/claim {folder}`; the daemon raises that window via `cursor <folder>` (the
  editor CLI — no AppleScript/Accessibility). `/focus` returns `{claimed}` so the
  clicker toasts only when nobody could handle it.
- **Gotchas learned:** reinstalling the same extension version doesn't reload new
  code — bump the version (added a `vscode:prepublish` build guard). Window reload is
  safe for running agents (pty-host persists; shell PIDs unchanged).

Original notes below.

---

**Goal:** clicking a session row in the sidebar takes you straight to that Claude
Code agent — focus its terminal/window — so you can respond to the prompt without
hunting across windows and tabs.

**Why:** finding the *right* terminal among a dozen is the friction that makes
"which one needs you" only half-solved. Closing that loop (see it → jump to it) is
the natural completion of the HUD.

**How it fits the architecture:**

- Each `Session` already carries `cwd`, `projectName`, `sessionId`, and
  `transcriptPath` (`types.ts`). `cwd` is the strongest handle for locating the
  workspace/window the agent runs in.
- The panel webview (`panel.ts`) posts messages back to the extension host
  (`handleMessage` in `extension.ts`); a `goToSession` message with the `sessionId`
  is a small addition to the existing protocol.

**Implementation options (in rough order of feasibility):**

1. **Same-window terminal focus.** If the agent runs in an integrated terminal of
   the current VS Code/Cursor window, match it by `cwd` and call
   `terminal.show()`. Cheapest, works for the common single-window case.
2. **Open the workspace folder.** `vscode.commands.executeCommand('vscode.openFolder',
   Uri.file(cwd), { forceNewWindow: false })` to bring up the matching window if the
   agent's project is open elsewhere.
3. **Cross-window / external terminal.** Harder — VS Code can't focus another app's
   terminal directly. Fallback: copy `cwd` / a resume hint to the clipboard, or open
   the transcript (`transcriptPath`) read-only so you can see the pending question
   even if you can't jump to the live session.

**Behaviour to nail down:**

- Whole row is the click target; the sleep control and group-collapse chevrons stay
  as separate, non-propagating click zones.
- Visually prioritise `waiting` rows (they're the ones you'll click most).
- Pairs with feature #1: the notification's "Go to session" action calls the same
  code path.

**Open question:** can we reliably map a `sessionId` → a concrete editor window /
terminal? `cwd` is a good heuristic but not unique (two agents in the same repo).
May need the statusLine or a hook to report a window/terminal identifier if Claude
Code exposes one.

---

## 3. Support for Codex ✅ SHIPPED (CLI)

**Status:** built and verified for the **Codex CLI** (terminal). Implementation:

- **Same forwarder, tagged.** Codex's `config.toml` hooks run `hook.mjs codex`; the
  forwarder injects `agent_hud_agent` and matches the `codex` process for liveness.
  Codex's stdin payload uses the **same field names as Claude** (`session_id`,
  `hook_event_name`, `cwd`, `transcript_path`) — confirmed against a real payload —
  so `ingestHook` needed no parser changes.
- **Provenance.** `Session.agent: "claude-code" | "codex"`; a green **CDX** badge in
  the HUD. `upsertSession` now takes an options object to contain param growth.
- **Cleaner waiting.** `PermissionRequest → waiting` (no message-string heuristic).
  Codex has **no `SessionEnd`** event, so cleanup relies on liveness pruning (the
  `agentPid` check) — which works because the `codex` process dies on exit.
- **Reuses everything:** click-to-session works (the terminal shell PID is in the
  captured chain), notifications fire (the notifier is agent-agnostic), liveness
  keeps idle Codex sessions alive.
- **Task names.** Codex has no statusLine, so the row label is derived from the
  `UserPromptSubmit` `prompt` instead of "session 019ec8".
- **`install.sh`** appends the Codex hooks to `~/.codex/config.toml` (idempotent,
  backup), skipped if `~/.codex` is absent.

**Caveats learned:**
- Only the **CLI** is supported, not the Codex **IDE extension** (no terminal
  process / PID chain; its local state is undocumented sqlite + rollout JSONL).
- Hooks fire in **interactive** Codex, **not** `codex exec` (headless) — verified.
- Codex **prompts to trust** the hooks on first run; untrusted hooks are silently
  skipped.
- **Limits/usage** stays Claude-only (Codex has no `rate_limits` statusline).

Original notes below.

---

**Goal:** observe OpenAI **Codex CLI** sessions in the same HUD, side-by-side with
Claude Code agents — same session list, same `waiting`/`ready`/`running`/`idle`
states, same keep-awake and click-to-session behaviour.

**Why this is more tractable than it looks:** Codex CLI ships a hooks system that is
remarkably close to Claude Code's. Hooks are configured in `hooks.json` or inline
under `[hooks]` in `config.toml`, and — crucially — **the event payload is delivered
to the hook command via stdin as JSON**, exactly the mechanism the daemon already
ingests. The same `curl` forwarder pattern the install script wires for Claude Code
hooks works unchanged: pipe stdin to `POST :7842/hook`.

**Event mapping** (Codex → our `SessionStatus`):

| Codex event        | Maps to    | Notes |
|--------------------|------------|-------|
| `SessionStart`     | `running`  | also fires on resume |
| `UserPromptSubmit` | `running`  | same as Claude Code |
| `PreToolUse`       | `running`  | before Bash/apply_patch/MCP |
| `PostToolUse`      | `running`  | |
| `PermissionRequest`| `waiting`  | **cleaner than Claude Code** — a dedicated event for "about to ask for approval" (shell escalation, network), so no message-string classification needed |
| `Stop`             | `ready`    | turn ended, your move |
| `SubagentStart` / `SubagentStop` | — | could surface nested agents later |
| `PreCompact` / `PostCompact`     | — | ignore for status |

This means `STATUS_BY_EVENT` in `hooks.ts` largely generalises; the main additions are
a `PermissionRequest → waiting` entry and dropping the `Notification`-message heuristic
for the Codex path (it's not needed — the event itself is the signal).

**What needs an adapter / verification:**

- **Payload field names.** Our `ingestHook` reads `session_id`, `hook_event_name`,
  `cwd`, `transcript_path`, `message`. Codex exposes a `transcript_path` and runs hooks
  with the session's cwd, but the exact field keys (and the event-name field) need to be
  confirmed against a real Codex payload before assuming they match Claude Code's. The
  ingestion layer is already tolerant of unknown shapes, so the safe move is to add a
  small **per-agent normaliser** that maps a Codex payload onto our internal
  `HookPayload` rather than hard-coding either vendor's keys.
- **Agent provenance.** Add an `agent: "claude-code" | "codex"` field to `Session`
  (`types.ts`) so the UI can badge rows by tool. Set it from a query param or path on
  the forwarder (`POST :7842/hook?agent=codex`) — the daemon shouldn't have to sniff it.
- **The `waiting`-question scanner.** Codex's `PermissionRequest` covers approval
  prompts directly, so the transcript-tailing fallback in `attention.ts` (built for
  Claude's hook-less `AskUserQuestion`) may be unnecessary for Codex. Confirm whether
  Codex has any "needs you" state that fires *no* hook before deciding to extend the
  scanner. Note the docs warn the transcript format is **not a stable interface** — so
  prefer hooks over transcript parsing for Codex wherever possible.
- **Usage / Limits.** This is the real gap. The "Limits" feature is fed by Claude Code's
  statusLine `rate_limits` (`usage.ts`). Codex has no statusLine equivalent and its
  quota model is OpenAI-side, so the 5h/weekly windows won't populate for Codex
  sessions. Options: show usage only for Claude sessions, or source Codex usage
  separately later. The session list, states, notifications, and click-to-session all
  work for Codex regardless.

**Install impact:** `setup/install.sh` would gain a parallel step that merges the hook
entries into Codex's `config.toml` / `hooks.json` (with a backup, mirroring the
`~/.claude/settings.json` merge), pointing the same events at `:7842/hook?agent=codex`.

**Open question:** confirm the precise Codex hook payload schema (field names + the
event-name key) and whether `config.toml` hook merging can be done idempotently the way
the Claude settings merge is. Sources to verify against:
[Codex hooks](https://developers.openai.com/codex/hooks),
[Config reference](https://developers.openai.com/codex/config-reference),
[Advanced config](https://developers.openai.com/codex/config-advanced).

---

## Shared groundwork

Both features want the client to **diff snapshots** rather than just re-render the
latest one, and both lean on the same `Session` fields already flowing over the WS.
Worth landing the snapshot-diff + previous-status tracking once and reusing it for
notifications and for highlighting newly-changed rows.
