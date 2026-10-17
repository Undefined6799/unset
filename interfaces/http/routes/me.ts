// GET /me (P2.13): the signed-in home. A visitor without a session goes to sign in and comes back here. The handle is
// shown only when it resolves back to the DID (P2.02 verifyHandle, cached); an outage degrades that one line, never
// the page. App pages are private, no-store and vary on Cookie (pageResponse, P1.22).
import { type Did, displayHandle, type HandleVerdict } from "@unset/domains-identity";
import type { SessionRead } from "@unset/infrastructure-session";
import { defineRoute, type Route } from "@unset/shared-http";
import { sessionClearCookie } from "../session-cookie.ts";
import type { PageSpec } from "../web/page.ts";
import type { WebRender } from "../web/render-entry.ts";

export type MeDeps = {
  /** P2.03's read of the request's session cookie: a live session, and whether a dead cookie should be cleared. */
  readSession: (request: Request, deadline: AbortSignal) => Promise<SessionRead>;
  verifyHandle: (did: Did, signal: AbortSignal) => Promise<HandleVerdict>;
  page: (page: PageSpec) => Response;
  screens: WebRender["screens"];
  pdsHost: string;
};

export function meRoutes(deps: MeDeps): Route[] {
  return [
    defineRoute({
      method: "GET",
      path: "/me",
      group: "app",
      rateLimit: "default",
      session: "none",
      handler: async ({ request, deadline }) => {
        const { session, clearCookie } = await deps.readSession(request, deadline);
        if (session === null) {
          const headers = new Headers({
            location: `/login?${new URLSearchParams({ next: "/me" })}`,
            "cache-control": "no-store",
          });
          if (clearCookie) headers.append("set-cookie", sessionClearCookie());
          return new Response(null, { status: 303, headers });
        }
        // The session store keeps only DIDs this server wrote after the callback parsed them.
        const did = session.did as Did;
        const verdict = await deps.verifyHandle(did, deadline);
        const body = deps.screens.me({
          handle: displayHandle(verdict),
          did,
          handleUnavailable: verdict.status === "unavailable",
          pdsHost: deps.pdsHost,
        });
        return deps.page({ group: "app", request, title: displayHandle(verdict), body, shell: {} });
      },
    }),
  ];
}
