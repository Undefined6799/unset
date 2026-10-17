// GET /legal/terms and GET /legal/privacy (P1.25): the slots the legal texts fill (P2.15), each a placeholder saying
// the document is in preparation until then. Public and zero-JS like `/`, and kept out of search results meanwhile.
import { defineRoute, type Route } from "@unset/shared-http";
import type { PublicPageDeps } from "./home.ts";

const DOCUMENTS = [
  { document: "terms", path: "/legal/terms", title: "Terms of service" },
  { document: "privacy", path: "/legal/privacy", title: "Privacy notice" },
] as const;

export const legalRoutes = (deps: PublicPageDeps): Route[] =>
  DOCUMENTS.map(({ document, path, title }) =>
    defineRoute({
      method: "GET",
      path,
      group: "public",
      rateLimit: "default",
      session: "none",
      handler: ({ request }) =>
        deps.page({
          group: "public",
          request,
          title,
          body: deps.screens.legal({ document }),
          islands: "off",
          shell: { noindex: true },
        }),
    }),
  );
