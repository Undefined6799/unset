// GET /sitemap.xml (ADR 0062): the public pages whose members let search engines list them, built on each request, so
// a member who turns it off, or whose account is hidden, leaves it at once. One file up to sitemaps.org's 50,000 URLs;
// a sitemap index comes when there are more members than that. Kept five minutes, as public pages are. With Search
// and AI listing off on the whole site (SEARCH_LISTING, P1.21b), it lists nothing and reads nothing.
import type { RequestHandler } from "@sveltejs/kit";
import { MAX_SITEMAP_PAGES, sitemapXml } from "@unset/domains-profile";
import { services } from "../../lib/server/compose.ts";
import { listedPaths } from "../../lib/server/listed-paths.ts";
import { config } from "../../lib/server/runtime.ts";
import { PUBLIC_PAGE_CACHE } from "../../lib/shell.ts";

export const GET: RequestHandler = async ({ locals }) => {
  const pages =
    config.SEARCH_LISTING === "on"
      ? await services().publicProfiles.listed("searchEngines", MAX_SITEMAP_PAGES, locals.deadline)
      : [];
  return new Response(sitemapXml(config.PUBLIC_ORIGIN, listedPaths(pages)), {
    headers: { "content-type": "application/xml; charset=utf-8", "cache-control": PUBLIC_PAGE_CACHE },
  });
};
