#!/usr/bin/env bash
# Agent HUD — one-command install.
#
# Does the whole thing: prerequisite checks → daemon + Claude/Codex hooks
# (setup/install.sh) → build + install the editor extension. Idempotent; safe to
# re-run after pulling updates.
#
#   git clone https://github.com/hfarazul/Agent-Manager.git
#   cd Agent-Manager && ./install.sh [flags]
#
# Flags let an agent honor the user's choices (see agentic-install.md):
#   --no-extension   daemon + hooks only (skip the editor extension)
#   --no-codex       don't wire Codex hooks even if ~/.codex exists
#   --sudoers        also enable lid-closed keep-awake (runs a sudo step)
#   -h, --help       show help
set -euo pipefail

REPO="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO"

bold() { printf "\033[1m%s\033[0m\n" "$1"; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; }
warn() { printf "  \033[33m!\033[0m %s\n" "$1"; }
die()  { printf "  \033[31m✗ %s\033[0m\n" "$1" >&2; exit 1; }

print_help() {
  cat <<'EOF'
Agent HUD installer

Usage: ./install.sh [flags]

  --no-extension   Install daemon + hooks only (skip the editor extension UI)
  --no-codex       Don't wire Codex hooks even if ~/.codex exists
  --sudoers        Also enable lid-closed keep-awake — runs a sudo step that
                   prompts for your password. Without it, the command is printed.
  -h, --help       Show this help

No flags = everything recommended: daemon + hooks + extension (Codex hooks too
if ~/.codex exists). The lid-closed sudo step is printed unless --sudoers.

AI agents: follow agentic-install.md — ask the user up front, then pass the
matching flags here.
EOF
}

NO_EXTENSION=0
RAN_SUDOERS=0
SETUP_ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --no-extension) NO_EXTENSION=1 ;;
    --no-codex)     SETUP_ARGS+=(--no-codex) ;;
    --sudoers)      SETUP_ARGS+=(--sudoers); RAN_SUDOERS=1 ;;
    -h|--help)      print_help; exit 0 ;;
    *)              die "unknown flag: $1 (see --help)" ;;
  esac
  shift
done

bold "▸ Agent HUD installer"
echo "  🤖 AI agent? Follow agentic-install.md for the guided, verified flow."
echo

bold "▸ Checking prerequisites"
[ "$(uname)" = "Darwin" ] || die "Agent HUD is macOS-only (needs caffeinate/pmset/launchd)."
command -v node >/dev/null || die "node not found. Install Node ≥ 20 and retry."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "Node ≥ 20 required (found $(node -v))."
ok "macOS + Node $(node -v)"

if [ "$NO_EXTENSION" -eq 0 ]; then
  # The extension installer (install-to-cursor.sh) finds the CLI on PATH OR in the
  # app bundle — mirror that detection so we don't warn when it'll actually work.
  EDITOR_CLI=""
  for c in cursor code \
    "/Applications/Cursor.app/Contents/Resources/app/bin/cursor" \
    "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"; do
    if command -v "$c" >/dev/null 2>&1 || [ -x "$c" ]; then EDITOR_CLI="$c"; break; fi
  done
  if [ -n "$EDITOR_CLI" ]; then
    ok "editor CLI: $(basename "$EDITOR_CLI")"
  else
    warn "No Cursor/VS Code CLI found — the extension step may need a manual VSIX install."
    warn "In the editor: Cmd+Shift+P → \"Shell Command: Install 'cursor'/'code' command in PATH\"."
  fi
fi
command -v terminal-notifier >/dev/null \
  && ok "terminal-notifier present (clickable notifications)" \
  || warn "terminal-notifier not found — notifications fall back to plain banners (brew install terminal-notifier)."
[ -d "$HOME/.codex" ] && ok "Codex detected" || true

echo
bold "▸ Installing daemon + hooks"
"$REPO/setup/install.sh" ${SETUP_ARGS[@]+"${SETUP_ARGS[@]}"}

if [ "$NO_EXTENSION" -eq 1 ]; then
  echo
  warn "Skipped the editor extension (--no-extension)."
else
  echo
  bold "▸ Building + installing the editor extension"
  ( cd "$REPO/packages/vscode-extension" && npm install --silent && npm run release )
fi

echo
bold "▸ Done."
[ "$NO_EXTENSION" -eq 0 ] && echo "  Reload your editor windows:  Cmd+Shift+P → \"Developer: Reload Window\""
[ "$NO_EXTENSION" -eq 0 ] && echo "  Then open the Agent HUD view from the Activity Bar (equalizer icon)."
[ "$RAN_SUDOERS" -eq 0 ] && echo "  Lid-closed keep-awake: run the sudoers command printed above, or re-run with --sudoers."
