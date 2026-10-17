// GET /me (P2.13): the signed-in home. The gate is session, then onboarding, then a confirmed email (P2.12); a
// visitor without a session goes to sign in and comes back here. The handle is shown only when it resolves back to
// the DID (P2.02 verifyHandle, cached); an outage degrades that one line, never the page. App pages are private,
// no-store and vary on Cookie (pageResponse, P1.22).
import { type Did, displayHandle, type HandleVerdict } from "@unset/domains-identity";
import { defineRoute, type Route } from "@unset/shared-http";
import type { OpenedApp } from "../app-gate.ts";
import type { PageSpec } from "../web/page.ts";
import type { WebRender } from "../web/render-entry.ts";

export type MeDeps = {
  /** Session, then onboarding, then a confirmed email (P2.12). A Response is the redirect. */
  open: (request: Request, deadline: AbortSignal) => Promise<Response | OpenedApp>;
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
        const opened = await deps.open(request, deadline);
        if (opened instanceof Response) return opened;
        // The session store keeps only DIDs this server wrote after the callback parsed them.
        const did = opened.session.did;
        const verdict = await deps.verifyHandle(did, deadline);
        const body = deps.screens.me({
          handle: displayHandle(verdict),
          did,
          handleUnavailable: verdict.status === "unavailable",
          privacyNotice: opened.privacyNotice,
          pdsHost: deps.pdsHost,
        });
        return deps.page({ group: "app", request, title: displayHandle(verdict), body, shell: {} });
      },
    }),
  ];
}
