// The server kit (P1.04k; plan §5.1): one Hono server per entrypoint, every request through the same fixed checks,
// errors rendered by code, a deadline on every request, and a graceful drain on SIGTERM.
//
// Middleware order (later steps fill the empty slots): requestId → hostCheck → trustedProxy (P1.05) →
// securityHeaders (P1.08) → methodCheck → contentTypeCheck → bodyLimit (P1.06) → rateLimitIp (P1.06) → csrf (P1.07)
// → session (Phase 2) → rateLimitDid (P1.06) → handler.
import { randomUUID } from "node:crypto";
import { createAdaptorServer, type ServerType } from "@hono/node-server";
import { AppError, type ErrorCode } from "@unset/shared-errors";
import type { LogFields, Logger } from "@unset/shared-log";
import { Hono } from "hono";
import { type HttpKitConfig, hostAllowed } from "./config.ts";
import { errorResponse, groupForPath } from "./errors.ts";
import { createHealth, type Readiness } from "./health.ts";
import { compileRoute, defineRoute, type Route, type RouteGroup } from "./routes.ts";
import { type CloseHook, drain, exitOnSignals } from "./shutdown.ts";
import { createClientIpResolver } from "./trustedProxy.ts";

/** An interface's rate-limit policies by name (P1.06p fills the values); routes name one of its keys. */
export type PolicyTable = Readonly<Record<string, unknown>>;
/** A route as P1.04's committed manifest records it: every `defineRoute` option except the handler, plus its checks. */
export type RouteInfo = Omit<Route, "handler"> & { middleware: string[] };

export type ServerOptions = {
  config: HttpKitConfig;
  routes: readonly Route[];
  policies: PolicyTable;
  log: Logger;
  readiness?: readonly Readiness[];
  onClose?: readonly CloseHook[];
  /** The group for errors before a route matched; the admin server is all `admin`. Default: by path prefix. */
  errorGroup?: RouteGroup;
  now?: () => number;
  exit?: (code: number) => void;
};

/** Node's HTTP/1.1 server, which `createAdaptorServer` returns when given no other `createServer`. */
type NodeServer = Extract<ServerType, { closeIdleConnections: unknown }>;
type Matched = { route: Route; params: Record<string, string> };
/** The bindings `@hono/node-server` 2.1.1 passes to `fetch`: `{ incoming, outgoing }` (its dist/conninfo.mjs). */
type NodeBindings = { incoming?: { socket?: { remoteAddress?: string } } };
/** `proxy.untrusted_peer` is logged at most once per this window, so a misrouted flood cannot flood the log. */
const UNTRUSTED_PEER_LOG_MS = 60_000;

const LOGGED_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

function checkRoutes(routes: readonly Route[], policies: PolicyTable): void {
  const seen = new Set<string>();
  for (const route of routes) {
    const key = `${route.method} ${route.path}`;
    if (seen.has(key)) throw new Error(`route defined twice: ${key}`);
    seen.add(key);
    if (route.rateLimit !== "exempt" && !Object.hasOwn(policies, route.rateLimit)) {
      throw new Error(`${key}: rate-limit policy ${route.rateLimit} is not in this interface's table`);
    }
  }
}

/** The checks a route passes through, in order (P1.07's static test reads them). */
function middlewareOf(route: Pick<Route, "path" | "method">): string[] {
  return [
    "requestId",
    ...(route.path === "/health" ? [] : ["hostCheck", "trustedProxy"]),
    "methodCheck",
    ...(route.method === "POST" ? ["contentTypeCheck"] : []),
  ];
}

/** The request's host, lowercase, with the public port stripped; `undefined` when there is none. */
function requestHost(header: string | undefined, publicOrigin: URL): string | undefined {
  if (header === undefined || header === "") return undefined;
  const host = header.toLowerCase();
  const port = publicOrigin.port || (publicOrigin.protocol === "https:" ? "443" : "80");
  return host.endsWith(`:${port}`) ? host.slice(0, -port.length - 1) : host;
}

/** The raw path, or `undefined` when its percent-encoding is invalid or it decodes to a NUL. */
function validPath(url: string): string | undefined {
  const path = new URL(url).pathname;
  try {
    return decodeURIComponent(path).includes("\0") ? undefined : path;
  } catch {
    return undefined;
  }
}

export function createServer(options: ServerOptions) {
  const { config, log } = options;
  const now = options.now ?? (() => performance.now());
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const publicOrigin = new URL(config.PUBLIC_ORIGIN);
  const health = createHealth({
    service: config.UNSET_SERVICE,
    commit: config.UNSET_COMMIT,
    checks: options.readiness ?? [],
    now,
  });
  const healthRoute = defineRoute({
    method: "GET",
    path: "/health",
    group: "static",
    rateLimit: "exempt",
    handler: () => health.respond(),
  });
  const routes = [healthRoute, ...options.routes];
  checkRoutes(routes, options.policies);
  const compiled = routes.map(compileRoute);

  let untrustedLoggedAt = Number.NEGATIVE_INFINITY;
  const clientIpOf = createClientIpResolver(config, () => {
    if (now() - untrustedLoggedAt < UNTRUSTED_PEER_LOG_MS) return;
    untrustedLoggedAt = now();
    log.warn("proxy.untrusted_peer", {});
  });

  const errorGroup = (path: string) => options.errorGroup ?? groupForPath(path);
  const fail = (code: ErrorCode, group: RouteGroup, headers?: Record<string, string>) =>
    errorResponse(code, group, headers);

  /** Step 2: a missing host is 400, one not in HTTP_ALLOWED_HOSTS is 421. `/health` skips it (probes). */
  function hostProblem(request: Request, rawPath: string): ErrorCode | undefined {
    if (rawPath === "/health") return undefined;
    const host = requestHost(request.headers.get("host") ?? undefined, publicOrigin);
    if (host === undefined) return "http.bad_request";
    return hostAllowed(host, config.HTTP_ALLOWED_HOSTS) ? undefined : "http.misdirected";
  }

  /** Steps 3 and 5: the route for this method and path, or the 404 or 405 that answers instead. */
  function findRoute(method: string, path: string): Matched | Response {
    if (method !== "GET" && method !== "POST") {
      return fail("http.method_not_allowed", errorGroup(path), { allow: "GET, HEAD, POST" });
    }
    const candidates = compiled.flatMap((c) => {
      const params = c.match(path);
      return params ? [{ route: c.route, params }] : [];
    });
    const matched = candidates.find((c) => c.route.method === method);
    if (matched) return matched;
    if (candidates.length === 0) return fail("http.not_found", errorGroup(path));
    const allow = new Set(candidates.flatMap((c) => (c.route.method === "GET" ? ["GET", "HEAD"] : ["POST"])));
    return fail("http.method_not_allowed", candidates[0]?.route.group ?? "app", { allow: [...allow].join(", ") });
  }

  /** Step 4: a POST's media type (parameters ignored, lowercased) must be one the route accepts. */
  const acceptsBody = (request: Request, route: Route): boolean => {
    if (route.method !== "POST") return true;
    const type = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    return type !== undefined && type !== "" && route.accepts.includes(type);
  };

  /** Steps 2–5 in order. A response means the request stops here. */
  function check(request: Request): Matched | Response {
    const rawPath = new URL(request.url).pathname;
    const badHost = hostProblem(request, rawPath);
    if (badHost) return fail(badHost, errorGroup(rawPath));
    const path = validPath(request.url);
    if (path === undefined) return fail("http.bad_request", errorGroup(rawPath));
    const found = findRoute(request.method === "HEAD" ? "GET" : request.method, path);
    if (found instanceof Response) return found;
    return acceptsBody(request, found.route) ? found : fail("http.unsupported_media_type", found.route.group);
  }

  /** Step 1 and 6: the handler under the route's deadline; `AppError` by code, anything else as `internal.error`. */
  async function run({ route, params }: Matched, request: Request, reqId: string, peer?: string): Promise<Response> {
    const deadline = AbortSignal.timeout(route.deadlineMs ?? config.REQUEST_DEADLINE_MS);
    // Step 2b, trustedProxy: every route but /health, which needs no client identity (architecture ruling 2026-10-05).
    const clientIp = route.path === "/health" ? null : clientIpOf(request.headers, peer);
    const result = Promise.resolve().then(() => route.handler({ request, clientIp, params, deadline, reqId }));
    const timedOut = new Promise<"deadline">((resolve) => {
      deadline.addEventListener("abort", () => resolve("deadline"), { once: true });
    });
    try {
      const outcome = await Promise.race([result, timedOut]);
      if (outcome !== "deadline") return outcome;
      log.warn("http.deadline", { route: route.path, reqId });
      result.then(
        () => log.warn("http.late_result", { route: route.path, reqId }),
        () => log.warn("http.late_result", { route: route.path, reqId }),
      );
      return fail("http.deadline", route.group);
    } catch (error) {
      if (error instanceof AppError) return fail(error.code, route.group);
      log.logError(error);
      return fail("internal.error", route.group);
    }
  }

  async function handle(request: Request, peer: string | undefined): Promise<Response> {
    const started = now();
    const reqId = randomUUID();
    const checked = check(request);
    const matched = checked instanceof Response ? undefined : checked;
    let response = matched ? await run(matched, request, reqId, peer) : (checked as Response);
    if (health.state === "draining") {
      response = new Response(response.body, response);
      response.headers.set("connection", "close");
    }
    log.info("http.request", {
      ...(matched ? { route: matched.route.path } : {}),
      ...(LOGGED_METHODS.has(request.method) ? { method: request.method as LogFields["method"] & string } : {}),
      status: response.status,
      ms: Math.round(now() - started),
      reqId,
    });
    return response;
  }

  // Hono answers HEAD by running the GET path and dropping the body; every other method reaches `handle`.
  const app = new Hono<{ Bindings: NodeBindings }>();
  app.all("*", (c) => handle(c.req.raw, c.env?.incoming?.socket?.remoteAddress));

  let inFlight = 0;
  let server: NodeServer | undefined;

  const close = async (): Promise<0 | 1> => {
    health.setState("draining");
    log.info("http.drain", { phase: "start" });
    const code = server
      ? await drain(server, {
          graceMs: config.SHUTDOWN_GRACE_MS,
          inFlight: () => inFlight,
          hooks: options.onClose ?? [],
        })
      : 0;
    log.info("http.drain", { phase: code === 0 ? "done" : "timeout" });
    return code;
  };

  return {
    /** Serves one request in-process (tests) from socket peer `peer`; the same checks run as for a socket request. */
    request: (request: Request, peer?: string): Promise<Response> =>
      Promise.resolve(app.fetch(request, peer === undefined ? {} : { incoming: { socket: { remoteAddress: peer } } })),
    routeTable: (): RouteInfo[] =>
      routes.map(({ handler: _handler, ...options }) => ({ ...options, middleware: middlewareOf(options) })),
    /** Listens on LISTEN_PORT and drains on SIGTERM or SIGINT; resolves with the bound port. Exits 1 if it cannot. */
    listen: (): Promise<number> =>
      new Promise((resolve) => {
        const node = createAdaptorServer({ fetch: app.fetch }) as NodeServer;
        node.on("request", (_req, res) => {
          inFlight += 1;
          res.once("close", () => {
            inFlight -= 1;
          });
        });
        node.once("error", () => {
          log.error("http.listen_failed", { kind: "listen" });
          exit(1);
        });
        node.listen(config.LISTEN_PORT, () => {
          server = node;
          health.setState("running");
          exitOnSignals(close, exit);
          const address = node.address();
          resolve(typeof address === "object" && address !== null ? address.port : config.LISTEN_PORT);
        });
      }),
    close,
  };
}
