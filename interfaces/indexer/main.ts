// The indexer process's entry point (book P3.05s PR 3; ADR 0052): settings load first and exit 78 when invalid, and so
// does a pool the role's connection limit cannot hold (compose.ts). With INDEXER_ENABLED off, the process serves only
// its health endpoint and reads nothing (ADR 0052 decision 7). On, compose.ts builds the adapters and starts the stream
// reader and then the passes (run.ts). SIGTERM stops both, waits for them, the pool and the health server within
// INDEXER_SHUTDOWN_GRACE_MS (shutdown.ts), and exits 0 only when all finished and nothing failed before it.
import { createServer } from "node:http"; // guard-allow: egress inbound listener only (health), sends nothing out
import { bootOrExit, exitOnConfigError } from "@unset/shared-config";
import { exitOnSignals } from "@unset/shared-http";
import { createLogger } from "@unset/shared-log";
import { compose } from "./compose.ts";
import { schema } from "./config.ts";
import { healthListener } from "./health.ts";
import { stopWithin } from "./shutdown.ts";

const config = bootOrExit(schema);
const log = createLogger({ service: "indexer", commit: config.UNSET_COMMIT, env: config.UNSET_ENV });
// As interfaces/web/server.ts: without these Node prints the raw error past the scrubbing logger (SE-7). A rejection
// stops the process as SIGTERM does but exits 1, so a restart-on-failure policy brings it back.
let failed = false;
process.on("unhandledRejection", (reason: unknown) => {
  log.logError(reason);
  failed = true;
  process.kill(process.pid, "SIGTERM");
});
process.on("uncaughtException", (error: unknown) => {
  log.logError(error);
  process.exit(1);
});

const stop = new AbortController();
const indexer = await compose(config, log, stop.signal).catch((error: unknown): never => {
  try {
    exitOnConfigError(error);
  } catch {
    log.logError(error);
  }
  process.exit(1);
});
const server = createServer(healthListener(indexer.health));
server.listen(config.HEALTH_PORT, () => {
  log.info("indexer.started", { kind: config.INDEXER_ENABLED ? "enabled" : "disabled" });
});
// The first SIGTERM stops the stream and the passes and waits as above; a second exits at once.
exitOnSignals(async () => {
  stop.abort();
  const closed = new Promise<void>((resolve) => server.close(() => resolve()));
  const code = await stopWithin([indexer.done, closed], config.INDEXER_SHUTDOWN_GRACE_MS);
  return failed ? 1 : code;
}, process.exit);
