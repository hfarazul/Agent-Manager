#!/usr/bin/env bash
# Agent HUD — one-command install.
#
# Does the whole thing: prerequisite checks → daemon + Claude/Codex hooks
# (setup/install.sh) → build + install the editor extension. Idempotent; safe to
# re-run after pulling updates.
#
#   git clone https://github.com/hfarazul/Agent-Manager.git
#   cd Agent-Manager && ./install.sh
set -euo pipefail

REPO="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO"

bold() { printf "\033[1m%s\033[0m\n" "$1"; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; }
warn() { printf "  \033[33m!\033[0m %s\n" "$1"; }
die()  { printf "  \033[31m✗ %s\033[0m\n" "$1" >&2; exit 1; }

bold "▸ Checking prerequisites"
[ "$(uname)" = "Darwin" ] || die "Agent HUD is macOS-only (needs caffeinate/pmset/launchd)."
command -v node >/dev/null || die "node not found. Install Node ≥ 20 and retry."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "Node ≥ 20 required (found $(node -v))."
ok "macOS + Node $(node -v)"

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
command -v terminal-notifier >/dev/null \
  && ok "terminal-notifier present (clickable notifications)" \
  || warn "terminal-notifier not found — notifications fall back to plain banners (brew install terminal-notifier)."
[ -d "$HOME/.codex" ] && ok "Codex detected — its hooks will be wired too" || true

echo
bold "▸ Installing daemon + hooks"
"$REPO/setup/install.sh"

echo
bold "▸ Building + installing the editor extension"
( cd "$REPO/packages/vscode-extension" && npm install --silent && npm run release )

echo
bold "▸ Done."
echo "  Reload your editor windows:  Cmd+Shift+P → \"Developer: Reload Window\""
echo "  Then open the Agent HUD view from the Activity Bar (equalizer icon)."
echo "  (For lid-closed keep-awake, run the sudoers command printed above.)"
