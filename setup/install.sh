#!/usr/bin/env bash
# agent-hud installer — resolves this machine's paths/user and installs the
# launchd service, Claude Code hooks + statusLine, and prints the sudoers
# command for clamshell sleep. Idempotent and safe to re-run.
set -euo pipefail

NO_CODEX=0
RUN_SUDOERS=0
while [ $# -gt 0 ]; do
  case "$1" in
    --no-codex) NO_CODEX=1 ;;
    --sudoers)  RUN_SUDOERS=1 ;;
    -h|--help)
      cat <<'EOF'
Usage: setup/install.sh [--no-codex] [--sudoers]
  --no-codex   skip wiring Codex hooks even if ~/.codex exists
  --sudoers    enable lid-closed keep-awake (runs a sudo step; prompts for password)
EOF
      exit 0 ;;
    *) echo "unknown flag: $1 (see --help)" >&2; exit 1 ;;
  esac
  shift
done

REPO="$(cd "$(dirname "$0")/.." && pwd)"
DAEMON="$REPO/packages/daemon"
USER_NAME="$(whoami)"
NODE_BIN="$(command -v node || true)"
[ -n "$NODE_BIN" ] && NODE_BIN="$(cd "$(dirname "$NODE_BIN")" && pwd)/$(basename "$NODE_BIN")"
LOG_DIR="$HOME/Library/Logs/agent-hud"
PLIST_DST="$HOME/Library/LaunchAgents/com.agent-hud.daemon.plist"

if [ -z "$NODE_BIN" ]; then echo "node not found on PATH." >&2; exit 1; fi

echo "🤖 AI agent? Follow agentic-install.md for the guided, verified flow."
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
// Forwarder script: captures the terminal PID chain (for click-to-session) then
// POSTs to /hook. Replaces the older inline `curl … /hook` one-liner.
const FWD = 'node ' + process.env.REPO + '/setup/hook.mjs || true';
const entry = { hooks: [{ type: 'command', command: FWD }] };
// Identify OUR hook entries (old curl-to-/hook OR the forwarder) so we can
// upgrade idempotently — without disturbing the user's other hooks (e.g. their
// own osascript notifications, which never reference /hook).
const isOurs = (h) => typeof h.command === 'string' &&
  (h.command.includes(':7842/hook') || h.command.includes('/setup/hook.mjs'));
s.hooks ||= {};
for (const ev of ['SessionStart','SessionEnd','Notification','Stop','UserPromptSubmit','PreToolUse']) {
  s.hooks[ev] ||= [];
  // Drop any prior agent-hud entry (curl or forwarder), keep everything else.
  s.hooks[ev] = s.hooks[ev]
    .map(g => ({ ...g, hooks: (g.hooks || []).filter(h => !isOurs(h)) }))
    .filter(g => (g.hooks || []).length > 0);
  s.hooks[ev].push(JSON.parse(JSON.stringify(entry)));
}
s.statusLine = { type: 'command', command: 'node ' + process.env.REPO + '/setup/statusline.mjs' };
fs.writeFileSync(p, JSON.stringify(s, null, 2) + '\n');
console.log('  hooks:', Object.keys(s.hooks).join(', '));
NODE

# 4b. Wire Codex CLI hooks (optional) — same forwarder, tagged `codex`. Codex
#     reads ~/.codex/config.toml; we append array-of-tables hook entries (valid
#     TOML at EOF) once, with a backup. Skipped if Codex isn't installed.
CODEX_CFG="$HOME/.codex/config.toml"
if [ "$NO_CODEX" -eq 1 ]; then
  echo "▸ Codex hooks skipped (--no-codex)"
elif [ -d "$HOME/.codex" ]; then
  echo "▸ wiring Codex hooks…"
  mkdir -p "$HOME/.codex"; [ -f "$CODEX_CFG" ] || : > "$CODEX_CFG"
  if grep -q "hook.mjs codex" "$CODEX_CFG" 2>/dev/null; then
    echo "  already wired"
  else
    cp "$CODEX_CFG" "$CODEX_CFG.bak.$(date +%s)" 2>/dev/null || true
    {
      echo ""
      echo "# --- agent-hud (Codex → HUD) ---"
      for EV in SessionStart UserPromptSubmit PreToolUse PostToolUse PermissionRequest Stop; do
        echo "[[hooks.$EV]]"
        echo "[[hooks.$EV.hooks]]"
        echo 'type = "command"'
        echo "command = '$NODE_BIN $REPO/setup/hook.mjs codex'"
        echo ""
      done
    } >> "$CODEX_CFG"
    echo "  wired → $CODEX_CFG (Codex will prompt to trust the hooks on first run)"
  fi
else
  echo "▸ Codex not detected (~/.codex absent) — skipping Codex hooks"
fi

# 5. Clamshell (lid-closed) keep-awake needs a scoped sudoers drop-in (root).
SUDOERS_TMP="$(mktemp)"
sed "s|__USER__|$USER_NAME|g" "$REPO/setup/sudoers-agent-hud.template" > "$SUDOERS_TMP"
echo
echo "▸ DONE. The daemon is running and hooks are wired."
echo
if [ "$RUN_SUDOERS" -eq 1 ]; then
  echo "▸ enabling lid-closed keep-awake (needs your password)…"
  if sudo install -m 0440 "$SUDOERS_TMP" /etc/sudoers.d/agent-hud && sudo visudo -cf /etc/sudoers.d/agent-hud; then
    echo "  ✓ clamshell keep-awake enabled"
  else
    echo "  ✗ sudoers step failed — lid-closed keep-awake is off (re-run with --sudoers)." >&2
  fi
else
  echo "  Optional — lid-closed keep-awake (needs root). Run with --sudoers to do it"
  echo "  automatically, or run this yourself:"
  echo "    sudo install -m 0440 '$SUDOERS_TMP' /etc/sudoers.d/agent-hud && sudo visudo -cf /etc/sudoers.d/agent-hud"
fi
