#!/usr/bin/env node
/**
 * agent-hud hook forwarder.
 *
 * Replaces the inline `curl … -d @-` hook. Claude Code pipes each hook event's
 * JSON on stdin; we:
 *   (a) walk THIS process's ancestry to collect the PID chain, and
 *   (b) POST the original payload — plus `agent_hud_ancestor_pids` — to the
 *       daemon's /hook.
 *
 * Why the PID chain: this forwarder runs as a descendant of the terminal that
 * launched `claude` (shell → claude → [sh -c] → node). The shell's PID is the
 * one VS Code/Cursor reports as `terminal.processId`, so capturing the chain
 * lets the extension match a HUD row to its exact integrated-terminal tab —
 * uniquely, even when two agents share a repo (cwd alone can't disambiguate).
 *
 * Stays dumb and best-effort: the daemon does all parsing, and a down daemon or
 * a failed `ps` must never block the hook. Fire-and-forget with a tight timeout.
 */
import { stdin } from "node:process";
import { execSync } from "node:child_process";

const DAEMON = process.env.AGENT_HUD_URL ?? "http://127.0.0.1:7842";

let raw = "";
for await (const chunk of stdin) raw += chunk;

let data = {};
try {
  data = JSON.parse(raw);
} catch {
  // malformed/empty stdin — still forward {} so the daemon at least sees activity
}

// Best-effort ancestry walk. One `ps` dump → pid→{ppid,comm} → walk up from us.
// Captures the full chain (for terminal matching) AND the `claude` PID itself
// (for liveness — so an idle-but-alive session isn't pruned as "stale").
try {
  const { pids, claudePid } = ancestry(process.pid);
  if (pids.length) data.agent_hud_ancestor_pids = pids;
  if (claudePid) data.agent_hud_claude_pid = claudePid;
} catch {
  /* ps unavailable — degrade silently; click-to-session just won't resolve */
}

try {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 1500);
  await fetch(`${DAEMON}/hook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    signal: ac.signal,
  }).catch(() => {});
  clearTimeout(t);
} catch {
  /* daemon down — ignore */
}

/**
 * Walk the chain of PIDs from `start` up to the root, e.g.
 * [node, sh, claude, zsh, login, …]. Returns the full chain (the zsh entry is
 * terminal.processId) plus the PID whose command is `claude` (the agent process,
 * used for liveness checks).
 */
function ancestry(start) {
  const out = execSync("ps -axo pid=,ppid=,comm=", { encoding: "utf8" });
  const parent = new Map();
  const comm = new Map();
  for (const line of out.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (m) {
      parent.set(Number(m[1]), Number(m[2]));
      comm.set(Number(m[1]), m[3]);
    }
  }
  const chain = [];
  let claudePid;
  let pid = start;
  const seen = new Set();
  while (pid > 1 && !seen.has(pid)) {
    seen.add(pid);
    chain.push(pid);
    // The agent process names itself "claude" (basename match avoids the
    // "Cursor.app" / "Claude.app" helpers).
    const base = (comm.get(pid) || "").split("/").pop();
    if (!claudePid && base === "claude") claudePid = pid;
    const ppid = parent.get(pid);
    if (ppid === undefined) break;
    pid = ppid;
  }
  return { pids: chain, claudePid };
}
