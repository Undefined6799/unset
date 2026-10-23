// The settings pages (P2.13c): /settings answers with a 303 to its first page and keeps the query, so a checked
// `?error=` still shows; Profile and Account render inside the settings side list. Each page runs the app gate
// (session, then onboarding, then a confirmed email) before it reads anything, and is private, no-store and varies on
// Cookie like every app page (pageResponse, P1.22).
import { type Did, displayHandle, type HandleVerdict } from "@unset/domains-identity";
import type { ProfileFields } from "@unset/domains-profile";
import { defineRoute, type Route } from "@unset/shared-http";
import type { Logger } from "@unset/shared-log";
import type { OpenedApp } from "../app-gate.ts";
import type { PageSpec } from "../web/page.ts";
import type { WebRender } from "../web/render-entry.ts";
import { recordedIssuer } from "./account-issuer.ts";

export type SettingsDeps = {
  /** Session, then onboarding, then a confirmed email (P2.12). A Response is the redirect. */
  open: (request: Request, deadline: AbortSignal, next: string) => Promise<Response | OpenedApp>;
  verifyHandle: (did: Did, signal: AbortSignal) => Promise<HandleVerdict>;
  page: (page: PageSpec) => Response;
  screens: WebRender["screens"];
  /** The issuer OAuth recorded at sign-in (the stored token set's `iss`), or null. Never a DID-document field. */
  issuerOf: (did: Did) => Promise<string | null>;
  /** Our PDS's issuer origin, to tell our sign-in server from another. */
  pdsIssuer: string;
  /** The member's published profile; null when there is none yet, "unavailable" when the PDS did not answer. */
  loadProfile: (did: Did, deadline: AbortSignal) => Promise<ProfileFields | null | "unavailable">;
  log: Logger;
};

const PROFILE = "/settings/profile";
const ACCOUNT = "/settings/account";

const appRoute = (path: string, handler: Route["handler"]): Route =>
  defineRoute({ method: "GET", path, group: "app", rateLimit: "default", session: "none", handler });

export function settingsRoutes(deps: SettingsDeps): Route[] {
  const issuerFor = recordedIssuer(deps.issuerOf, deps.log);
  const settingsPage = (request: Request, opened: OpenedApp, title: string, body: PageSpec["body"]) =>
    deps.page({
      group: "app",
      request,
      title,
      body,
      // Islands on (the default): the menu drawer's theme picker hydrates so a choice leaves it open (P2.13e).
      shell: { noindex: true, navigation: { active: "settings", accountPath: `/${opened.session.did}` } },
    });

  return [
    appRoute("/settings", ({ request }) => {
      // Only the query is carried over; the path is fixed, so this cannot send the browser anywhere else.
      const { search } = new URL(request.url);
      return new Response(null, {
        status: 303,
        headers: { location: `${PROFILE}${search}`, "cache-control": "private, no-store", vary: "Cookie" },
      });
    }),
    appRoute(PROFILE, async ({ request, deadline }) => {
      const opened = await deps.open(request, deadline, PROFILE);
      if (opened instanceof Response) return opened;
      // The side column of the profile page is edited here (Alex 2026-10-23 04:29Z); the form posts to POST /profile.
      const profile = await deps.loadProfile(opened.session.did, deadline);
      const body = deps.screens.settingsProfile({ privacyNotice: opened.privacyNotice, profile });
      return settingsPage(request, opened, "Profile", body);
    }),
    appRoute(ACCOUNT, async ({ request, deadline }) => {
      const opened = await deps.open(request, deadline, ACCOUNT);
      if (opened instanceof Response) return opened;
      const did = opened.session.did;
      const [verdict, issuer] = await Promise.all([deps.verifyHandle(did, deadline), issuerFor(did)]);
      const body = deps.screens.settingsAccount({
        handle: displayHandle(verdict),
        did,
        handleUnavailable: verdict.status === "unavailable",
        privacyNotice: opened.privacyNotice,
        issuer,
        ours: issuer === deps.pdsIssuer,
      });
      return settingsPage(request, opened, "Account", body);
    }),
  ];
}
