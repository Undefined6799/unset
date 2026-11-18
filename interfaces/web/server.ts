// The web process's entry point: adapter-node's documented custom server (https://svelte.dev/docs/kit/adapter-node,
// "Custom server"; adapter-node 6.0.2) around the built `handler`. adapter-node serves the build's files and SvelteKit
// sends its own CSRF 403 before hooks.server.ts runs (adapter-node files/handler.js serve_static; kit 3.2.0
// src/runtime/server/respond.js), so what every response needs lives here, whatever produced it: the host check, the
// security headers and the one log line. Headers are set before the handler; a header the app sets itself (a page's
// CSP) replaces ours, because Node merges setHeader values into writeHead and the later write wins. We own listen and
// the drain (shared/http/shutdown.ts). Settings load first and exit 78 when invalid (ADR 0054 decision 3).
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"; // guard-allow: egress inbound listener only, sends nothing out
import { bootOrExit } from "@unset/shared-config";
import { drain, exitOnSignals, headerSets, hostAllowed } from "@unset/shared-http";
import { createLogger, type LogFields } from "@unset/shared-log";
import { schema } from "./src/lib/server/config.ts";
import { NOTE_KEY, type ProcessNote, type RequestNote } from "./src/lib/server/note.ts";

const config = bootOrExit(schema);
const log = createLogger({ service: "web", commit: config.UNSET_COMMIT, env: config.UNSET_ENV });
const note: ProcessNote = {
  config,
  requests: new AsyncLocalStorage<RequestNote>(),
  shutdown: { draining: [], close: [] },
};
(globalThis as Record<symbol, unknown>)[NOTE_KEY] = note;

// adapter-node reads these when its handler loads (adapter-node files/env.js): the origin for the request URL and
// SvelteKit's Origin check, and the cap on any request body. Ours come from config, never from the environment raw.
process.env.ORIGIN = config.PUBLIC_ORIGIN;
process.env.BODY_SIZE_LIMIT = String(config.HTTP_BODY_LIMIT_BYTES);

type NodeHandler = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
/** Loaded by URL after the note is published, so the type checker does not walk the build output. */
const { handler } = (await import(new URL("./build/handler.js", import.meta.url).href)) as { handler: NodeHandler };

/** Every response carries these; the app replaces the CSP on its pages (hooks.server.ts). */
const BASE_HEADERS = headerSets(config).static;

const METHODS: readonly NonNullable<LogFields["method"]>[] = [
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
];
const methodField = (method = ""): Pick<LogFields, "method"> => {
  const known = METHODS.find((m) => m === method);
  return known === undefined ? {} : { method: known };
};

const isProbe = (req: IncomingMessage) => (req.url ?? "").split("?")[0] === "/health";

/** The request's host, lowercase and without its port; undefined when absent or malformed. */
function hostOf(req: IncomingMessage): string | undefined {
  const raw = req.headers.host;
  if (raw === undefined || raw === "" || !URL.canParse(`http://${raw}`)) return undefined;
  return new URL(`http://${raw}`).hostname.toLowerCase();
}

/** SvelteKit marks page responses with `x-sveltekit-page`; it tells a visitor nothing they need, so it never leaves. */
function hideFramework(res: ServerResponse): void {
  const setHeader = res.setHeader.bind(res);
  res.setHeader = (name, value) => (name.toLowerCase() === "x-sveltekit-page" ? res : setHeader(name, value));
}

let inFlight = 0;

function serve(req: IncomingMessage, res: ServerResponse): void {
  const started = performance.now();
  const request: RequestNote = { reqId: randomUUID() };
  inFlight += 1;
  res.on("close", () => {
    inFlight -= 1;
    // The hook names the route it handled; anything else is a file or a refusal SvelteKit sent before the hook.
    log.info("http.request", {
      route: request.route ?? "/unrouted",
      ...methodField(req.method),
      status: res.statusCode,
      ms: Math.round(performance.now() - started),
      reqId: request.reqId,
    });
  });
  for (const [name, value] of Object.entries(BASE_HEADERS)) res.setHeader(name, value);
  hideFramework(res);
  if (!isProbe(req)) {
    const host = hostOf(req);
    if (host === undefined || !hostAllowed(host, config.HTTP_ALLOWED_HOSTS)) {
      res.writeHead(host === undefined ? 400 : 421, { "content-type": "text/plain; charset=utf-8" });
      res.end(host === undefined ? "http.bad_request\n" : "http.misdirected\n");
      return;
    }
  }
  note.requests.run(request, () => handler(req, res, () => res.writeHead(404).end("http.not_found\n")));
}

const server = createServer(serve);
server.once("error", () => {
  log.error("http.listen_failed", { kind: "listen" });
  process.exit(1);
});
server.listen(config.LISTEN_PORT, () => {
  exitOnSignals(async () => {
    log.info("http.drain", { phase: "start" });
    for (const step of note.shutdown.draining) step();
    const code = await drain(server, {
      graceMs: config.SHUTDOWN_GRACE_MS,
      inFlight: () => inFlight,
      hooks: note.shutdown.close,
    });
    log.info("http.drain", { phase: code === 0 ? "done" : "timeout" });
    return code;
  }, process.exit);
});
