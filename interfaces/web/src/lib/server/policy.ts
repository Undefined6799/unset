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
  /** The policy a POST counts against instead of `limit`, address and member buckets both (a page whose writes cost
   * more than its reads: the cards on /[did]). */
  writeLimit?: PolicyName;
  /**
   * `required`: only a signed-in visitor gets through; anyone else is sent to /login?next=<returnTo or the page>.
   * `writes`: GET and HEAD pass as for a visitor; a POST needs a session (sent to /login without one), so no action
   * on the page runs without `locals.did`.
   * Both run the app gate for a signed-in request (app-gate.ts: onboarding, then a confirmed email), and set
   * `locals.privacyNotice`.
   * `onboarding`: a session as for `required`, but no app gate, for the pages the gate sends members to (welcome,
   * verify-email), which check their own step.
   * Each way a signed-in request also counts against the member's buckets.
   */
  session?: "required" | "writes" | "onboarding";
  /**
   * Where sign-in returns after a signed-out request the session refuses. A page whose route id has no parameter returns
   * to itself; one with a parameter must name a fixed path here, or the gate refuses it (500), as interfaces/http's
   * RETURN_TO table did. Never taken from the request.
   */
  returnTo?: `/${string}`;
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
