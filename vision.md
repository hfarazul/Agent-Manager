# Agent HUD — Build Handoff

**Working title:** `agent-hud` (rename freely)
**Platform:** macOS (Apple Silicon assumed)
**Driver for agents:** Claude Code, run from VS Code's integrated terminal
**Author of spec:** handoff for a Claude Code build session

---

## 1. What we're building

A lightweight local system that gives a glanceable view + control over Claude Code agents, with three jobs:

1. **Sleep control** — toggle "keep this Mac awake" so agents keep running, including with the **lid closed**, the way `caffeinate` does for idle sleep (but `caffeinate` is not enough on its own — see §5).
2. **Agent overview** — what Claude Code sessions are running, and which one **needs my attention** (waiting on a permission prompt / input).
3. **Usage meter** — current session (5-hour) and weekly (7-day) rate-limit usage, similar to Claude Code's `/usage`.

Agents are launched **from VS Code** and stay there — VS Code is the control surface. The HUD only observes and toggles sleep; it never spawns or owns the agents. (This is the opposite of Conductor, which spawns agents in git worktrees. We deliberately do not do that.)

---

## 2. Architecture — three decoupled layers

Keep these separate. Do not collapse them; the decoupling is the whole point.

```
┌─────────────────────────────────────────────────────────┐
│  CONTROL SURFACE                                         │
│  VS Code integrated terminal — user runs Claude Code     │
│  (unchanged; we don't touch how agents are launched)     │
└─────────────────────────────────────────────────────────┘
            │ hooks (events)        ▲ toggle commands
            ▼                       │
┌─────────────────────────────────────────────────────────┐
│  DAEMON  (localhost HTTP server, launchd user agent)     │
│  - owns sleep state (caffeinate + pmset via helper)      │
│  - ingests Claude Code hook events → session table       │
│  - collects usage (statusline push / ccusage / OAuth)    │
│  - single source of truth, queried by any front-end      │
└─────────────────────────────────────────────────────────┘
            ▲ GET /state (poll or WS)
            │
┌─────────────────────────────────────────────────────────┐
│  PRESENTATION                                            │
│  Primary: VS Code extension (status bar + webview panel) │
│  Optional later: native always-on-top corner widget      │
│  Both are thin clients of the daemon.                    │
└─────────────────────────────────────────────────────────┘
```

**Why the daemon owns privilege:** a VS Code extension cannot run privileged commands (`pmset` needs root) and cannot float a window outside the editor. So the extension *sends a toggle command*; the daemon does the privileged work. This also means we can add a native widget later without rewriting anything — same daemon.

---

## 3. Tech stack (decided)

- **Daemon:** Node + TypeScript, Fastify (or Express). Runs as a `launchd` user agent so it starts on login. One language shared with the VS Code extension = less context-switching for the build.
- **VS Code extension:** TypeScript, standard extension API (status bar item + webview panel + a command).
- **Privileged helper for `pmset`:** start with a scoped `sudoers` NOPASSWD entry (§5, Option A). Upgrade path is a proper `SMAppService` helper (Option B) — note it, don't build it for v1.
- **Optional native widget (later):** Tauri (Rust core + web UI) for an always-on-top panel on the same daemon. Out of scope for v1.

Pick port **`7842`** for the daemon (arbitrary; centralize in config).

---

## 4. Daemon spec

### State model (in-memory; no DB needed for v1)

```ts
type SessionStatus = "running" | "idle" | "needs_attention";

interface Session {
  sessionId: string;
  cwd: string;
  projectName: string;     // derived from cwd basename
  status: SessionStatus;
  lastMessage?: string;    // e.g. the Notification text
  updatedAt: string;       // ISO
}

interface SleepState {
  idleAwake: boolean;      // caffeinate running
  clamshell: boolean;      // pmset disablesleep = 1
}

interface UsageState {
  session?: { usedPercent: number; resetsAt: number };   // 5-hour window
  weekly?:  { usedPercent: number; resetsAt: number };    // 7-day window
  weeklySonnet?: { usedPercent: number; resetsAt: number };
  tokensToday?: number;    // from ccusage, optional
  costToday?: number;
  source: "statusline" | "oauth" | "ccusage" | "none";
  updatedAt: string;
}
```

### Endpoints

| Method | Path                  | Purpose |
|--------|-----------------------|---------|
| POST   | `/hook`               | Receive a Claude Code hook event (body = hook stdin JSON). Update session table. |
| POST   | `/usage/statusline`   | Receive usage snapshot pushed by the statusLine script. |
| GET    | `/state`              | Return `{ sleep, sessions, usage }` — what every client polls. |
| POST   | `/sleep`              | Body `{ idle?: bool, clamshell?: bool }`. Apply via caffeinate / pmset. Returns new `SleepState`. |
| GET    | `/health`             | Liveness. |
| (opt)  | WS `/events`          | Push state changes instead of polling. Nice-to-have. |

### Session-status mapping (from hook events)

- `SessionStart` → upsert session, status `running`.
- `Notification` → status `needs_attention`, set `lastMessage`.
- `Stop` (turn finished) → status `idle`.
- `SessionEnd` → remove session.
- Any `PreToolUse`/`PostToolUse` (optional) → status `running`, refresh `updatedAt`.

The daemon must be **tolerant of unknown fields** and unknown event names (schemas vary by Claude Code version).

---

## 5. Sleep control — read this carefully

`caffeinate` only prevents **idle** sleep. It does **not** stop the Mac sleeping when the lid closes. Two separate mechanisms:

- **Idle awake (lid open):** spawn a long-lived child `caffeinate -dimsu`. Kill the process to turn it off. No privilege needed.
- **Clamshell awake (lid closed):** requires `sudo pmset -a disablesleep 1` (and `0` to restore). This needs **root**. Read current state with `pmset -g | grep -i SleepDisabled`.

**Option A (v1 — pragmatic):** add a scoped sudoers drop-in so the daemon can flip just this one command without a password. Document this as a one-time setup step:

```
# /etc/sudoers.d/agent-hud   (install with: sudo visudo -f /etc/sudoers.d/agent-hud)
YOUR_USERNAME ALL=(root) NOPASSWD: /usr/bin/pmset -a disablesleep 0, /usr/bin/pmset -a disablesleep 1
```

Daemon then runs `sudo /usr/bin/pmset -a disablesleep 1|0`. Keep the entry tightly scoped — only these exact invocations.

**Option B (later — proper):** an `SMAppService` privileged helper the daemon talks to over XPC. Note as the hardening upgrade; do not build for v1.

This is essentially what Amphetamine's closed-display mode does under the hood.

---

## 6. Claude Code wiring

> **Step 0 before coding against schemas:** install a throwaway hook + statusLine that dump their raw stdin JSON to `/tmp/agent-hud-*.json`, run one real Claude Code turn, and read the actual payloads. Schemas differ by Claude Code version — confirm the real shape, then code against it.

### Hooks → daemon

In `~/.claude/settings.json` (or per-project `.claude/settings.json`). Command hooks pipe the event JSON on stdin; forward it with curl:

```json
{
  "hooks": {
    "SessionStart":  [ { "hooks": [ { "type": "command", "command": "curl -s -X POST http://localhost:7842/hook -H 'Content-Type: application/json' -d @-" } ] } ],
    "SessionEnd":    [ { "hooks": [ { "type": "command", "command": "curl -s -X POST http://localhost:7842/hook -H 'Content-Type: application/json' -d @-" } ] } ],
    "Notification":  [ { "hooks": [ { "type": "command", "command": "curl -s -X POST http://localhost:7842/hook -H 'Content-Type: application/json' -d @-" } ] } ],
    "Stop":          [ { "hooks": [ { "type": "command", "command": "curl -s -X POST http://localhost:7842/hook -H 'Content-Type: application/json' -d @-" } ] } ]
  }
}
```

Hook stdin payload generally includes: `session_id`, `transcript_path`, `cwd`, `hook_event_name`, and event-specific fields (`Notification` carries a `message`). The daemon routes on `hook_event_name`. (If the installed version supports `type: "http"` hooks, that's an alternative — point it at the same URL; the JSON arrives as the POST body.)

### Usage → daemon (statusLine push)

Register a statusLine command that (a) prints the normal status line for the terminal AND (b) side-channels the usage JSON to the daemon:

```json
{ "statusLine": { "type": "command", "command": "/absolute/path/statusline.sh" } }
```

`statusline.sh` reads JSON on stdin, extracts `rate_limits` + `context_window` + `cost`, POSTs them to `http://localhost:7842/usage/statusline`, then echoes a formatted line to stdout.

**Facts to bake in:**
- The `rate_limits` field was added in Claude Code **v2.1.80** (March 2026). It carries 5-hour and 7-day window usage as `used_percentage` + `resets_at` (resets_at is a **Unix timestamp in seconds**). Require ≥ v2.1.80; degrade gracefully if absent.
- statusLine only emits **while a session is live** and the line refreshes → this is a *push during active use*, not a pull-anytime source. For idle-time usage, optionally poll the unofficial `https://api.anthropic.com/api/oauth/usage` (Claude Code holds the OAuth token) — mark clearly as **unofficial, may break**.
- Reported `used_percentage` values have had **accuracy bugs** (e.g. impossible >100% readings). Display them, but do **not** hard-gate any behavior on them.
- `ccusage` (reads local `~/.claude` JSONL) is the source for historical token/cost totals — optional enrichment.

---

## 7. Known gap — "needs attention" is ~85% covered

Hooks reliably catch **permission prompts** (via `Notification`) and lifecycle. But **AskUserQuestion-style interactive prompts do not fire any hook** — Claude Code treats them as a tool call in flight — so those waits won't light up the HUD.

- **v1:** ship without covering this. See if it actually bothers you.
- **Fallback if it bites:** tail each session's transcript JSONL (`transcript_path` from the hook payload) and detect the waiting state directly. Heavier; add only if needed.

(Conductor avoids this gap because it owns the terminal PTY and reads raw output. We chose VS Code control instead, so we accept this gap.)

---

## 8. VS Code extension spec

- **Status bar item:** compact summary, e.g. `🟢 3 · ⚠ 1 · 5h 38% · wk 62%`. Click → open panel. Polls `GET /state` (e.g. every 3–5s) or subscribes to WS.
- **Command** `agentHud.toggleSleep`: POSTs to `/sleep`. Offer two: "Keep awake (lid open)" and "Keep awake (lid closed)".
- **Webview panel:** full view — session list with per-row status badge + project name + last message; sleep toggles; usage bars (session / weekly) with reset countdowns.
- The extension does **no** privileged work and reads **no** Claude Code internals directly — everything goes through the daemon.

---

## 9. Build order (MVP-first)

1. **Daemon skeleton:** Fastify server, `/health`, `/state` returning empty state, in-memory store. Launchd plist to run on login.
2. **Hook ingestion:** `/hook` endpoint + session table + status mapping. Wire the 4 hooks; confirm sessions appear/update live (do Step 0 schema dump first).
3. **Sleep — idle only:** `/sleep` with `caffeinate` spawn/kill. Read-back of state.
4. **VS Code client:** status bar + sleep toggle command + webview polling `/state`. This is the usable v1.
5. **Usage:** `statusline.sh` → `/usage/statusline` → render bars. Require CC ≥ v2.1.80.
6. **Clamshell sleep:** sudoers Option A + `pmset` wiring + a second toggle.
7. **Optional:** OAuth usage polling for idle-time; ccusage enrichment; native corner widget on the same daemon; AskUserQuestion JSONL-tail fallback.

Ship after step 4; everything after is additive.

---

## 10. Gotchas checklist (do not relearn these)

- [ ] `caffeinate` ≠ lid-close. Clamshell needs `pmset disablesleep` = **root**.
- [ ] VS Code extension **cannot** run privileged commands or float outside the editor → daemon owns privilege + the optional widget owns "always visible".
- [ ] `AskUserQuestion` does **not** fire a hook → known blind spot in attention detection.
- [ ] `rate_limits` needs Claude Code **≥ v2.1.80**; only present **while a session is live**; `resets_at` is **Unix seconds**.
- [ ] Usage percentages have shown bugs → display, never gate on them.
- [ ] OAuth usage endpoint is **unofficial** → wrap defensively, degrade gracefully.
- [ ] Confirm real hook + statusLine JSON schemas on the installed version (Step 0) before coding against them.
- [ ] Keep the sudoers entry tightly scoped to the two exact `pmset` invocations.

---

## 11. Open decisions (flag to the human, don't guess)

- Daemon transport to clients: simple polling vs WebSocket push. (Default: polling for v1.)
- Whether to build the native always-on-top widget at all, or stay VS-Code-only.
- Whether idle-time usage accuracy matters enough to poll the unofficial OAuth endpoint.