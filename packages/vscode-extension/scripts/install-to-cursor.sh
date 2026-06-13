#!/usr/bin/env bash
# Install the freshly-packaged .vsix into Cursor (or VS Code).
# Used by `npm run release`. Finds the CLI even when it's not on PATH.
set -euo pipefail
cd "$(dirname "$0")/.."

VSIX="$(ls -t agent-hud-*.vsix 2>/dev/null | head -1)"
if [ -z "${VSIX:-}" ]; then
  echo "No agent-hud-*.vsix found — run 'npm run package' first." >&2
  exit 1
fi

# Prefer a CLI on PATH; fall back to the app bundle locations.
CLI=""
for c in cursor code \
  "/Applications/Cursor.app/Contents/Resources/app/bin/cursor" \
  "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"; do
  if command -v "$c" >/dev/null 2>&1 || [ -x "$c" ]; then CLI="$c"; break; fi
done

if [ -z "$CLI" ]; then
  echo "Couldn't find the Cursor/VS Code CLI. Install '$VSIX' manually:" >&2
  echo "  Extensions panel → ··· → Install from VSIX…" >&2
  exit 1
fi

echo "Installing $VSIX via: $CLI"
"$CLI" --install-extension "$VSIX" --force
echo
echo "✅ Installed. Reload the editor to pick it up:"
echo "   Cmd+Shift+P → Developer: Reload Window"
