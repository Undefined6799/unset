// GET / (P1.25): the landing page's placeholder in the app shell. Group `public` (P1.25k): no cookie is read and the
// response never varies on one, the CSP has no script-src, and the page runs no island.
// P1.25v: because its bytes depend on no cookie, home (and the legal pages, which share `cachedPublicPage`) may be
// kept by a browser for five minutes (Alex, 2026-11-15). A changed page can take that long to show.
import { defineRoute, type Route } from "@unset/shared-http";
import type { PageSpec } from "../web/page.ts";
import type { WebRender } from "../web/render-entry.ts";

export type PublicPageDeps = {
  page: (page: PageSpec) => Response;
  screens: WebRender["screens"];
};

/** Five minutes. Only for a page that reads no cookie and no session: the response is the same for everyone. */
const PUBLIC_PAGE_CACHE = "public, max-age=300";

/** Marks a cookie-independent page response as cacheable for five minutes. */
export function cachedPublicPage(response: Response): Response {
  response.headers.set("cache-control", PUBLIC_PAGE_CACHE);
  return response;
}

export const homeRoutes = (deps: PublicPageDeps): Route[] => [
  defineRoute({
    method: "GET",
    path: "/",
    group: "public",
    rateLimit: "default",
    session: "none",
    handler: ({ request }) =>
      cachedPublicPage(
        deps.page({
          group: "public",
          request,
          title: "unset.sh",
          body: deps.screens.home(),
          islands: "off",
          shell: { navigation: { active: "home" } },
        }),
      ),
  }),
];
