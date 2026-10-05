// The server kit (plan §5.1). P1.04k: the server, routes, config fragment and errors. P1.09: the return-path
// validator, the only way a redirect target is chosen from input. P1.06: body limits and the rate-limit primitive.
export { type HttpKitConfig, hostAllowed, httpKitConfig } from "./config.ts";
export { errorResponse, groupForPath } from "./errors.ts";
export type { Readiness } from "./health.ts";
export { definePolicies, type Policy, type PolicyEntry, type PolicyName, type PolicyTable } from "./limits/policy.ts";
export { createRateLimiter, type RateLimiter } from "./limits/rateLimit.ts";
export { DENIED_TARGETS, type SafePath, safeReturnPath } from "./returnPath.ts";
export {
  defineRoute,
  type Handler,
  type Route,
  type RouteContext,
  type RouteGroup,
  type RouteMethod,
  type RouteSpec,
} from "./routes.ts";
export { createServer, type RouteInfo, type ServerOptions, type SessionReader } from "./server.ts";
export type { CloseHook } from "./shutdown.ts";
