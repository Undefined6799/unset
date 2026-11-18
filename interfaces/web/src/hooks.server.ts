// The request gate of the web process (ADR 0054, ADR 0056): what shared/http/server.ts does for Hono, done the
// SvelteKit way. SvelteKit keeps its own Origin check on form posts (it runs before this hook; kit 3.2.0
// src/runtime/server/respond.js) and the body cap (adapter-node BODY_SIZE_LIMIT, set by server.ts). server.ts does
// what every response needs, files and SvelteKit's early refusals included: the host check, the base headers, the log
// line and the drain. This hook adds, in order: the route's policy (none = refused), test routes, form-only bodies,
// the body size, the client address and its limit, the session and the DID limit, then the route under its deadline,
// and last the group's CSP. Every check fails closed. Kit docs: https://svelte.dev/docs/kit/hooks (3.2.0).
import { randomUUID } from "node:crypto";
import { isRedirect, type RequestEvent, redirect } from "@sveltejs/kit";
import type { Handle, HandleServerError } from "@sveltejs/kit/hooks";
import { type ClientIp, createClientIpResolver } from "@unset/shared-http";
import { dev } from "$app/env";
import { services } from "./lib/server/compose.ts";
import { narrowed, zeroScriptCsp } from "./lib/server/csp.ts";
import type { PageGroup, RoutePolicy } from "./lib/server/policy.ts";
import { policyOf } from "./lib/server/route-table.ts";
import { config, requestNote } from "./lib/server/runtime.ts";
import { sessionDidOf } from "./lib/server/session.ts";

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

function limited(policy: RoutePolicy, subject: { ip: ClientIp | null } | { did: string }): Response | undefined {
  if (policy.probe) return undefined;
  const verdict = services().limiter.consume(policy.limit, subject);
  return verdict.ok ? undefined : plain(429, "http.rate_limited", { "retry-after": String(verdict.retryAfterS) });
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
    : limited(policy, { ip: clientIpOf(event.request.headers, event.getClientAddress()) });
  if (byIp) return byIp;
  return withDeadline(event, policy, async (deadline) => {
    const did = await sessionDidOf(event, deadline);
    if (policy.session === "required") {
      if (did === undefined) {
        if (event.request.method !== "GET" && event.request.method !== "HEAD") return plain(401, "auth.required");
        // SvelteKit's redirect keeps the cookie changes (a cleared stale cookie) and answers a client-side navigation
        // (__data.json) in the form its client expects (kit respond.js).
        redirect(303, "/login");
      }
      const byDid = limited(policy, { did });
      if (byDid) return byDid;
    }
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
  const deadline = AbortSignal.timeout(policy.deadlineMs ?? config.REQUEST_DEADLINE_MS);
  event.locals.deadline = deadline; // loads and actions pass it to every call they make
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
  return withGroupCsp(response, policyOf(event.route.id)?.group ?? "static");
};

/** An `app` page keeps SvelteKit's CSP, narrowed to our paths; every other response gets its group's fixed one. */
function withGroupCsp(response: Response, group: PageGroup): Response {
  const out = new Response(response.body, response); // SvelteKit's own responses may have immutable headers
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
