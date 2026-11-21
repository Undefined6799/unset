// The unset.cc door's entry point (build step 6; ADR 0081 decision 4): settings first (exit 78 when invalid), then the
// chat page from apps/chat's build (ADR 0088; the door does not start without it), then the door (compose.ts), which
// checks its database budget and key before it listens. Each answer is one log line of route
// template, method, status and reason (SE-7). SIGTERM stops taking requests and exits once the listener has closed.
import { createServer } from "node:http"; // guard-allow: egress inbound listener only; the door sends nothing out here
import { fileURLToPath } from "node:url";
import { bootOrExit } from "@unset/shared-config";
import { exitOnSignals } from "@unset/shared-http";
import { createLogger, type LogFields } from "@unset/shared-log";
import { compose } from "./compose.ts";
import { schema } from "./config.ts";
import { loadChatPage } from "./page.ts";

const config = bootOrExit(schema);
const log = createLogger({ service: "chat-auth", commit: config.UNSET_COMMIT, env: config.UNSET_ENV });
process.on("uncaughtException", (error: unknown) => {
  log.logError(error);
  process.exit(1);
});

/** The methods the log may name; any other is logged without one. */
const METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

/** Where `npm run build -w @unset/apps-chat` writes the page (apps/chat/vite.config.ts), beside this folder. */
const PAGE_DIR = new URL("../../apps/chat/dist/page/", import.meta.url);

const door = await compose(
  config,
  {
    request: ({ route, method, status, reason }) => {
      const named = METHODS.has(method) ? { method: method as NonNullable<LogFields["method"]> } : {};
      log.info("door.request", { route, status, ...named, ...(reason ? { reason } : {}) });
    },
    untrustedPeer: () => log.warn("proxy.untrusted_peer", {}),
  },
  loadChatPage(fileURLToPath(PAGE_DIR)),
);
const server = createServer({ requestTimeout: 15_000, headersTimeout: 10_000, maxHeaderSize: 16_384 }, door.listener);
// The count port (ADR 0090 decision 2): a second listener, on its own port, that serves only the count routes.
const counts = createServer(
  { requestTimeout: 10_000, headersTimeout: 5_000, maxHeaderSize: 8_192 },
  door.count.listener,
);
const listening = (s: typeof server, port: number) => new Promise<void>((resolve) => s.listen(port, resolve));
await Promise.all([listening(server, config.LISTEN_PORT), listening(counts, config.COUNT_LISTEN_PORT)]);
log.info("door.started", {});
exitOnSignals(async () => {
  await Promise.all([server, counts].map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
  await door.close();
  log.info("door.stopped", {});
  return 0;
}, process.exit);
