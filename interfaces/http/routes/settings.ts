// The settings pages (P2.13c): /settings answers with a 303 to its first page and keeps the query, so a checked
// `?error=` still shows; Profile and Account render inside the settings side list. Each page runs the app gate
// (session, then onboarding, then a confirmed email) before it reads anything, and is private, no-store and varies on
// Cookie like every app page (pageResponse, P1.22).
import { defineRoute, type Route } from "@unset/shared-http";
import type { OpenedApp } from "../app-gate.ts";
import type { PageSpec } from "../web/page.ts";
import { type AccountDeps, accountProps } from "./account-issuer.ts";

const PROFILE = "/settings/profile";
const ACCOUNT = "/settings/account";

/** `session` is `"handler"` for a page behind the app gate, which sends a signed-out visitor to /login (#1279). */
const appRoute = (path: string, session: "handler" | "none", handler: Route["handler"]): Route =>
  defineRoute({ method: "GET", path, group: "app", rateLimit: "default", session, handler });

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
    appRoute("/settings", "none", ({ request }) => {
      // Only the query is carried over; the path is fixed, so this cannot send the browser anywhere else.
      const { search } = new URL(request.url);
      return new Response(null, {
        status: 303,
        headers: { location: `${PROFILE}${search}`, "cache-control": "private, no-store", vary: "Cookie" },
      });
    }),
    appRoute(PROFILE, "handler", async ({ request, deadline }) => {
      const opened = await deps.open(request, deadline, PROFILE);
      if (opened instanceof Response) return opened;
      const body = deps.screens.settingsProfile({ privacyNotice: opened.privacyNotice });
      return settingsPage(request, opened, "Profile", body);
    }),
    appRoute(ACCOUNT, "handler", async ({ request, deadline }) => {
      const opened = await deps.open(request, deadline, ACCOUNT);
      if (opened instanceof Response) return opened;
      const body = deps.screens.settingsAccount((await accountOf(opened, deadline)).props);
      return settingsPage(request, opened, "Account", body);
    }),
  ];
}
