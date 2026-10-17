// GET / (P1.25): the landing page's placeholder in the app shell. Group `public` (P1.25k): no cookie is read and the
// response never varies on one, the CSP has no script-src, and the page runs no island.
import { defineRoute, type Route } from "@unset/shared-http";
import type { PageSpec } from "../web/page.ts";
import type { WebRender } from "../web/render-entry.ts";

export type PublicPageDeps = {
  page: (page: PageSpec) => Response;
  screens: WebRender["screens"];
};

export const homeRoutes = (deps: PublicPageDeps): Route[] => [
  defineRoute({
    method: "GET",
    path: "/",
    group: "public",
    rateLimit: "default",
    session: "none",
    handler: ({ request }) =>
      deps.page({ group: "public", request, title: "unset.sh", body: deps.screens.home(), islands: "off", shell: {} }),
  }),
];
