// The media process's entry point (book P2.19): settings first (exit 78 when invalid), then the door (compose.ts).
// Each answer is logged by route template and status only (SE-7). SIGTERM stops taking requests and exits once the
// listener has closed.
import { createServer } from "node:http"; // guard-allow: egress inbound listener only; the store is reached through net-guard
import { bootOrExit } from "@unset/shared-config";
import { exitOnSignals } from "@unset/shared-http";
import { createLogger } from "@unset/shared-log";
import { compose } from "./compose.ts";
import { schema } from "./config.ts";

const config = bootOrExit(schema);
const log = createLogger({ service: "media", commit: config.UNSET_COMMIT, env: config.UNSET_ENV });
process.on("uncaughtException", (error: unknown) => {
  log.logError(error);
  process.exit(1);
});

const listener = compose(config, (route, status) => log.info("media.request", { route, status }));
const server = createServer({ requestTimeout: 15_000, headersTimeout: 10_000, maxHeaderSize: 16_384 }, listener);
server.listen(config.LISTEN_PORT, () => log.info("media.started", {}));
exitOnSignals(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  log.info("media.stopped", {});
  return 0;
}, process.exit);
