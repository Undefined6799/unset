// What each route needs from the request gate (hooks.server.ts). Every route folder holds a policy.ts beside its
// +page/+server file: `export const policy = definePolicy({ ... })`. route-table.ts gathers them by route id, so a
// page and its rules live together and no shared table needs editing. This file imports nothing that imports it.
import type { PolicyName } from "./limits.ts";

/**
 * The CSP group of a response (csp.ts). `app` pages run SvelteKit's client under its script policy; a `public` page
 * runs no script (`csr = false`) unless its policy says `client`; `static` is never a page.
 */
export type PageGroup = "app" | "public" | "static";

export type RoutePolicy = Readonly<{
  group: PageGroup;
  /**
   * A `public` page that runs SvelteKit's client (ADR 0114 points 2 and 3): its +page.ts says `csr = true`, and the
   * hook sends the page the app group's script policy in place of the public group's fixed one. Nothing else about it
   * changes: its cache rules, the system theme on a visitor's copy and the bell as a link stay the public group's,
   * and its refusals and its data address keep the fixed header. A fact of the route, never read from the request;
   * gate.test.ts names every route that has it and fails when `csr` and this disagree.
   */
  client?: true;
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
   * Each of those three ways a signed-in request also counts against the member's buckets.
   * `optional`: a page anyone may read that shows a member as signed in (home, the legal pages). The session is read
   * when a cookie is sent, never required and never gated, so a member mid-onboarding can still read the terms. A page
   * rendered for a member is private and never stored (hooks.server.ts), and these pages always vary on Cookie, so a
   * stored visitor copy is never reused for a signed-in browser.
   */
  session?: "required" | "writes" | "onboarding" | "optional";
  /**
   * Where sign-in returns after a signed-out request the session refuses. A page whose route id has no parameter returns
   * to itself; one with a parameter must name a fixed path here, or the gate refuses it (500), as interfaces/http's
   * RETURN_TO table did. Never taken from the request.
   */
  returnTo?: `/${string}`;
  /** Largest POST body accepted, in bytes (Content-Length). Absent means the route takes no body. */
  maxBody?: number;
  /** This route's own deadline; otherwise REQUEST_DEADLINE_MS. With `bodyWindowMs`, the time it has once its body is read. */
  deadlineMs?: number;
  /**
   * A route whose body may take long to arrive (a picture on a slow link): the gate's deadline is this plus
   * `deadlineMs`, and the route starts `deadlineMs` again once it has read its body, so a slow upload does not eat the
   * time its work needs. At most the edge's read window, which bounds the body (limits.json EDGE_READ_BODY_S).
   */
  bodyWindowMs?: number;
  /** /health only: no host check and no rate limit, so the container probe always reaches it. */
  probe?: true;
  /** Served only when TEST_ROUTES is on, which only the test profile allows (config.ts). */
  testOnly?: true;
}>;

/** Typed helper for a route's policy.ts: `export const policy = definePolicy({ ... })`. */
export const definePolicy = (policy: RoutePolicy): RoutePolicy => policy;
