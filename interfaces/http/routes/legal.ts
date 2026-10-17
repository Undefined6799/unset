// GET /legal/terms, GET /legal/privacy and GET /legal/domains (P1.25 slots, filled by P2.15). Group `public`, the
// same slot as `/`: the public CSP allows the shell's stylesheets, and the static CSP does not (shared/http/csp/
// policies.ts). Zero JS, no cookie, and kept out of search results. `?lang=` is ignored; English only until i18n.
import { defineRoute, type Route } from "@unset/shared-http";
import type { PublicPageDeps } from "./home.ts";

const DOCUMENTS = [
  { document: "terms", path: "/legal/terms", title: "Terms of service" },
  { document: "privacy", path: "/legal/privacy", title: "Privacy notice" },
  { document: "domains", path: "/legal/domains", title: "Our domains" },
] as const;

type LegalValues = Parameters<PublicPageDeps["screens"]["legal"]>[0]["values"];

export type LegalDeps = PublicPageDeps & { values: LegalValues };

export const legalRoutes = (deps: LegalDeps): Route[] =>
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
          body: deps.screens.legal({ document, values: deps.values }),
          islands: "off",
          shell: { noindex: true },
        }),
    }),
  );
