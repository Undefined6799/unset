// What each route needs from the request gate (hooks.server.ts). Every route folder holds a policy.ts beside its
// +page/+server file: `export const policy = definePolicy({ ... })`. route-table.ts gathers them by route id, so a
// page and its rules live together and no shared table needs editing. This file imports nothing that imports it.
import type { PolicyName } from "./limits.ts";

/** The CSP group of a response (csp.ts). `app` runs SvelteKit's client; the others run no script (`csr = false`). */
export type PageGroup = "app" | "public" | "profile" | "static";

export type RoutePolicy = Readonly<{
  group: PageGroup;
  /** The rate-limit policy (a key of limits.ts `policies`). */
  limit: PolicyName;
  /** Only a signed-in visitor gets through: GET and HEAD are sent to /login, anything else gets 401. */
  session?: "required";
  /** Largest POST body accepted, in bytes (Content-Length). Absent means the route takes no body. */
  maxBody?: number;
  /** This route's own deadline; otherwise REQUEST_DEADLINE_MS. */
  deadlineMs?: number;
  /** /health only: no host check and no rate limit, so the container probe always reaches it. */
  probe?: true;
  /** Served only when TEST_ROUTES is on, which only the test profile allows (config.ts). */
  testOnly?: true;
}>;

/** Typed helper for a route's policy.ts: `export const policy = definePolicy({ ... })`. */
export const definePolicy = (policy: RoutePolicy): RoutePolicy => policy;
