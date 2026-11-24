// The request gate of the web process (ADR 0054, ADR 0056): what shared/http/server.ts does for Hono, done the
// SvelteKit way. SvelteKit keeps its own Origin check on form posts (it runs before this hook; kit 3.2.0
// src/runtime/server/respond.js) and the body cap (adapter-node BODY_SIZE_LIMIT, set by server.ts). server.ts does
// what every response needs, files and SvelteKit's early refusals included: the host check, the base headers, the log
// line and the drain. This hook adds, in order: the route's policy (none = refused), test routes, form-only bodies,
// the body size, the client address and its limit, the session and the DID limit, then the route under its deadline,
// and last the response's CSP: SvelteKit's own, narrowed, on a document it drew with its client (ADR 0116 point 3);
// the group's fixed one on everything else. Every check fails closed. Kit docs: https://svelte.dev/docs/kit/hooks
// (3.2.0).
import { randomUUID } from "node:crypto";
import { isRedirect, type RequestEvent, redirect } from "@sveltejs/kit";
import type { Handle, HandleServerError, ServerInit } from "@sveltejs/kit/hooks";
import { AppError, ERROR_CODES, ERROR_MESSAGES } from "@unset/shared-errors";
import { type ClientIp, createClientIpResolver } from "@unset/shared-http";
import { building, dev } from "$app/env";
import { openApp } from "./lib/server/app-gate.ts";
import { services, startServices } from "./lib/server/compose.ts";
import { narrowed, zeroScriptCsp } from "./lib/server/csp.ts";
import type { PolicyName } from "./lib/server/limits.ts";
import { type PageGroup, type RoutePolicy, runsClient } from "./lib/server/policy.ts";
import { refusalPage, wantsPage } from "./lib/server/refusal-page.ts";
import { policyOf } from "./lib/server/route-table.ts";
import { config, requestNote, stylesheet } from "./lib/server/runtime.ts";
import { sessionIssuerOrigin, sessionOf } from "./lib/server/session.ts";
import { themeChunk } from "./lib/server/theme.ts";

/** Only these bodies are accepted. SvelteKit's Origin check covers exactly the form types, so refusing every other
 * type here puts every POST under that check. */
const FORM_TYPES = new Set(["application/x-www-form-urlencoded", "multipart/form-data"]);
const UNTRUSTED_PEER_LOG_MS = 60_000;

const ZERO_SCRIPT = zeroScriptCsp(config.PUBLIC_ORIGIN);

let untrustedLoggedAt = Number.NEGATIVE_INFINITY;
const clientIpOf = createClientIpResolver(config, () => {
  if (performance.now() - untrustedLoggedAt < UNTRUSTED_PEER_LOG_MS) return;
  untrustedLoggedAt = performance.now();
  services().log.warn("proxy.untrusted_peer", {});
});

/** The gate's refusals and their codes, so `handle` can answer a browser's document request with the page. */
const REFUSALS = new WeakMap<Response, string>();

function plain(status: number, code: string, headers: Record<string, string> = {}): Response {
  const response = new Response(`${code}\n`, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", ...headers },
  });
  REFUSALS.set(response, code);
  return response;
}

/**
 * A refusal of an enhanced form post (`use:enhance` sends x-sveltekit-action) as the action failure SvelteKit's client
 * reads: JSON `{ type, status, data }` with `data` in devalue's form (kit 3.2.0 src/runtime/app/forms/shared.js
 * `deserialize`; page/actions.js `action_json`). The client hands it to the form's handler with the status, so a
 * card editor keeps what was typed and shows the catalog's words. `data` is a plain object of two strings, which
 * devalue writes as `[{"code":1,"message":2},code,message]` (checked against devalue 5.9.4's stringify and parse). No
 * request text reaches it; it is never stored.
 */
function actionFailure(code: string, refused: Response): Response {
  const message = ERROR_MESSAGES[code as keyof typeof ERROR_MESSAGES] ?? code;
  const data = JSON.stringify([{ code: 1, message: 2 }, code, message]);
  const headers = new Headers(refused.headers);
  headers.set("content-type", "application/json");
  headers.set("cache-control", "private, no-store");
  return new Response(JSON.stringify({ type: "failure", status: refused.status, data }), {
    status: refused.status,
    headers,
  });
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

/** The session part of the gate: who is asking, what a signed-out request gets, the app gate, the member's buckets. */
async function sessionProblem(event: RequestEvent, policy: RoutePolicy, deadline: AbortSignal) {
  // A page that runs no script and needs no member reads no session: its bytes never depend on a cookie, and a stale
  // cookie is not cleared there (interfaces/http's public group reads none either).
  const reads = policy.session !== undefined || policy.group === "app";
  const session = reads ? await sessionOf(event, deadline) : undefined;
  const did = session?.did;
  event.locals.issuerOrigin = sessionIssuerOrigin(session);
  event.locals.privacyNotice = false;
  const needed =
    policy.session === "required" ||
    policy.session === "onboarding" ||
    (policy.session === "writes" && !isRead(event.request));
  // The page sign-in returns to: its own route id with no parameter, else the policy's fixed returnTo.
  const next = () => {
    const path = returnPathOf(event.route.id ?? "", policy);
    if (path === null) throw new Error("gate: a session route with a parameter names no returnTo");
    return path;
  };
  if (session === undefined) {
    if (!needed) return { did };
    // A visitor, or a member whose session ended mid-edit, goes to sign-in and back, as interfaces/http does; a form
    // action enhanced by the client gets the same redirect as JSON (kit respond.js `action_json_redirect`).
    // SvelteKit's redirect keeps the cookie changes (a cleared stale cookie) and answers a client-side navigation
    // (__data.json) in the form its client expects (kit respond.js).
    const back = next();
    redirect(303, back === "/" ? "/login" : `/login?${new URLSearchParams({ next: back })}`);
  }
  if (policy.session === undefined || policy.session === "optional" || policy.probe) return { did };
  // The member's bucket first, so a refused request costs no account read and no PDS call.
  const refused = limited(limitOf(event.request, policy), { did: session.did });
  if (refused || policy.session === "onboarding") return { did, refused };
  const gate = { cookies: event.cookies, deadline, deadlineAt: event.locals.deadlineAt };
  event.locals.privacyNotice = (await openApp(gate, session, next())).privacyNotice;
  return { did };
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
    // A member's own theme on every page rendered for them; a page every visitor shares follows the system.
    const readsTheme = policy.group === "app" || did !== undefined;
    return resolve(event, { transformPageChunk: themeChunk(readsTheme, event.request.headers.get("cookie")) });
  });
};

/** The route runs under its deadline; past it the visitor gets 503 and a late result is logged, never sent. */
async function withDeadline(
  event: RequestEvent,
  policy: RoutePolicy,
  run: (deadline: AbortSignal) => Promise<Response>,
): Promise<Response> {
  const ms = (policy.bodyWindowMs ?? 0) + (policy.deadlineMs ?? config.REQUEST_DEADLINE_MS);
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

/**
 * What the gate answers for an error it caught: a catalog failure a page may show (the session store's
 * service.unavailable, the pool's db.busy, a deadline: all 503) keeps its own status and code, so the member is told to
 * try again; anything else is 500 internal.error. Only the code is sent, never the error's message or cause.
 */
function caughtResponse(error: unknown): Response {
  if (error instanceof AppError && ERROR_CODES[error.code].public) return plain(error.status, error.code);
  return plain(500, "internal.error");
}

/** The gate's outcome, an unexpected error as a code, and the group's CSP. server.ts writes the log line. */
export const handle: Handle = async (input) => {
  const { event } = input;
  const note = requestNote() ?? { reqId: randomUUID() };
  note.route = event.route.id ?? "/unmatched";
  event.locals.reqId = note.reqId;
  event.locals.erred = false;
  let response: Response;
  try {
    response = await gate(input);
  } catch (error) {
    if (isRedirect(error)) throw error; // SvelteKit builds it; server.ts still gives it the headers and the log line
    services().log.logError(error);
    response = caughtResponse(error);
  }
  const policy = policyOf(event.route.id);
  const route: Headed = { group: policy?.group ?? "static", client: runsClient(policy), erred: event.locals.erred };
  const refused = REFUSALS.get(response);
  const optional = policy?.session === "optional";
  const audience: Audience = { member: event.locals.did !== undefined, optional };
  if (refused !== undefined && event.request.headers.has("x-sveltekit-action")) {
    return withGroupHeaders(actionFailure(refused, response), route, event.isDataRequest, audience);
  }
  if (refused !== undefined && wantsPage(event.request, event.isDataRequest)) {
    const styled = route.group === "app" || route.group === "public";
    response = refusalPage(refused, response.status, response.headers, styled ? stylesheet() : undefined);
    // A styled refusal page runs no script and loads only the build's styles and our fonts: the public policy. The app
    // group's fallback (default-src 'none') would block its stylesheet.
    if (styled) return withGroupHeaders(response, route, event.isDataRequest, audience, "public");
  }
  return withGroupHeaders(response, route, event.isDataRequest, audience);
};

/**
 * What the response headers follow: the route's group, whether its own page runs the client, and whether SvelteKit
 * reported an error for this request (handleError below), which is when it draws the error page.
 */
type Headed = Readonly<{ group: PageGroup; client: boolean; erred: boolean }>;

/**
 * SvelteKit names a script by its hash in its own policy only when it wrote its start-up script into the document,
 * which it does exactly for a page drawn with `csr` on (kit 3.2.0 src/runtime/server/page/render.js:339 and 552;
 * kit.csp mode "hash" in vite.config.ts). So this reads what the server put in the document, never the request.
 */
const namesStartUpScript = (kit: string): boolean => /(?:^|;)\s*script-src\s[^;]*'sha256-/.test(kit);

/** Who a response was rendered for: a member (the gate read a live session), and whether the route reads one if sent. */
type Audience = Readonly<{ member: boolean; optional: boolean }>;

/**
 * The header follows the document (ADR 0116 point 3). SvelteKit's CSP, narrowed to our paths, goes out on a document
 * SvelteKit drew with its client, and that takes two facts of what the server did, both needed: its policy names the
 * start-up script it wrote into the document, and that document is one that may run it, which is the route's own page
 * unless its policy says `client: false`, or the error page, drawn when SvelteKit reported an error (for it SvelteKit
 * takes `csr` from the layouts alone, kit 3.2.0 src/runtime/server/page/index.js:272-291, and the root layout says
 * true). That SvelteKit sent a policy is not the signal: it sends one with every page it draws (page/render.js:577-579).
 * A page that says `client: false` and still carried a start-up script gets the fixed policy, in either group, and
 * runs nothing. Every other response gets its group's fixed one: refusals, redirects, the data address, files. One
 * exception stays as it was: an `app` page without the client (/login, the form targets) keeps SvelteKit's policy
 * while that names no hash, so no inline script runs there; book P1.22l settles what those pages carry. An
 * `app` page, and the data its client loads (__data.json), may differ per member, so it is private, never stored and
 * varies on Cookie, as interfaces/http/prefs/theme.ts has it. So is any other response rendered for a member, or one
 * that clears a cookie, whatever the page asked for. A page with an `optional` session varies on Cookie even for a
 * visitor, so a browser that signs in never reuses the visitor copy it kept; other public pages read no cookie, so
 * their bytes never depend on one.
 */
function withGroupHeaders(
  response: Response,
  route: Headed,
  dataRequest: boolean,
  audience: Audience,
  cspGroup: PageGroup = route.group,
): Response {
  const { group } = route;
  const out = new Response(response.body, response); // SvelteKit's own responses may have immutable headers
  const html = out.headers.get("content-type")?.startsWith("text/html") === true;
  // A redirect is never stored, as interfaces/http's redirect.ts sends it (a 303 is not cacheable without explicit
  // freshness anyway, RFC 9110 §15.4.4; this keeps it so behind any cache).
  if (out.status >= 300 && out.status < 400 && !out.headers.has("cache-control")) {
    out.headers.set("cache-control", "no-store");
  }
  const personal = audience.member || out.headers.has("set-cookie");
  if ((group === "app" && (html || dataRequest)) || (group !== "app" && personal)) {
    out.headers.set("cache-control", "private, no-store");
    out.headers.append("vary", "Cookie");
  } else if (audience.optional) {
    out.headers.append("vary", "Cookie");
  }
  const kit = out.headers.get("content-security-policy");
  const mayRunClient = route.client || route.erred;
  // With a start-up script in the document, SvelteKit's policy only where that document may run it; with none, only
  // on an app page, as before.
  const keepsKit = kit !== null && (namesStartUpScript(kit) ? mayRunClient : group === "app");
  out.headers.set("content-security-policy", keepsKit ? kitPolicy(kit) : ZERO_SCRIPT[cspGroup]);
  return out;
}

/**
 * SvelteKit's own policy for a page that runs its client, narrowed to our paths. Under `vite dev` Vite serves files
 * from other paths, so 'self' stays (ADR 0054 decision 5).
 */
const kitPolicy = (kit: string): string => (dev ? kit : narrowed(kit, config.PUBLIC_ORIGIN));

/**
 * An error a route did not answer itself. SvelteKit's own (a 404, a bad request) is shown by its code with nothing
 * logged; anything else is logged by code and class only, and the page shows a code and the request id, never the
 * message (kit 3.2.0 types: CaughtError's `kind`).
 */
export const handleError: HandleServerError = (caught) => {
  caught.event.locals.erred = true; // SvelteKit draws the error page for this request; `handle` reads it for the CSP
  if (caught.kind === "framework" || caught.kind === "validation")
    return { message: caught.error.status === 404 ? "http.not_found" : "http.bad_request" };
  if (caught.kind === "app") return caught.error;
  services().log.logError(caught.error);
  return { message: "internal.error", reqId: caught.event.locals.reqId };
};
