import { startServer } from "./server.js";
import { sleepController } from "./sleep.js";

const app = await startServer();

// Graceful shutdown so launchd restarts are clean and (later) caffeinate
// children get killed by the sleep module's own SIGTERM handlers.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    app.log.info(`received ${signal}, shutting down`);
    sleepController.shutdown(); // release caffeinate child
    await app.close();
    process.exit(0);
  });
}
