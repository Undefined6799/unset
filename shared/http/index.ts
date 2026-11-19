// The server kit (plan §5.1). P1.04k: the config fragment (its Hono server, routes and error pages went with
// P1.20k). P1.09: the return-path validator, the only way a redirect target is chosen from input. P1.06: the
// rate-limit primitive.

export type { ClientIp } from "./clientIp.ts";
export { type HttpKitConfig, hostAllowed, httpKitConfig } from "./config.ts";
export { type HeaderSet, SECURITY_HEADERS } from "./headers.ts";
export { createHealth, type HealthState, type Readiness } from "./health.ts";
export { definePolicies, type Policy, type PolicyEntry, type PolicyName, type PolicyTable } from "./limits/policy.ts";
export { createRateLimiter, type RateLimiter } from "./limits/rateLimit.ts";
export { DENIED_TARGETS, type SafePath, safeReturnPath } from "./returnPath.ts";
export { type CloseHook, drain, exitOnSignals } from "./shutdown.ts";
export { createClientIpResolver, type ProxySettings } from "./trustedProxy.ts";
