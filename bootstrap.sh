#!/usr/bin/env bash
# Agent HUD — remote bootstrap. Clone (or update) the repo, then run the installer.
#
#   curl -fsSL https://raw.githubusercontent.com/hfarazul/Agent-Manager/main/bootstrap.sh | bash
#
# Re-running updates to the latest main and re-installs (idempotent). Override the
# checkout location with AGENT_HUD_DIR.
set -euo pipefail

REPO_URL="https://github.com/hfarazul/Agent-Manager.git"
DIR="${AGENT_HUD_DIR:-$HOME/.agent-hud/src}"

printf "\033[1m▸ Agent HUD bootstrap\033[0m\n"
command -v git >/dev/null || { echo "git is required (install Xcode Command Line Tools)." >&2; exit 1; }

if [ -d "$DIR/.git" ]; then
  echo "▸ updating $DIR"
  git -C "$DIR" pull --ff-only
else
  echo "▸ cloning into $DIR"
  mkdir -p "$(dirname "$DIR")"
  git clone --depth 1 "$REPO_URL" "$DIR"
fi

cd "$DIR"
exec ./install.sh
