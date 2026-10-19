// The signed-in account (P2.13) lives at /<DID>; /did and legacy /me resolve the caller's own destination.
// This is still an owner-only app page, not a public profile: the gate runs before the ownership check and
// handle verification. App pages are private, no-store and vary on Cookie (pageResponse, P1.22).
import { type Did, displayHandle, type HandleVerdict, parseDid } from "@unset/domains-identity";
import { AppError } from "@unset/shared-errors";
import { defineRoute, type Route } from "@unset/shared-http";
import type { Logger } from "@unset/shared-log";
import type { OpenedApp } from "../app-gate.ts";
import type { PageSpec } from "../web/page.ts";
import type { WebRender } from "../web/render-entry.ts";
import { issuerOrigin } from "./sign-in-state.ts";

export type MeDeps = {
  /** Session, then onboarding, then a confirmed email (P2.12). A Response is the redirect. */
  open: (request: Request, deadline: AbortSignal, next: string) => Promise<Response | OpenedApp>;
  verifyHandle: (did: Did, signal: AbortSignal) => Promise<HandleVerdict>;
  page: (page: PageSpec) => Response;
  screens: WebRender["screens"];
  /** The issuer OAuth recorded at sign-in (the stored token set's `iss`), or null. Never a DID-document field. */
  issuerOf: (did: Did) => Promise<string | null>;
  /** Our PDS's issuer origin, to tell our sign-in server from another. */
  pdsIssuer: string;
  log: Logger;
};

export function meRoutes(deps: MeDeps): Route[] {
  /** P2.08b: the account link follows the recorded issuer. An unreadable record drops the link, never the page. */
  const recordedIssuer = (did: Did): Promise<string | null> =>
    deps.issuerOf(did).then(
      (issuer) => (issuer === null ? null : issuerOrigin(issuer)),
      (cause: unknown) => {
        deps.log.warn("auth.account_issuer_unknown", { kind: cause instanceof Error ? cause.name : "Error" });
        return null;
      },
    );

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
        const [verdict, issuer] = await Promise.all([deps.verifyHandle(did, deadline), recordedIssuer(did)]);
        const body = deps.screens.me({
          handle: displayHandle(verdict),
          did,
          handleUnavailable: verdict.status === "unavailable",
          privacyNotice: opened.privacyNotice,
          issuer,
          ours: issuer === deps.pdsIssuer,
        });
        return deps.page({
          group: "app",
          request,
          title: displayHandle(verdict),
          body,
          islands: "off",
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
