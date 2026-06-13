import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { config } from "./config.js";
import { store } from "./store.js";
import { sleepController } from "./sleep.js";
import { ingestHook } from "./hooks.js";
import { ingestUsage } from "./usage.js";
import { startAttentionScanner } from "./attention.js";

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

  // WS push: send the current snapshot on connect, then on every store change.
  app.register(async (scoped) => {
    scoped.get("/events", { websocket: true }, (socket) => {
      const send = () => {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify(store.getState()));
        }
      };

      send(); // initial snapshot on connect
      store.on("change", send);

      socket.on("close", () => store.off("change", send));
      socket.on("error", () => store.off("change", send));
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
