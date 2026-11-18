// What every onboarding page shares (P1.20f): the member the gate let through, and the site shell with no Sign in
// (the member is signed in; each step has its own Sign out, P2.12j) and noindex.
import type { RequestEvent } from "@sveltejs/kit";
import type { Session } from "@unset/infrastructure-session";
import { gateSession } from "../../lib/server/session.ts";
import type { ShellData } from "../../lib/shell.ts";

export const STEP_SHELL: ShellData = { kind: "site", signedIn: true, noindex: true };

/** A step page's load: noindex in the header too, as interfaces/http's page.ts sends it. Loads only: an action's
 * page is rendered by the load again, and SvelteKit refuses a header set twice. */
export function stepPage(event: RequestEvent): Session {
  event.setHeaders({ "x-robots-tag": "noindex" });
  return member(event);
}

/** The gate's session. `session: "onboarding"` sent a visitor to sign-in, so none here is a wiring bug. */
export function member(event: RequestEvent): Session {
  const session = gateSession(event);
  if (session === undefined) throw new Error("welcome: the gate let a request through with no session");
  return session;
}
