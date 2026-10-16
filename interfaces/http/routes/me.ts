// GET /me (P2.13): the signed-in home. A visitor without a session goes to sign in and comes back here. The handle is
// shown only when it resolves back to the DID (P2.02 verifyHandle, cached); an outage degrades that one line, never
// the page. App pages are private, no-store and vary on Cookie (pageResponse, P1.22).
import { type Did, displayHandle, type HandleVerdict } from "@unset/domains-identity";
import type { Session } from "@unset/infrastructure-session";
import { defineRoute, type Route, type RouteGroup } from "@unset/shared-http";
import type { ReactNode } from "react";
import type { WebRender } from "../web/render-entry.ts";

export type MeDeps = {
  readSession: (request: Request, deadline: AbortSignal) => Promise<Session | null>;
  verifyHandle: (did: Did, signal: AbortSignal) => Promise<HandleVerdict>;
  page: (page: { group: RouteGroup; request: Request; title: string; body: ReactNode }) => Response;
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
        const session = await deps.readSession(request, deadline);
        if (session === null) {
          return new Response(null, {
            status: 303,
            headers: { location: `/login?${new URLSearchParams({ next: "/me" })}`, "cache-control": "no-store" },
          });
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
        return deps.page({ group: "app", request, title: displayHandle(verdict), body });
      },
    }),
  ];
}
