#!/usr/bin/env node
/**
 * agent-hud statusLine forwarder (vision.md §6).
 *
 * Claude Code pipes the statusLine JSON on stdin. We:
 *   (a) side-channel the RAW JSON to the daemon's /usage/statusline, and
 *   (b) echo a compact status line to stdout for the terminal.
 *
 * The daemon does all parsing — this script stays dumb so the parsing logic
 * can change without re-installing anything. Fire-and-forget + short timeout so
 * a down daemon never stalls the status line.
 */
import { stdin } from "node:process";

const DAEMON = process.env.AGENT_HUD_URL ?? "http://127.0.0.1:7842";

let raw = "";
for await (const chunk of stdin) raw += chunk;

let data = {};
try {
  data = JSON.parse(raw);
} catch {
  // malformed/empty stdin — still print something sensible below
}

// (a) Forward raw JSON to the daemon, best-effort with a tight timeout.
try {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 800);
  await fetch(`${DAEMON}/usage/statusline`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw || "{}",
    signal: ac.signal,
  }).catch(() => {});
  clearTimeout(t);
} catch {
  /* daemon down — ignore */
}

// (b) Echo a compact line for the terminal. Mirror what the HUD shows.
const dir = data?.workspace?.current_dir ?? data?.cwd ?? "";
const project = dir ? dir.split("/").filter(Boolean).pop() : "claude";
const model = data?.model?.display_name ?? "";

const rl = data?.rate_limits;
const parts = [`⛁ ${project}`];
if (model) parts.push(model);
const sess = pickPct(rl, ["session", "five_hour", "5h", "primary"]);
const week = pickPct(rl, ["weekly", "seven_day", "7d", "week"]);
if (sess != null) parts.push(`5h ${Math.round(sess)}%`);
if (week != null) parts.push(`wk ${Math.round(week)}%`);

process.stdout.write(parts.join("  ·  "));

function pickPct(rl, keys) {
  if (!rl || typeof rl !== "object") return null;
  for (const k of keys) {
    const w = rl[k];
    if (w && typeof w === "object") {
      const p = w.used_percentage ?? w.usedPercent ?? w.percent;
      if (typeof p === "number") return p;
    }
  }
  return null;
}
