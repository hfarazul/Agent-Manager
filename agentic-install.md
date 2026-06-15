# agentic-install.md — Guided Install Playbook (for AI agents)

**If you are an AI agent installing Agent HUD for a user, read this file first and
follow it.** It exists because a plain run of `install.sh` finishes by *listing*
manual steps (reload the editor, a `sudo` step, an optional `brew install`) — and
**anything left as an end-of-run recommendation silently doesn't get done**, so
the feature quietly fails (the extension never activates, notifications fall back
to plain banners, lid-closed keep-awake is off).

## The principle: prompt, don't recommend

- **Ask up front, execute in-flow, verify each step.** Everything that needs the
  user becomes a question *before* installing — not an afterthought.
- **Recommended defaults are pre-selected**, so the happy path is one confirmation.
- **Every step is verified** before you move on. Don't report success you haven't
  checked.
- **Offer an explicit defer** for anything the user declines — never silently skip,
  and tell them how to enable it later.

---

## Step 0 — Interactive intake (ask BEFORE installing)

Auto-detect first, then confirm. Use your question UI; pre-select the recommended
option.

- **Q1. Which coding agent(s)?** `Claude Code` · `Codex` · `Both`
  *Auto-detect:* `~/.claude` exists → Claude Code; `~/.codex` exists → Codex.
- **Q2. Which editor?** `Cursor` · `VS Code`
  *Auto-detect:* `ls /Applications | grep -iE "Cursor|Visual Studio Code"`, or which
  of `cursor` / `code` resolves.
- **Q3. Which features?** (multi-select; recommended pre-checked)
  - [x] **Daemon + launchd service** — core, required.
  - [x] **Agent HUD editor extension** — the sidebar UI.
  - [x] **Click-to-jump notifications** (`terminal-notifier`).
  - [ ] **Lid-closed keep-awake** — needs the user's `sudo` password (default off).
- **Q4. Run the `sudo` keep-awake step now?** `Yes, prompt me` · `Skip (disables
  lid-closed keep-awake; can enable later)` — only ask if Q3 included it.

---

## Step 1 — Automated install (no user input)

If the user accepted all recommended defaults, the one-command path covers the
core + extension:

```bash
git clone https://github.com/hfarazul/Agent-Manager.git && cd Agent-Manager
./install.sh   # daemon + Claude/Codex hooks + builds & installs the extension
```

If the user opted *out* of something, run the pieces instead of `./install.sh`:

```bash
./setup/install.sh                                   # daemon + hooks (always)
cd packages/vscode-extension && npm install && npm run release   # extension — only if Q3 kept it
```

`setup/install.sh` is idempotent: it installs the launchd service and merges hooks
into `~/.claude/settings.json` (and `~/.codex/config.toml` if `~/.codex` exists),
backing each up first.

**Verify before continuing:**

```bash
curl -s --max-time 2 http://localhost:7842/health                      # → {"ok":true,...}
launchctl print "gui/$(id -u)/com.agent-hud.daemon" >/dev/null && echo "service loaded"
grep -q "hook.mjs" ~/.claude/settings.json && echo "claude hooks ok"
[ -d ~/.codex ] && grep -q "hook.mjs codex" ~/.codex/config.toml && echo "codex hooks ok"
```

---

## Step 2 — Guided steps (prompt + verify each — never just recommend)

Run only the steps for features the user enabled in Step 0. **Walk the user
through each one and verify it before moving on.**

1. **Activate the extension** *(if the extension was installed)* — this is the step
   most often skipped:
   > Ask the user: "In your editor, press `Cmd+Shift+P` → run **Developer: Reload
   > Window**. Tell me when done."

   Verify it's installed on disk:
   ```bash
   ls -d ~/.cursor/extensions/agent-hud.* 2>/dev/null || ls -d ~/.vscode/extensions/agent-hud.* 2>/dev/null
   ```
   Then confirm with the user that the **Agent HUD** view appears in the Activity
   Bar (equalizer icon). You cannot reload the window for them — make it an explicit
   ask, not a footnote.

2. **Lid-closed keep-awake** *(only if enabled in Q3/Q4)* — needs `sudo`, so the
   user must run it. `install.sh` prints the exact command with a generated temp
   file; have the user run it in a `!` prompt (so its output returns to you):
   ```bash
   sudo install -m 0440 "$GENERATED_FILE" /etc/sudoers.d/agent-hud && sudo visudo -cf /etc/sudoers.d/agent-hud
   ```
   ⚠️ `$GENERATED_FILE` lives under `$TMPDIR` and can be cleared on reboot — run it
   now, or re-run `./install.sh` to regenerate it. Verify:
   ```bash
   sudo -n /usr/bin/pmset -g | grep -qi SleepDisabled && echo "sudoers ok" || echo "not wired yet"
   ```

3. **Click-to-jump notifications** *(if enabled)* — without `terminal-notifier`,
   notifications still work but fall back to plain, non-clickable banners:
   ```bash
   command -v terminal-notifier >/dev/null || brew install terminal-notifier
   ```
   First use may need a one-time macOS Notifications permission for
   `terminal-notifier` (System Settings → Notifications) — tell the user to allow it.

---

## Step 3 — End-to-end verification

Ask the user to start a Claude Code (or Codex) session in the editor's integrated
terminal, then confirm it surfaces:

```bash
curl -s http://localhost:7842/state    # the live session should appear in sessions[]
```

If it does, the full pipeline (hooks → daemon → HUD) is working.

---

## Success criteria

| Layer | Check | Expected |
|---|---|---|
| Daemon | `curl -s :7842/health` | `{"ok":true}` |
| launchd service | `launchctl print gui/$(id -u)/com.agent-hud.daemon` | loaded |
| Claude hooks | `grep hook.mjs ~/.claude/settings.json` | present |
| Codex hooks *(if used)* | `grep "hook.mjs codex" ~/.codex/config.toml` | present |
| Extension | `ls ~/.cursor/extensions/agent-hud.*` | installed |
| Extension active | user confirms Activity-Bar icon after reload | visible |
| Lid-closed keep-awake *(if enabled)* | `sudo -n pmset -g \| grep SleepDisabled` | wired |
| End-to-end | `curl -s :7842/state` with a live session | session listed |

## Things you (the agent) cannot do — always hand these to the user

- **Reload the editor window** (extension activation).
- **The `sudo` step** (needs their password).
- **Allowing the macOS Notifications permission** for `terminal-notifier`.

For each, prompt explicitly and verify — don't leave them as a closing list.
