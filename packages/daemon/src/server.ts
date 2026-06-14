import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { config } from "./config.js";
import { store } from "./store.js";
import { sleepController } from "./sleep.js";
import { ingestHook } from "./hooks.js";
import { ingestUsage } from "./usage.js";
import { startAttentionScanner } from "./attention.js";
import { raiseWindow } from "./focus.js";

/** Minimal shape of the @fastify/websocket socket we use (avoids a @types/ws
 * dependency just for broadcasting). */
type WsLike = { readyState: number; OPEN: number; send: (data: string) => void };

/**
 * Builds the Fastify app. Increment 1 wires only /health, /state, and the
 * WS /events push channel. Later increments add /hook, /sleep, /usage.
 */
export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });

  // Tolerant body parsing. Claude Code hooks pipe JSON on stdin and the curl
  // forwarder may send it without a Content-Type (415) or, in odd cases, as
  // malformed JSON (400). Fastify's default parser rejects both BEFORE our
  // handlers run — which would break the user's hook chain. Parse every body
  // as a tolerant JSON string instead: empty or unparseable → {}, never an
  // error. The /hook and /usage handlers already treat unknown shapes safely.
  const tolerantJson = (
    _req: unknown,
    body: string,
    done: (err: Error | null, value?: unknown) => void,
  ): void => {
    if (!body) return done(null, {});
    try {
      done(null, JSON.parse(body));
    } catch {
      done(null, {});
    }
  };
  app.addContentTypeParser("application/json", { parseAs: "string" }, tolerantJson);
  app.addContentTypeParser("*", { parseAs: "string" }, tolerantJson);

  await app.register(websocket);

  // Cross-window focus coordination. Every editor window holds a WS connection;
  // a focus request is broadcast to all of them, and whichever window owns the
  // session's terminal claims it (revealing the tab + raising itself). We track
  // open sockets here to broadcast, and correlate each request to its claim so
  // the clicking window learns whether anyone could handle it.
  const clients = new Set<WsLike>();
  const pendingFocus = new Map<string, { resolve: (claimed: boolean) => void; timer: NodeJS.Timeout }>();
  const broadcast = (obj: unknown): void => {
    const data = JSON.stringify(obj);
    for (const s of clients) if (s.readyState === s.OPEN) s.send(data);
  };

  // Liveness — used by launchd KeepAlive checks and the VS Code client.
  app.get("/health", async () => ({ ok: true, ts: new Date().toISOString() }));

  // The snapshot every client polls (fallback when WS isn't connected).
  app.get("/state", async () => store.getState());

  // Receive a Claude Code hook event (raw stdin JSON forwarded by curl).
  // Always returns 200 so a malformed/unknown event never breaks the hook
  // chain in the user's terminal.
  app.post("/hook", async (req) => {
    return ingestHook(req.body);
  });

  // Receive a usage snapshot forwarded by the statusLine script (raw statusLine
  // stdin JSON). Always 200 so a parse miss never breaks the status line.
  app.post("/usage/statusline", async (req) => {
    return ingestUsage(req.body);
  });

  // Toggle sleep. Body: { idle?: boolean, clamshell?: boolean }.
  // Either field may be omitted to leave that mechanism unchanged.
  app.post<{ Body: { idle?: boolean; clamshell?: boolean } }>(
    "/sleep",
    async (req, reply) => {
      const { idle, clamshell } = req.body ?? {};

      if (typeof idle === "boolean") sleepController.setIdleAwake(idle);

      if (typeof clamshell === "boolean") {
        try {
          await sleepController.setClamshell(clamshell);
        } catch (err) {
          // Surface the sudoers-not-installed case clearly; idle change (if any)
          // already applied above.
          return reply.status(503).send({
            error: (err as Error).message,
            sleep: store.getState().sleep,
          });
        }
      }

      return store.getState().sleep;
    },
  );

  // Request that the window owning `sessionId`'s terminal focus it. Broadcasts
  // to all windows, then waits briefly for one to claim it. Returns
  // { claimed } so the clicking window can toast if nobody could.
  app.post<{ Body: { sessionId?: string } }>("/focus", async (req) => {
    const sessionId = req.body?.sessionId;
    if (!sessionId) return { ok: false, claimed: false, reason: "no-session" };
    const session = store.getState().sessions.find((s) => s.sessionId === sessionId);
    if (!session?.ancestorPids?.length) {
      return { ok: false, claimed: false, reason: "no-locator" };
    }

    broadcast({ type: "focus", sessionId });

    const claimed = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        pendingFocus.delete(sessionId);
        resolve(false);
      }, 1200);
      pendingFocus.set(sessionId, { resolve, timer });
    });
    return { ok: true, claimed };
  });

  // The owning window claims a focus request: raise its window (by folder) and
  // resolve the pending /focus so the clicker stops waiting.
  app.post<{ Body: { sessionId?: string; folder?: string } }>("/focus/claim", async (req) => {
    const { sessionId, folder } = req.body ?? {};
    if (folder) raiseWindow(folder);
    if (sessionId) {
      const pending = pendingFocus.get(sessionId);
      if (pending) {
        clearTimeout(pending.timer);
        pendingFocus.delete(sessionId);
        pending.resolve(true);
      }
    }
    return { ok: true };
  });

  // WS push: send the current snapshot on connect, then on every store change.
  app.register(async (scoped) => {
    scoped.get("/events", { websocket: true }, (socket) => {
      clients.add(socket as unknown as WsLike);
      const send = () => {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify(store.getState()));
        }
      };

      send(); // initial snapshot on connect
      store.on("change", send);

      const cleanup = () => {
        store.off("change", send);
        clients.delete(socket as unknown as WsLike);
      };
      socket.on("close", cleanup);
      socket.on("error", cleanup);
    });
  });

  return app;
}

export async function startServer(): Promise<FastifyInstance> {
  const app = await buildServer();
  // Reconcile real OS sleep state into the store before accepting clients.
  await sleepController.syncFromOs();
  try {
    await app.listen({ port: config.port, host: config.host });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
      // A daemon is already running — this is the common double-start case
      // (launchd + manual, or two terminals). Exit cleanly, not with a stack
      // dump; the existing daemon is the one true instance.
      console.error(
        `agent-hud: port ${config.port} already in use — another daemon is ` +
          `already running. Nothing to do; exiting.`,
      );
      process.exit(0);
    }
    throw err;
  }
  app.log.info(`agent-hud daemon listening on http://${config.host}:${config.port}`);
  // Tail transcripts for AskUserQuestion waits the hooks can't see.
  startAttentionScanner();
  return app;
}
