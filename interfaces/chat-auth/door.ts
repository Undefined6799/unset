// The unset.cc door's request handler (build step 6; ADR 0081 decision 4): a fixed table of routes, and in front of
// every one the same checks in order: the Host, the CSRF gate on every method but GET and HEAD (plan §2 rule 14), the
// route and its method, then the client's rate-limit bucket, then the route under the request's deadline (RE-1).
// Every answer carries the kit's security headers and no-store, but the chat page's content-hashed files, which are
// cached for good (ADR 0088 decision 1); each is one log line of route template, method,
// status and a fixed reason word, never a path, query, cookie, ticket, DID or address (SE-7).
import { randomBytes } from "node:crypto";
import { parseDid } from "@unset/domains-identity";
import {
  type ClientIp,
  type CsrfReason,
  createCsrfGate,
  hostAllowed,
  type RateLimiter,
  SECURITY_HEADERS,
  safeReturnPath,
} from "@unset/shared-http";
import { HOP_MAX_AGE_S, RETURN_COOKIE, STATE_COOKIE, setCookie } from "./cookies.ts";
import { ASSETS, type ChatPage, pageCsp } from "./page.ts";

/** The hop's landing path, where web sends the ticket (interfaces/web chat-sign-in.ts DOOR_RETURN_PATH). */
const RETURN_PATH = "/sign-in/return";
/** A profile's Message link, `/dm/<did>` (ADR 0082 decision 6): the page, which asks for the chat ID once signed in. */
const DM_PREFIX = "/dm/";
const DM_ROUTE = "/dm/*";

export type DoorLog = { route: string; method: string; status: number; reason?: string };

/** A POST route's own work, after the door's checks; `deadline` is the request's. */
export type PostRoute = {
  readonly limit: string;
  readonly handle: (request: Request, deadline: AbortSignal) => Promise<DoorAnswer>;
};
/** What a route answers: the response, and the reason word its log line carries, if any. */
export type DoorAnswer = { readonly response: Response; readonly reason?: string };

export type DoorDeps = {
  /** PUBLIC_ORIGIN: the door's own origin, which the CSRF gate matches exactly. */
  readonly origin: string;
  /** WEB_ORIGIN: where the hop signs its ticket (interfaces/web GET /chat/sign-in). */
  readonly webOrigin: string;
  readonly allowedHosts: readonly string[];
  readonly limiter: RateLimiter;
  readonly clientIp: (headers: Headers, peer: string | undefined) => ClientIp | null;
  readonly random?: (bytes: number) => Buffer;
  readonly log: (line: DoorLog) => void;
  readonly deadlineMs?: number;
  /** The chat page (ADR 0088): its document at "/" and RETURN_PATH, its built files under ASSETS. */
  readonly page: ChatPage;
  readonly posts: Readonly<Record<string, PostRoute>>;
};

const BASE: Readonly<Record<string, string>> = {
  ...SECURITY_HEADERS,
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "cache-control": "no-store",
};
const NO_REFERRER = { "referrer-policy": "no-referrer" };

export const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...BASE, "content-type": "application/json", ...headers },
  });
/** A refusal: its catalog code in the body, and as the log's reason the code's last part (a word: `bad_return`). */
const refuse = (status: number, error: string, reason = error.slice(error.indexOf(".") + 1)): DoorAnswer => ({
  response: json(status, { error }),
  reason,
});

/** Not one of the hop's own pages: a return there would loop. */
const NOT_A_TARGET = /^\/sign-in(?:[/?#.;]|$)/;

/** GET /sign-in?return=<path>: the one-time value and the return path in their cookies, then the hop to web. */
function startSignIn(url: URL, deps: DoorDeps): DoorAnswer {
  const targets = url.searchParams.getAll("return");
  const target = targets.length === 0 ? "/" : targets.length === 1 ? safeReturnPath(targets[0]) : null;
  if (target === null || NOT_A_TARGET.test(target)) return refuse(400, "chat.bad_return");
  const state = (deps.random ?? randomBytes)(32).toString("base64url");
  const headers = new Headers({ ...BASE, ...NO_REFERRER, location: `${deps.webOrigin}/chat/sign-in?state=${state}` });
  headers.append("set-cookie", setCookie(STATE_COOKIE, state, HOP_MAX_AGE_S, "Lax"));
  headers.append("set-cookie", setCookie(RETURN_COOKIE, encodeURIComponent(target), HOP_MAX_AGE_S, "Lax"));
  return { response: new Response(null, { status: 303, headers }) };
}

const IMMUTABLE = { "cache-control": "public, max-age=31536000, immutable" };

/** The page's document, under its own CSP. */
const pageDocument: GetRoute = (_url, deps) => ({
  response: new Response(deps.page.html, {
    status: 200,
    headers: {
      ...BASE,
      ...NO_REFERRER,
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": pageCsp(deps.origin),
    },
  }),
});

/** One of the page's built files, by its exact path; anything else under ASSETS is 404. */
const pageFile: GetRoute = (url, deps) => {
  const file = deps.page.files.get(url.pathname);
  if (file === undefined) return refuse(404, "not_found");
  return {
    response: new Response(file.body, { status: 200, headers: { ...BASE, "content-type": file.type, ...IMMUTABLE } }),
  };
};

/** The page at a Message link, for a path that names a DID; any other path under it is 404. */
const dmPage: GetRoute = (url, deps) =>
  parseDid(url.pathname.slice(DM_PREFIX.length)) === null ? refuse(404, "not_found") : pageDocument(url, deps);

type GetRoute = (url: URL, deps: DoorDeps) => DoorAnswer;
const GETS: Readonly<Record<string, { limit: string; handle: GetRoute }>> = {
  "/health": { limit: "default", handle: () => ({ response: json(200, { ok: true }) }) },
  "/sign-in": { limit: "sign-in", handle: startSignIn },
  "/": { limit: "default", handle: pageDocument },
  [RETURN_PATH]: { limit: "default", handle: pageDocument },
  [ASSETS]: { limit: "default", handle: pageFile },
  [DM_ROUTE]: { limit: "default", handle: dmPage },
};

/** The route a path falls under: its own, the built files' or the Message link's, or "/*" for everything else. */
function routeOf(path: string, posts: DoorDeps["posts"]): string {
  if (path in GETS || path in posts) return path;
  if (path.startsWith(DM_PREFIX)) return DM_ROUTE;
  return path.startsWith(ASSETS) && path.length > ASSETS.length ? ASSETS : "/*";
}

export function createDoor(deps: DoorDeps) {
  const csrf = createCsrfGate(deps.origin);
  const deadlineMs = deps.deadlineMs ?? 10_000;

  /** The checks in order; the first that fails answers. */
  async function answer(request: Request, peer: string | undefined, route: string): Promise<DoorAnswer> {
    const host = (request.headers.get("host") ?? "").replace(/:\d+$/, "").toLowerCase();
    if (!hostAllowed(host, deps.allowedHosts)) return refuse(421, "http.misdirected", "host");
    const gate = csrf(request);
    if (!gate.ok) return refuse(403, "csrf.denied", gate.reason satisfies CsrfReason);
    const get = GETS[route];
    const post = deps.posts[route];
    const isRead = request.method === "GET" || request.method === "HEAD";
    const limit = isRead ? get?.limit : request.method === "POST" ? post?.limit : undefined;
    if (limit === undefined) return get || post ? refuse(405, "http.method_not_allowed") : refuse(404, "not_found");
    if (!deps.limiter.consume(limit, { ip: deps.clientIp(request.headers, peer) }).ok) {
      return refuse(429, "http.rate_limited", "limited");
    }
    if (isRead && get) return get.handle(new URL(request.url), deps);
    return (post as PostRoute).handle(request, AbortSignal.timeout(deadlineMs));
  }

  return async (request: Request, peer: string | undefined): Promise<Response> => {
    const path = new URL(request.url).pathname;
    const route = routeOf(path, deps.posts);
    let result: DoorAnswer;
    try {
      result = await answer(request, peer, route);
    } catch (error) {
      // An infrastructure fault: a fixed answer, and only the error's class name reaches the log.
      result = refuse(503, "chat.unavailable", error instanceof Error ? "fault" : "unknown");
    }
    const line: DoorLog = { route, method: request.method, status: result.response.status };
    deps.log(result.reason === undefined ? line : { ...line, reason: result.reason });
    return result.response;
  };
}
