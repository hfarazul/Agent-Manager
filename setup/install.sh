#!/usr/bin/env bash
# agent-hud installer — resolves this machine's paths/user and installs the
# launchd service, Claude Code hooks + statusLine, and prints the sudoers
# command for clamshell sleep. Idempotent and safe to re-run.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
DAEMON="$REPO/packages/daemon"
USER_NAME="$(whoami)"
NODE_BIN="$(command -v node || true)"
[ -n "$NODE_BIN" ] && NODE_BIN="$(cd "$(dirname "$NODE_BIN")" && pwd)/$(basename "$NODE_BIN")"
LOG_DIR="$HOME/Library/Logs/agent-hud"
PLIST_DST="$HOME/Library/LaunchAgents/com.agent-hud.daemon.plist"

if [ -z "$NODE_BIN" ]; then echo "node not found on PATH." >&2; exit 1; fi

echo "▸ repo:  $REPO"
echo "▸ node:  $NODE_BIN"
echo "▸ user:  $USER_NAME"

# 1. Build the daemon.
echo "▸ building daemon…"
( cd "$DAEMON" && npm install --silent && npm run build --silent )

# 2. Generate + install the launchd plist.
mkdir -p "$LOG_DIR" "$(dirname "$PLIST_DST")"
sed \
  -e "s|__NODE_BIN__|$NODE_BIN|g" \
  -e "s|__DAEMON_DIST__|$DAEMON/dist/index.js|g" \
  -e "s|__WORKDIR__|$DAEMON|g" \
  -e "s|__PATH__|$(dirname "$NODE_BIN"):/usr/bin:/bin:/usr/sbin:/sbin|g" \
  -e "s|__LOG_OUT__|$LOG_DIR/daemon.out.log|g" \
  -e "s|__LOG_ERR__|$LOG_DIR/daemon.err.log|g" \
  "$REPO/setup/com.agent-hud.daemon.plist.template" > "$PLIST_DST"
echo "▸ wrote $PLIST_DST"

# 3. (Re)load the service. bootout is async, so give it a beat before
#    bootstrap (a race shows up as "Input/output error 5"); retry once.
UID_NUM="$(id -u)"
launchctl bootout "gui/$UID_NUM/com.agent-hud.daemon" 2>/dev/null || true
sleep 1
if ! launchctl bootstrap "gui/$UID_NUM" "$PLIST_DST" 2>/dev/null; then
  sleep 2
  launchctl bootstrap "gui/$UID_NUM" "$PLIST_DST"
fi
echo "▸ launchd service loaded"

# 4. Merge Claude Code hooks + statusLine into ~/.claude/settings.json (backed up).
echo "▸ wiring Claude Code hooks + statusLine…"
SETTINGS="$HOME/.claude/settings.json"
mkdir -p "$HOME/.claude"
[ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"
cp "$SETTINGS" "$SETTINGS.bak.$(date +%s)"
REPO="$REPO" node <<'NODE'
const fs = require('fs');
const p = require('os').homedir() + '/.claude/settings.json';
const s = JSON.parse(fs.readFileSync(p, 'utf8'));
const CURL = "curl -s --max-time 2 -X POST http://localhost:7842/hook -H 'Content-Type: application/json' -d @- || true";
const entry = { hooks: [{ type: 'command', command: CURL }] };
const has = (arr) => arr.some(g => (g.hooks || []).some(h => typeof h.command === 'string' && h.command.includes('/hook')));
s.hooks ||= {};
for (const ev of ['SessionStart','SessionEnd','Notification','Stop','UserPromptSubmit','PreToolUse']) {
  s.hooks[ev] ||= [];
  if (!has(s.hooks[ev])) s.hooks[ev].push(JSON.parse(JSON.stringify(entry)));
}
s.statusLine = { type: 'command', command: 'node ' + process.env.REPO + '/setup/statusline.mjs' };
fs.writeFileSync(p, JSON.stringify(s, null, 2) + '\n');
console.log('  hooks:', Object.keys(s.hooks).join(', '));
NODE

# 5. Clamshell (lid-closed) keep-awake needs a scoped sudoers drop-in (root).
SUDOERS_TMP="$(mktemp)"
sed "s|__USER__|$USER_NAME|g" "$REPO/setup/sudoers-agent-hud.template" > "$SUDOERS_TMP"
echo
echo "▸ DONE. The daemon is running and hooks are wired."
echo
echo "  One manual step for clamshell (lid-closed) keep-awake — needs root:"
echo "    sudo install -m 0440 '$SUDOERS_TMP' /etc/sudoers.d/agent-hud && sudo visudo -cf /etc/sudoers.d/agent-hud"
echo
echo "  Then install the editor extension:"
echo "    cd '$REPO/packages/vscode-extension' && npm install && npm run release"
