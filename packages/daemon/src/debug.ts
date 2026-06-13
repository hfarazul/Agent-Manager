import { appendFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "./config.js";

/** Per-file cap — once a debug log passes this it's reset, so it can never grow
 * unbounded. */
const MAX_BYTES = 1024 * 1024; // 1 MB

/**
 * Append a raw payload to a debug JSONL file under $TMPDIR — but ONLY when
 * AGENT_HUD_DEBUG is set. These payloads carry local paths + session metadata,
 * so capturing them is opt-in (it's a Step-0 schema-debugging aid, not normal
 * operation). Size-bounded and best-effort; never throws into the request path.
 */
export function debugCapture(filename: string, data: unknown): void {
  if (!config.debug) return;
  const path = join(tmpdir(), filename);
  void (async () => {
    try {
      const size = await stat(path).then((s) => s.size).catch(() => 0);
      const line = JSON.stringify({ ts: new Date().toISOString(), data }) + "\n";
      // Reset rather than append once over the cap (cheap rotation).
      await (size > MAX_BYTES ? writeFile(path, line) : appendFile(path, line));
    } catch {
      /* ignore — debug logging must never affect ingestion */
    }
  })();
}

export function debugPath(filename: string): string {
  return join(tmpdir(), filename);
}
