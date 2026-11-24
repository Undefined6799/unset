// Every route's policy, gathered at build time from the policy.ts beside each route (policy.ts says why). A route with
// no policy.ts is refused (fail closed), and tests/integration/web/gate.test.ts checks every route folder has one.
import type { RoutePolicy } from "./policy.ts";

const files = import.meta.glob<{ policy: RoutePolicy }>("/src/routes/**/policy.ts", { eager: true });

/** "/src/routes/settings/profile/policy.ts" → "/settings/profile"; the routes root → "/". */
export function routeIdOf(file: string): string {
  const id = file.slice("/src/routes".length, -"/policy.ts".length);
  return id === "" ? "/" : id;
}

export const ROUTES: Readonly<Record<string, RoutePolicy>> = Object.freeze(
  Object.fromEntries(Object.entries(files).map(([file, mod]) => [routeIdOf(file), mod.policy])),
);

/** A path no route matches (a 404): it still passes the host check and the default limit, and its page is the error
 * page, which runs the client like every error page (ADR 0116 point 1). Its session is read when sent (P1.20k), so the
 * not-found page shows a member signed in, in their theme; their copy is private (hooks.server.ts). */
export const UNMATCHED: RoutePolicy = { group: "public", limit: "default", session: "optional" };

/** The policy of a request's route: the route's row, UNMATCHED for no route, undefined for a route with no row. */
export function policyOf(routeId: string | null): RoutePolicy | undefined {
  return routeId === null ? UNMATCHED : ROUTES[routeId];
}
