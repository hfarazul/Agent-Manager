# Agent HUD

A lightweight, local macOS system that gives a glanceable view + control over running **Claude Code** agents. It does three things:

1. **Sessions** — which Claude Code agents are running, and crucially **which one needs you** (waiting on a permission prompt or a question).
2. **Keep-awake** — keep the Mac awake so agents keep running, including with the **lid closed**.
3. **Limits** — current 5-hour and 7-day Claude Code rate-limit usage.

It only *observes and toggles sleep* — it never spawns or owns the agents (you launch those from your editor/terminal as usual).

## Architecture

Three decoupled layers (see [`vision.md`](./vision.md) for the full spec):

```
Claude Code (hooks + statusLine)  ──▶  Daemon (localhost :7842)  ──▶  Cursor/VS Code sidebar view
   the control surface                  single source of truth         thin client (WS push)
```

- **`packages/daemon`** — Node + TypeScript + Fastify. Runs under `launchd`, owns sleep state (`caffeinate` + `pmset`), ingests Claude Code hook events into a session table, collects usage from the statusLine, and serves `/state` + a WebSocket `/events` stream.
- **`packages/vscode-extension`** — TypeScript Cursor/VS Code extension. A sidebar webview ("Console" design) + a status-bar item; a thin client of the daemon.

### Session states

`waiting` (blocked on a permission prompt or `AskUserQuestion`) · `ready` (finished a turn, your move) · `running` (working) · `idle` (untouched a while).

## Requirements

- **macOS** (uses `caffeinate`, `pmset`, `launchd`, `osascript`).
- **Node ≥ 20** (`node`/`npm` on `PATH`).
- **Cursor or VS Code**, with its shell command installed so `cursor` (or `code`)
  works in a terminal — in the editor: `Cmd+Shift+P → "Shell Command: Install
  'cursor'/'code' command in PATH"`. The extension installer needs it.
- **Claude Code ≥ v2.1.80** (for the `rate_limits` usage data). The hooks work on
  any recent version; only the Limits panel needs this.
- *Optional:* [`terminal-notifier`](https://github.com/julienXX/terminal-notifier)
  (`brew install terminal-notifier`) for **clickable** notifications that jump to
  the session. Without it, notifications fall back to a plain `osascript` banner.
- *Optional:* the [**Codex CLI**](https://developers.openai.com/codex) if you also
  want Codex sessions in the HUD (see [Codex](#codex-optional)).

## Install

One command does everything — prerequisite checks, daemon + hooks, and the
editor extension:

```bash
git clone https://github.com/hfarazul/Agent-Manager.git
cd Agent-Manager
./install.sh
# then reload the editor: Cmd+Shift+P → "Developer: Reload Window"
```

It's idempotent — re-run it after `git pull` to update. Under the hood it runs
`setup/install.sh` (daemon + hooks) then builds and installs the extension; you
can run those two steps individually if you prefer.

`setup/install.sh` resolves this machine's paths/user from templates, generates
`~/Library/LaunchAgents/com.agent-hud.daemon.plist` from
[`setup/com.agent-hud.daemon.plist.template`](./setup/com.agent-hud.daemon.plist.template),
loads the service, and merges the hooks + statusLine idempotently (safe to re-run).
Hooks wired: `SessionStart`, `SessionEnd`, `Notification`, `Stop`,
`UserPromptSubmit`, `PreToolUse` → `POST :7842/hook`; statusLine
(`setup/statusline.mjs`) → `POST :7842/usage/statusline`.

Then **one optional manual step** for clamshell (lid-closed) keep-awake, which
needs root — `install.sh` prints the exact command with the generated file:

```bash
sudo install -m 0440 <generated> /etc/sudoers.d/agent-hud && sudo visudo -cf /etc/sudoers.d/agent-hud
```

Skip it and everything works except the "Always" (lid-closed) keep-awake level.

## Using it

Open the **Agent HUD** view from the Activity Bar (the equalizer icon). Launch
Claude Code as you normally do in the editor's integrated terminal — sessions
appear automatically, grouped into per-repo cards:

- **Which one needs you** — a card shows a warm left edge when a session is
  `waiting` (amber) or `ready` (blue). Each session is one line: status · task ·
  `respond ↵` / `your move` · age.
- **Click a session** to jump to its terminal tab (works across editor windows).
- **Keep Mac awake** — `Sleep` / `Awake` / `Always` (lid-closed needs the sudoers
  step).
- **Notify** — `Off` / `Waiting` / `All`; clicking a notification jumps to the
  session (with `terminal-notifier`).
- **Limits** — 5h / weekly usage for Claude Code (and Codex, if used).

The footer sections collapse from their `▾` headers.

## Codex (optional)

If you use the **Codex CLI** (in a terminal, not the IDE extension), `install.sh`
appends matching hooks to `~/.codex/config.toml` (backed up). Codex sessions then
show in the HUD with their own task names and a separate **CODEX LIMITS** panel.
On first run Codex will prompt you to **trust** the hooks — approve once. Hooks
fire in interactive Codex, not `codex exec`.

## Notes

Set `AGENT_HUD_DEBUG=1` on the daemon to capture raw hook/statusLine payloads
(size-capped) under `$TMPDIR` for schema debugging. The daemon listens on
loopback only and rejects any request carrying a browser `Origin` / non-local
`Host`, so a web page can't reach it.

## Development

```bash
# daemon: edit, rebuild, restart the service
cd packages/daemon && npm run build
launchctl kickstart -k gui/$(id -u)/com.agent-hud.daemon
tail -f ~/Library/Logs/agent-hud/daemon.err.log

# extension: edit, then one command to build + package + install
cd packages/vscode-extension && npm run release
# then: Cmd+Shift+P → Developer: Reload Window
```
