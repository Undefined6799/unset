// The request gate of the web process (ADR 0054, ADR 0056): what shared/http/server.ts does for Hono, done the
// SvelteKit way. SvelteKit keeps its own Origin check on form posts (it runs before this hook; kit 3.2.0
// src/runtime/server/respond.js) and the body cap (adapter-node BODY_SIZE_LIMIT, set by server.ts). server.ts does
// what every response needs, files and SvelteKit's early refusals included: the host check, the base headers, the log
// line and the drain. This hook adds, in order: the route's policy (none = refused), test routes, form-only bodies,
// the body size, the client address and its limit, the session and the DID limit, then the route under its deadline,
// and last the group's CSP. Every check fails closed. Kit docs: https://svelte.dev/docs/kit/hooks (3.2.0).
import { randomUUID } from "node:crypto";
import { isRedirect, type RequestEvent, redirect } from "@sveltejs/kit";
import type { Handle, HandleServerError, ServerInit } from "@sveltejs/kit/hooks";
import { type ClientIp, createClientIpResolver } from "@unset/shared-http";
import { building, dev } from "$app/env";
import { services, startServices } from "./lib/server/compose.ts";
import { narrowed, zeroScriptCsp } from "./lib/server/csp.ts";
import type { PolicyName } from "./lib/server/limits.ts";
import type { PageGroup, RoutePolicy } from "./lib/server/policy.ts";
import { policyOf } from "./lib/server/route-table.ts";
import { config, requestNote } from "./lib/server/runtime.ts";
import { sessionIssuerOrigin, sessionOf } from "./lib/server/session.ts";

/** Only these bodies are accepted. SvelteKit's Origin check covers exactly the form types, so refusing every other
 * type here puts every POST under that check. */
const FORM_TYPES = new Set(["application/x-www-form-urlencoded", "multipart/form-data"]);
const UNTRUSTED_PEER_LOG_MS = 60_000;

const ZERO_SCRIPT = zeroScriptCsp(config.PUBLIC_ORIGIN, config.MEDIA_ORIGIN);

let untrustedLoggedAt = Number.NEGATIVE_INFINITY;
const clientIpOf = createClientIpResolver(config, () => {
  if (performance.now() - untrustedLoggedAt < UNTRUSTED_PEER_LOG_MS) return;
  untrustedLoggedAt = performance.now();
  services().log.warn("proxy.untrusted_peer", {});
});

function plain(status: number, code: string, headers: Record<string, string> = {}): Response {
  return new Response(`${code}\n`, { status, headers: { "content-type": "text/plain; charset=utf-8", ...headers } });
}

/** Checks on the request itself, before anyone is identified: method, body type and declared size. */
function requestProblem(request: Request, policy: RoutePolicy): Response | undefined {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  if (request.method !== "POST") return plain(405, "http.method_not_allowed", { allow: "GET, HEAD, POST" });
  if (policy.maxBody === undefined) return plain(405, "http.method_not_allowed", { allow: "GET, HEAD" });
  const type = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!FORM_TYPES.has(type)) return plain(415, "http.unsupported_media_type");
  // A body with no declared length (chunked) is refused; BODY_SIZE_LIMIT still counts what is read.
  const length = Number(request.headers.get("content-length") ?? "NaN");
  if (!Number.isFinite(length) || length > policy.maxBody)
    return plain(413, "http.payload_too_large", { connection: "close" });
  return undefined;
}

/** The policy this request counts against: a POST uses the route's write policy when it has one. */
const limitOf = (request: Request, policy: RoutePolicy): PolicyName =>
  request.method === "POST" && policy.writeLimit !== undefined ? policy.writeLimit : policy.limit;

function limited(name: PolicyName, subject: { ip: ClientIp | null } | { did: string }): Response | undefined {
  const verdict = services().limiter.consume(name, subject);
  return verdict.ok ? undefined : plain(429, "http.rate_limited", { "retry-after": String(verdict.retryAfterS) });
}

const isRead = (request: Request): boolean => request.method === "GET" || request.method === "HEAD";

/**
 * The path a signed-out GET of a `required` page returns to after sign-in: its own route id without layout groups
 * when it has no parameter, else the policy's fixed `returnTo`; null when neither (the gate refuses). Never the
 * request's own URL, so no request text reaches the query.
 */
function returnPathOf(routeId: string, policy: RoutePolicy): string | null {
  const path = routeId.replace(/\/\([^/]+\)/g, "") || "/";
  return policy.returnTo ?? (path.includes("[") ? null : path);
}

/** The session part of the gate: who is asking, what a signed-out request gets, and the member's own buckets. */
async function sessionProblem(event: RequestEvent, policy: RoutePolicy, deadline: AbortSignal) {
  // A page that runs no script and needs no member reads no session: its bytes never depend on a cookie, and a stale
  // cookie is not cleared there (interfaces/http's public group reads none either).
  const reads = policy.session !== undefined || policy.group === "app";
  const session = reads ? await sessionOf(event, deadline) : undefined;
  const did = session?.did;
  event.locals.issuerOrigin = sessionIssuerOrigin(session);
  const needed = policy.session === "required" || (policy.session === "writes" && !isRead(event.request));
  if (did === undefined) {
    if (!needed) return { did };
    // A visitor, or a member whose session ended mid-edit, goes to sign-in and back, as interfaces/http does; a form
    // action enhanced by the client gets the same redirect as JSON (kit respond.js `action_json_redirect`).
    const next = returnPathOf(event.route.id ?? "", policy);
    if (next === null) throw new Error("gate: a session route with a parameter names no returnTo");
    // SvelteKit's redirect keeps the cookie changes (a cleared stale cookie) and answers a client-side navigation
    // (__data.json) in the form its client expects (kit respond.js).
    redirect(303, next === "/" ? "/login" : `/login?${new URLSearchParams({ next })}`);
  }
  if (policy.session === undefined || policy.probe) return { did };
  return { did, refused: limited(limitOf(event.request, policy), { did }) };
}

/** The gate, in order; a Response means the request stops there. */
const gate: Handle = async ({ event, resolve }) => {
  const policy = policyOf(event.route.id);
  if (policy === undefined) {
    services().log.error("error", { code: "internal.error", route: "/unlisted" }); // a route with no policy.ts: refuse, never guess
    return plain(500, "internal.error");
  }
  if (policy.testOnly && config.TEST_ROUTES !== true) return plain(404, "http.not_found");
  const problem = requestProblem(event.request, policy);
  if (problem) return problem;
  const byIp = policy.probe
    ? undefined
    : limited(limitOf(event.request, policy), { ip: clientIpOf(event.request.headers, event.getClientAddress()) });
  if (byIp) return byIp;
  return withDeadline(event, policy, async (deadline) => {
    const { did, refused } = await sessionProblem(event, policy, deadline);
    if (refused) return refused;
    event.locals.did = did;
    return resolve(event);
  });
};

/** The route runs under its deadline; past it the visitor gets 503 and a late result is logged, never sent. */
async function withDeadline(
  event: RequestEvent,
  policy: RoutePolicy,
  run: (deadline: AbortSignal) => Promise<Response>,
): Promise<Response> {
  const ms = policy.deadlineMs ?? config.REQUEST_DEADLINE_MS;
  const deadline = AbortSignal.timeout(ms);
  event.locals.deadline = deadline; // loads and actions pass it to every call they make
  event.locals.deadlineAt = performance.now() + ms;
  const result = run(deadline);
  const timedOut = new Promise<"deadline">((done) =>
    deadline.addEventListener("abort", () => done("deadline"), { once: true }),
  );
  const outcome = await Promise.race([result, timedOut]);
  if (outcome !== "deadline") return outcome;
  const { log } = services();
  const route = event.route.id ?? "/unmatched";
  log.warn("http.deadline", { route, reqId: event.locals.reqId });
  result.then(
    () => log.warn("http.late_result", { route, reqId: event.locals.reqId }),
    () => log.warn("http.late_result", { route, reqId: event.locals.reqId }),
  );
  return plain(503, "http.deadline");
}

/**
 * Builds every service before the first request: adapter-node awaits this while its handler is imported, so a bad
 * database, key or connection budget stops the process before server.ts listens (kit 3.2.0
 * src/runtime/server/instance.js `init`; https://svelte.dev/docs/kit/hooks#Shared-hooks-init). Not while building.
 */
export const init: ServerInit = async () => {
  if (!building) await startServices();
};

/** The gate's outcome, an unexpected error as a code, and the group's CSP. server.ts writes the log line. */
export const handle: Handle = async (input) => {
  const { event } = input;
  const note = requestNote() ?? { reqId: randomUUID() };
  note.route = event.route.id ?? "/unmatched";
  event.locals.reqId = note.reqId;
  let response: Response;
  try {
    response = await gate(input);
  } catch (error) {
    if (isRedirect(error)) throw error; // SvelteKit builds it; server.ts still gives it the headers and the log line
    services().log.logError(error);
    response = plain(500, "internal.error");
  }
  const group = policyOf(event.route.id)?.group ?? "static";
  return withGroupHeaders(response, group, event.isDataRequest);
};

/**
 * An `app` page keeps SvelteKit's CSP, narrowed to our paths; every other response gets its group's fixed one. An
 * `app` page, and the data its client loads (__data.json), may differ per member, so it is private, never stored and
 * varies on Cookie, as interfaces/http/prefs/theme.ts has it; public pages get neither, so their bytes never depend on
 * a cookie.
 */
function withGroupHeaders(response: Response, group: PageGroup, dataRequest: boolean): Response {
  const out = new Response(response.body, response); // SvelteKit's own responses may have immutable headers
  const html = out.headers.get("content-type")?.startsWith("text/html") === true;
  if (group === "app" && (html || dataRequest)) {
    out.headers.set("cache-control", "private, no-store");
    out.headers.append("vary", "Cookie");
  }
  const kit = out.headers.get("content-security-policy");
  if (group === "app" && kit !== null) {
    // Under `vite dev` Vite serves files from other paths, so 'self' stays (ADR 0054 decision 5).
    if (!dev) out.headers.set("content-security-policy", narrowed(kit, config.PUBLIC_ORIGIN));
  } else {
    out.headers.set("content-security-policy", ZERO_SCRIPT[group]);
  }
  return out;
}

/**
 * An error a route did not answer itself. SvelteKit's own (a 404, a bad request) is shown by its code with nothing
 * logged; anything else is logged by code and class only, and the page shows a code and the request id, never the
 * message (kit 3.2.0 types: CaughtError's `kind`).
 */
export const handleError: HandleServerError = (caught) => {
  if (caught.kind === "framework" || caught.kind === "validation")
    return { message: caught.error.status === 404 ? "http.not_found" : "http.bad_request" };
  if (caught.kind === "app") return caught.error;
  services().log.logError(caught.error);
  return { message: "internal.error", reqId: caught.event.locals.reqId };
};
