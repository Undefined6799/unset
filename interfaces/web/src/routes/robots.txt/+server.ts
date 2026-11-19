// GET /robots.txt (ADR 0062): built per request from the members' choices joined with idx.public_profile (visible
// accounts only), so turning AI search off or a hidden account leaves the file at once. A failed read answers 503,
// which RFC 9309 section 2.3.1.4 reads as "disallow everything". Kept five minutes, as public pages are. With Search
// and AI listing off on the whole site (SEARCH_LISTING, P1.21b), the file refuses every crawler and reads nothing.
import type { RequestHandler } from "@sveltejs/kit";
import { CLOSED_ROBOTS_TXT, MAX_AI_SEARCH_PAGES, robotsTxt } from "@unset/domains-profile";
import { services } from "../../lib/server/compose.ts";
import { listedPaths } from "../../lib/server/listed-paths.ts";
import { config } from "../../lib/server/runtime.ts";
import { PUBLIC_PAGE_CACHE } from "../../lib/shell.ts";

const HEADERS = { "content-type": "text/plain; charset=utf-8", "cache-control": PUBLIC_PAGE_CACHE };

export const GET: RequestHandler = async ({ locals }) => {
  if (config.SEARCH_LISTING !== "on") return new Response(CLOSED_ROBOTS_TXT, { headers: HEADERS });
  const pages = await services().publicProfiles.listed("aiSearch", MAX_AI_SEARCH_PAGES, locals.deadline);
  return new Response(robotsTxt(config.PUBLIC_ORIGIN, listedPaths(pages)), { headers: HEADERS });
};
