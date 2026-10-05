// Route definitions (P1.04k). `defineRoute` is the only way to register a route: it checks every option at startup,
// so a route can never run without a rate-limit policy or a request deadline.
import type { ClientIp } from "./clientIp.ts";

export type RouteGroup = "app" | "profile" | "static" | "media" | "admin" | "api";
export type RouteMethod = "GET" | "HEAD" | "POST";

/** What a handler sees: the request, the decoded path parameters, the request deadline and the request id. */
export type RouteContext = Readonly<{
  request: Request;
  /** The client's address from the trusted proxy (P1.05), or null when unknown; it prints as `[ip]`. */
  clientIp: ClientIp | null;
  params: Readonly<Record<string, string>>;
  /** Fires at the route's deadline. Pass it as the `signal` of every outbound call. */
  deadline: AbortSignal;
  reqId: string;
}>;

export type Handler = (ctx: RouteContext) => Response | Promise<Response>;

export type RouteSpec = {
  method: RouteMethod;
  path: string;
  group: RouteGroup;
  accepts?: readonly string[];
  bodyLimit?: number;
  /** A policy in the serving interface's own table (P1.06p), or `"exempt"`, allowed only for group `static`. */
  rateLimit: string;
  mutates?: boolean;
  /** The route needs a signed-in session; a policy with a per-DID entry requires it (P1.06). */
  requiresSession?: boolean;
  deadlineMs?: number;
  handler: Handler;
};

export type Route = Readonly<{
  method: RouteMethod;
  path: string;
  group: RouteGroup;
  accepts: readonly string[];
  bodyLimit: number | undefined;
  rateLimit: string;
  mutates: boolean;
  /** `true`, or absent (like the other unset options) so a route without it keeps its committed manifest entry. */
  requiresSession: true | undefined;
  deadlineMs: number | undefined;
  handler: Handler;
}>;

const METHODS: readonly RouteMethod[] = ["GET", "HEAD", "POST"];
const GROUPS: readonly RouteGroup[] = ["app", "profile", "static", "media", "admin", "api"];
const MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;
/** The deadline range: 120 s leaves room inside the edge's 130 s upstream timeout (P1.28; plan §6.1). */
const MIN_DEADLINE_MS = 1000;
const MAX_DEADLINE_MS = 120_000;
/**
 * A path template segment: a parameter (`:name`, `@:name`), a final `*`, or a lowercase literal. It is the segment
 * rule of shared/log's route check, so every template logs as itself (test request_log_uses_template).
 */
const SEGMENT = /^(?:@?:[A-Za-z][A-Za-z0-9_]*|\*|[a-z]{1,32}(?:[-_][a-z]{1,32}){0,3}|\.well-known|)$/;

function checkPath(path: string): void {
  const segments = path.split("/").slice(1);
  const valid =
    path.startsWith("/") &&
    path.length <= 200 &&
    segments.every((s, i) => SEGMENT.test(s) && (s !== "*" || i === segments.length - 1) && (s !== "" || i === 0));
  if (!valid) throw new Error(`route path is not a template: ${JSON.stringify(path)}`);
}

/** Startup checks of the identity options: method, path template, group and rate-limit policy. */
function checkIdentity(spec: RouteSpec): void {
  if (!METHODS.includes(spec.method)) throw new Error(`route method is not GET, HEAD or POST: ${spec.method}`);
  checkPath(spec.path);
  if (!GROUPS.includes(spec.group)) throw new Error(`route group is unknown: ${spec.group}`);
  if (typeof spec.rateLimit !== "string" || spec.rateLimit === "") {
    throw new Error(`${spec.path}: rateLimit is required`);
  }
  if (spec.rateLimit === "exempt" && spec.group !== "static") {
    throw new Error(`${spec.path}: only group static may be exempt from rate limits`);
  }
}

/** Startup checks of the limits: a deadline in range (never "no deadline") and a positive body limit. */
function checkLimits({ path, deadlineMs, bodyLimit }: RouteSpec): void {
  const inRange = (ms: number) => Number.isInteger(ms) && ms >= MIN_DEADLINE_MS && ms <= MAX_DEADLINE_MS;
  if (deadlineMs !== undefined && !inRange(deadlineMs)) {
    throw new Error(`${path}: deadlineMs must be an integer from ${MIN_DEADLINE_MS} to ${MAX_DEADLINE_MS}`);
  }
  if (bodyLimit !== undefined && !(Number.isInteger(bodyLimit) && bodyLimit > 0)) {
    throw new Error(`${path}: bodyLimit must be a positive integer`);
  }
}

export function defineRoute(spec: RouteSpec): Route {
  checkIdentity(spec);
  checkLimits(spec);
  const post = spec.method === "POST";
  const accepts = post ? (spec.accepts ?? ["application/x-www-form-urlencoded"]) : [];
  if (post && (accepts.length === 0 || !accepts.every((type) => MEDIA_TYPE.test(type)))) {
    throw new Error(`${spec.path}: accepts must list lowercase media types`);
  }
  return Object.freeze({
    method: spec.method,
    path: spec.path,
    group: spec.group,
    accepts: Object.freeze([...accepts]),
    bodyLimit: spec.bodyLimit,
    rateLimit: spec.rateLimit,
    mutates: spec.mutates ?? post,
    requiresSession: spec.requiresSession === true ? true : undefined,
    deadlineMs: spec.deadlineMs,
    handler: spec.handler,
  });
}

/** A template compiled to a matcher over the raw (still percent-encoded) path; parameters come back decoded. */
export type CompiledRoute = { route: Route; match: (rawPath: string) => Record<string, string> | undefined };

export function compileRoute(route: Route): CompiledRoute {
  const names: string[] = [];
  const source = route.path
    .split("/")
    .map((segment) => {
      if (segment === "*") return "(.*)";
      const param = /^(@?):(\w+)$/.exec(segment);
      if (!param) return segment.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
      names.push(param[2] as string);
      return `${param[1]}([^/]+)`;
    })
    .join("/");
  if (route.path.endsWith("*")) names.push("*");
  const pattern = new RegExp(`^${source}$`);
  return {
    route,
    match: (rawPath) => {
      const found = pattern.exec(rawPath);
      if (!found) return undefined;
      return Object.fromEntries(names.map((name, i) => [name, decodeURIComponent(found[i + 1] ?? "")]));
    },
  };
}
