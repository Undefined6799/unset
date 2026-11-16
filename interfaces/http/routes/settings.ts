// The settings pages (P2.13c): /settings answers with a 303 to its first page and keeps the query, so a checked
// `?error=` still shows; Profile and Account render inside the settings side list. Each page sits behind the server's
// gate (ADR 0045: session, then onboarding, then a confirmed email), which runs before its handler, and is private,
// no-store and varies on Cookie like every app page (pageResponse, P1.22).
import { defineRoute, type Route, type SessionHandler } from "@unset/shared-http";
import type { OpenedApp } from "../app-gate.ts";
import type { PageSpec } from "../web/page.ts";
import { type AccountDeps, accountProps } from "./account-issuer.ts";

const PROFILE = "/settings/profile";
const ACCOUNT = "/settings/account";

/** A settings page: the gate sends a signed-out visitor to /login before the handler runs (#1279). */
const settingsRoute = (path: string, handler: SessionHandler<OpenedApp>): Route =>
  defineRoute<OpenedApp>({ method: "GET", path, group: "app", rateLimit: "default", session: "required", handler });

export function settingsRoutes(deps: AccountDeps): Route[] {
  const accountOf = accountProps(deps);
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
    defineRoute({
      method: "GET",
      path: "/settings",
      group: "app",
      rateLimit: "default",
      session: "none",
      handler: ({ request }) => {
        // Only the query is carried over; the path is fixed, so this cannot send the browser anywhere else.
        const { search } = new URL(request.url);
        return new Response(null, {
          status: 303,
          headers: { location: `${PROFILE}${search}`, "cache-control": "private, no-store", vary: "Cookie" },
        });
      },
    }),
    settingsRoute(PROFILE, ({ request, session: opened }) => {
      const body = deps.screens.settingsProfile({ privacyNotice: opened.privacyNotice });
      return settingsPage(request, opened, "Profile", body);
    }),
    settingsRoute(ACCOUNT, async ({ request, deadline, session: opened }) => {
      const body = deps.screens.settingsAccount((await accountOf(opened, deadline)).props);
      return settingsPage(request, opened, "Account", body);
    }),
  ];
}
