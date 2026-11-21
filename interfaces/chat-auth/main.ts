// The unset.cc door's entry point (build step 6; ADR 0081 decision 4): settings first (exit 78 when invalid), then the
// door (compose.ts). Each answer is one log line of route template, method, status and reason (SE-7). SIGTERM stops
// taking requests and exits once the listener has closed.
import { createServer } from "node:http"; // guard-allow: egress inbound listener only; the door sends nothing out here
import { bootOrExit } from "@unset/shared-config";
import { exitOnSignals } from "@unset/shared-http";
import { createLogger, type LogFields } from "@unset/shared-log";
import { compose } from "./compose.ts";
import { schema } from "./config.ts";

const config = bootOrExit(schema);
const log = createLogger({ service: "chat-auth", commit: config.UNSET_COMMIT, env: config.UNSET_ENV });
process.on("uncaughtException", (error: unknown) => {
  log.logError(error);
  process.exit(1);
});

/** The methods the log may name; any other is logged without one. */
const METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

const listener = compose(config, {
  request: ({ route, method, status, reason }) => {
    const named = METHODS.has(method) ? { method: method as NonNullable<LogFields["method"]> } : {};
    log.info("door.request", { route, status, ...named, ...(reason ? { reason } : {}) });
  },
  untrustedPeer: () => log.warn("proxy.untrusted_peer", {}),
});
const server = createServer({ requestTimeout: 15_000, headersTimeout: 10_000, maxHeaderSize: 16_384 }, listener);
server.listen(config.LISTEN_PORT, () => log.info("door.started", {}));
exitOnSignals(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  log.info("door.stopped", {});
  return 0;
}, process.exit);
