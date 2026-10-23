// The signed-in member's profile page (P2.13; Alex 2026-10-23) lives at /<DID>; /did and legacy /me resolve the
// caller's own destination. This is still an owner-only app page, not the public profile: the gate runs before the
// ownership check, the handle check and the profile read. App pages are private, no-store and vary on Cookie
// (pageResponse, P1.22).
import { type Did, displayHandle, type HandleVerdict, parseDid } from "@unset/domains-identity";
import type { ProfileFields } from "@unset/domains-profile";
import { AppError } from "@unset/shared-errors";
import { defineRoute, type Route } from "@unset/shared-http";
import type { OpenedApp } from "../app-gate.ts";
import type { PageSpec } from "../web/page.ts";
import type { WebRender } from "../web/render-entry.ts";

export type MeDeps = {
  /** Session, then onboarding, then a confirmed email (P2.12). A Response is the redirect. */
  open: (request: Request, deadline: AbortSignal, next: string) => Promise<Response | OpenedApp>;
  verifyHandle: (did: Did, signal: AbortSignal) => Promise<HandleVerdict>;
  page: (page: PageSpec) => Response;
  screens: WebRender["screens"];
  /** The member's published profile from their own PDS: null when there is none, "unavailable" when it did not answer. */
  loadProfile: (did: Did, deadline: AbortSignal) => Promise<ProfileFields | null | "unavailable">;
};

export function meRoutes(deps: MeDeps): Route[] {
  return [
    ...["/did", "/me"].map((path) =>
      defineRoute({
        method: "GET",
        path,
        group: "app",
        rateLimit: "default",
        session: "none",
        handler: async ({ request, deadline }) => {
          const opened = await deps.open(request, deadline, "/did");
          if (opened instanceof Response) return opened;
          // The session store keeps only DIDs this server wrote after the callback parsed them.
          return new Response(null, {
            status: 303,
            headers: { location: `/${opened.session.did}`, "cache-control": "private, no-store", vary: "Cookie" },
          });
        },
      }),
    ),
    defineRoute({
      method: "GET",
      path: "/:did",
      group: "app",
      rateLimit: "default",
      session: "none",
      handler: async ({ request, params, deadline }) => {
        // shared/http decodes path parameters once; identity's parser accepts only supported DID syntax.
        const did = parseDid(params.did ?? "");
        if (did === null) throw new AppError("http.not_found");
        const accountPath = `/${did}`;
        const opened = await deps.open(request, deadline, accountPath);
        if (opened instanceof Response) return opened;
        if (did !== opened.session.did) throw new AppError("http.not_found");
        const [verdict, profile] = await Promise.all([
          deps.verifyHandle(did, deadline),
          deps.loadProfile(did, deadline),
        ]);
        const body = deps.screens.profile({
          did,
          handle: displayHandle(verdict),
          verified: verdict.status === "verified",
          handleUnavailable: verdict.status === "unavailable",
          privacyNotice: opened.privacyNotice,
          profile,
        });
        return deps.page({
          group: "app",
          request,
          title: displayHandle(verdict),
          body,
          // Islands on (the default): the menu drawer's theme picker hydrates so a choice leaves it open (P2.13e).
          shell: {
            noindex: true,
            navigation: {
              active: "account",
              accountPath,
              ...(verdict.status === "verified" ? { accountName: verdict.handle } : {}),
            },
          },
        });
      },
    }),
  ];
}
