// The server kit (plan §5.1). P1.04k: the server, routes, config fragment and errors. P1.09: the return-path
// validator, the only way a redirect target is chosen from input.
export { type HttpKitConfig, hostAllowed, httpKitConfig } from "./config.ts";
export { errorResponse, groupForPath } from "./errors.ts";
export type { Readiness } from "./health.ts";
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
export { createServer, type PolicyTable, type RouteInfo, type ServerOptions } from "./server.ts";
export type { CloseHook } from "./shutdown.ts";
