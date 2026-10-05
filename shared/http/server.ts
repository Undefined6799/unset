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
import type { ClientIp } from "./clientIp.ts";
import { type HttpKitConfig, hostAllowed } from "./config.ts";
import { createCsrfGate } from "./csrf/gate.ts";
import { errorResponse, groupForPath } from "./errors.ts";
import { createHealth, type Readiness } from "./health.ts";
import { BodyTooLarge, limitBody } from "./limits/bodyLimit.ts";
import { hasDidEntry, type PolicyTable } from "./limits/policy.ts";
import { createRateLimiter, type RateLimiter, type RateSubject } from "./limits/rateLimit.ts";
import { compileRoute, defineRoute, type Route, type RouteGroup } from "./routes.ts";
import { type CloseHook, drain, exitOnSignals } from "./shutdown.ts";
import { createClientIpResolver } from "./trustedProxy.ts";

/** The signed-in DID for a request, or null. Phase 2's session layer supplies it; until then no session exists. */
export type SessionReader = (request: Request) => Promise<{ did: string } | null>;
/** A route as P1.04's committed manifest records it: every `defineRoute` option except the handler, plus its checks. */
export type RouteInfo = Omit<Route, "handler"> & { middleware: string[] };

export type ServerOptions = {
  config: HttpKitConfig;
  routes: readonly Route[];
  /** The interface's own rate-limit table (P1.06p); routes name one of its keys. */
  policies: PolicyTable;
  session?: SessionReader;
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
/** A request past the checks, and whether its streamed body has gone over the limit. */
type Admitted = { request: Request; exceeded: () => boolean };
/** The bindings `@hono/node-server` 2.1.1 passes to `fetch`: `{ incoming, outgoing }` (its dist/conninfo.mjs). */
type NodeBindings = { incoming?: { socket?: { remoteAddress?: string } } };
/** `proxy.untrusted_peer` is logged at most once per this window, so a misrouted flood cannot flood the log. */
const UNTRUSTED_PEER_LOG_MS = 60_000;
/** How often idle rate-limit buckets are swept and the salt's age checked (P1.06 step 5). */
const SWEEP_MS = 10_000;

const LOGGED_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

function checkRoutes(routes: readonly Route[], policies: PolicyTable): void {
  const seen = new Set<string>();
  for (const route of routes) {
    const key = `${route.method} ${route.path}`;
    if (seen.has(key)) throw new Error(`route defined twice: ${key}`);
    seen.add(key);
    if (route.rateLimit === "exempt") continue;
    const policy = Object.hasOwn(policies, route.rateLimit) ? policies[route.rateLimit] : undefined;
    if (policy === undefined) {
      throw new Error(`${key}: rate-limit policy ${route.rateLimit} is not in this interface's table`);
    }
    if (Array.isArray(policy) && hasDidEntry(policy) && !route.requiresSession) {
      throw new Error(`${key}: policy ${route.rateLimit} limits per DID, so the route must set session: "required"`);
    }
  }
}

/** The checks a route passes through, in order (P1.07's static test reads them). */
function middlewareOf(route: Pick<Route, "path" | "method" | "rateLimit" | "requiresSession">): string[] {
  return [
    "requestId",
    ...(route.path === "/health" ? [] : ["hostCheck", "trustedProxy"]),
    "methodCheck",
    ...(route.method === "POST" ? ["contentTypeCheck", "bodyLimit"] : []),
    ...(route.rateLimit === "exempt" ? [] : ["rateLimitIp"]),
    ...(route.method === "POST" ? ["csrf"] : []),
    ...(route.requiresSession ? ["session", "rateLimitDid"] : []),
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
  const csrfGate = createCsrfGate(config.PUBLIC_ORIGIN);
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
    session: "none",
    handler: () => health.respond(),
  });
  const routes = [healthRoute, ...options.routes];
  checkRoutes(routes, options.policies);
  const compiled = routes.map(compileRoute);
  // Built only when a route is limited, so an interface with no routes yet needs no table (its table comes at P1.06p).
  const limiter: RateLimiter | undefined = routes.some((r) => r.rateLimit !== "exempt")
    ? createRateLimiter(options.policies, {
        maxKeys: config.RATE_LIMIT_MAX_KEYS,
        onError: () => log.error("ratelimit.error", {}),
        now,
      })
    : undefined;

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

  /** rateLimitIp and rateLimitDid: a 429 with `Retry-After` when `subject` is over the route's policy. */
  function rateLimited(route: Route, subject: RateSubject): Response | undefined {
    if (limiter === undefined || route.rateLimit === "exempt") return undefined;
    const verdict = limiter.consume(route.rateLimit, subject);
    if (verdict.ok) return undefined;
    return fail("http.rate_limited", route.group, { "retry-after": String(verdict.retryAfterS) });
  }

  /** csrf (P1.07): a 403 when a POST is not same-origin; GET and HEAD routes are never gated (they cannot mutate). */
  function csrfDenied(route: Route, request: Request): Response | undefined {
    if (route.method !== "POST") return undefined;
    const decision = csrfGate(request);
    if (decision.ok) return undefined;
    log.warn("csrf.denied", { route: route.path, reason: decision.reason });
    return fail("csrf.denied", route.group);
  }

  /** 413, closing the connection so the client cannot keep streaming the rest of the body. */
  const tooLarge = (group: RouteGroup) => fail("http.payload_too_large", group, { connection: "close" });

  /**
   * Steps 7–11 in order: bodyLimit → rateLimitIp → csrf (P1.07) → session → rateLimitDid. A response means the
   * request stops here; otherwise the request to hand on, its body counted against the limit.
   */
  async function admit(route: Route, request: Request, clientIp: ClientIp | null): Promise<Admitted | Response> {
    let admitted: Admitted = { request, exceeded: () => false };
    if (route.method === "POST") {
      const limited = limitBody(request, route.bodyLimit ?? config.HTTP_BODY_LIMIT_BYTES);
      if (!limited.ok) return limited.status === 413 ? tooLarge(route.group) : fail("http.bad_request", route.group);
      admitted = limited;
    }
    const byIp = rateLimited(route, { ip: clientIp });
    if (byIp) return byIp;
    const crossSite = csrfDenied(route, request);
    if (crossSite) return crossSite;
    if (!route.requiresSession) return admitted;
    const session = options.session ? await options.session(admitted.request) : null;
    if (session === null) {
      // Fail closed: a session-only route never runs, and is never limited as "no DID, no limit".
      log.error("ratelimit.no_session", { route: route.path });
      return fail("internal.error", route.group);
    }
    return rateLimited(route, { did: session.did }) ?? admitted;
  }

  /** Steps 1 and 7–12: the checks and the handler under the route's deadline; errors render by code. */
  async function run({ route, params }: Matched, request: Request, reqId: string, peer?: string): Promise<Response> {
    const deadline = AbortSignal.timeout(route.deadlineMs ?? config.REQUEST_DEADLINE_MS);
    // Step 2b, trustedProxy: every route but /health, which needs no client identity (architecture ruling 2026-10-05).
    const clientIp = route.path === "/health" ? null : clientIpOf(request.headers, peer);
    let exceeded = () => false;
    const admitThenHandle = async (): Promise<Response> => {
      const admitted = await admit(route, request, clientIp);
      if (admitted instanceof Response) return admitted;
      exceeded = admitted.exceeded;
      return route.handler({ request: admitted.request, clientIp, params, deadline, reqId });
    };
    const result = admitThenHandle(); // awaited in the race below; after a deadline, its late result is logged
    const timedOut = new Promise<"deadline">((resolve) => {
      deadline.addEventListener("abort", () => resolve("deadline"), { once: true });
    });
    try {
      const outcome = await Promise.race([result, timedOut]);
      if (exceeded()) return tooLarge(route.group); // the body went over the limit, whatever the handler answered
      if (outcome !== "deadline") return outcome;
      log.warn("http.deadline", { route: route.path, reqId });
      result.then(
        () => log.warn("http.late_result", { route: route.path, reqId }),
        () => log.warn("http.late_result", { route: route.path, reqId }),
      );
      return fail("http.deadline", route.group);
    } catch (error) {
      if (exceeded() || error instanceof BodyTooLarge) return tooLarge(route.group);
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
  let sweeper: ReturnType<typeof setInterval> | undefined;

  const close = async (): Promise<0 | 1> => {
    health.setState("draining");
    clearInterval(sweeper);
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
          if (limiter) sweeper = setInterval(limiter.sweep, SWEEP_MS).unref();
          health.setState("running");
          exitOnSignals(close, exit);
          const address = node.address();
          resolve(typeof address === "object" && address !== null ? address.port : config.LISTEN_PORT);
        });
      }),
    close,
  };
}
