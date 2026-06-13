# Future Features

Planned enhancements for Agent HUD. Both build on the existing daemon → WS → client
pipeline (see [`vision.md`](./vision.md) and [`README.md`](./README.md)); neither
requires the daemon to own or spawn agents.

---

## 1. Pop-up notifications

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

## 2. Click to go to the session

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

## 3. Support for Codex

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
