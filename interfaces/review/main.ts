// The review process's entry point (ADR 0070 point 2.2): settings first (exit 78 when invalid), then the child pool and its door
// (compose.ts). Each answer is logged by its outcome only, and each pool event by its name, never with a member, a
// size or an error text (SE-7).
// SIGTERM stops taking jobs, kills the children and exits once the listener has closed.
import { createServer } from "node:http"; // guard-allow: egress inbound listener only, sends nothing out
import { bootOrExit } from "@unset/shared-config";
import { exitOnSignals } from "@unset/shared-http";
import { createLogger } from "@unset/shared-log";
import { compose } from "./compose.ts";
import { schema } from "./config.ts";

const config = bootOrExit(schema);
const log = createLogger({ service: "review", commit: config.UNSET_COMMIT, env: config.UNSET_ENV });
process.on("uncaughtException", (error: unknown) => {
  log.logError(error);
  process.exit(1);
});

// A pool that goes down (its children cannot start: prlimit or sharp missing, too little address space) is an
// error; the other pool events are info.
const review = compose(
  config,
  (outcome) => log.info("review.job", { kind: outcome }),
  (event) => (event === "down" ? log.error : log.info)("review.pool", { kind: event }),
);
const server = createServer(
  { requestTimeout: config.REVIEW_TIMEOUT_MS * 2, headersTimeout: 10_000, maxHeaderSize: 16_384 },
  review.listener,
);
server.listen(config.LISTEN_PORT, () => log.info("review.started", {}));
exitOnSignals(async () => {
  review.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  log.info("review.stopped", {});
  return 0;
}, process.exit);
