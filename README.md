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

## Setup

```bash
# daemon
cd packages/daemon && npm install && npm run build

# launchd service (auto-start on login, auto-restart on crash)
cp ../../setup/com.agent-hud.daemon.plist ~/Library/LaunchAgents/   # see setup/ for the template
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.agent-hud.daemon.plist

# Claude Code wiring — merge the hooks + statusLine into ~/.claude/settings.json
#   hooks: SessionStart, SessionEnd, Notification, Stop, UserPromptSubmit, PreToolUse → POST :7842/hook
#   statusLine: setup/statusline.mjs → POST :7842/usage/statusline

# clamshell (lid-closed) keep-awake needs a scoped sudoers drop-in:
sudo install -m 0440 setup/sudoers-agent-hud /etc/sudoers.d/agent-hud

# extension — build, package, and install into Cursor/VS Code
cd ../vscode-extension && npm install && npm run release
```

Requires Claude Code **≥ v2.1.80** for the `rate_limits` (usage) data.

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
