// The indexer process's entry point (book P3.05s PR 3; ADR 0052): settings load first and exit 78 when invalid. With
// INDEXER_ENABLED off, the process serves only its health endpoint and reads nothing (ADR 0052 decision 7). On, compose.ts
// builds the adapters and starts the stream reader and then the passes (run.ts). SIGTERM stops both, waits for them to
// finish and the pool to end, and closes the health server.
import { createServer } from "node:http"; // guard-allow: egress inbound listener only (health), sends nothing out
import { bootOrExit } from "@unset/shared-config";
import { exitOnSignals } from "@unset/shared-http";
import { createLogger } from "@unset/shared-log";
import { compose } from "./compose.ts";
import { schema } from "./config.ts";
import { healthListener } from "./health.ts";

const config = bootOrExit(schema);
const log = createLogger({ service: "indexer", commit: config.UNSET_COMMIT, env: config.UNSET_ENV });
// As interfaces/web/server.ts: without these Node prints the raw error past the scrubbing logger (SE-7).
process.on("unhandledRejection", (reason: unknown) => {
  log.logError(reason);
  process.kill(process.pid, "SIGTERM");
});
process.on("uncaughtException", (error: unknown) => {
  log.logError(error);
  process.exit(1);
});

const stop = new AbortController();
const indexer = config.INDEXER_ENABLED
  ? compose(config, log, stop.signal)
  : { health: async () => ({ enabled: false }), done: Promise.resolve() };
const server = createServer(healthListener(indexer.health));
server.listen(config.HEALTH_PORT);
log.info("indexer.started", { kind: config.INDEXER_ENABLED ? "enabled" : "disabled" });
// The first SIGTERM stops the stream and the passes, waits for them, and closes the health server; a second exits at once.
exitOnSignals(async () => {
  stop.abort();
  await indexer.done;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return 0;
}, process.exit);
