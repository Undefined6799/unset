// GET /robots.txt (ADR 0062): built on each request from the members' Search and AI choices, so a member who turns AI
// search off, or whose account is hidden, leaves the file at once (idx.public_profile shows visible accounts only).
// A read that fails answers 503, which RFC 9309 section 2.3.1.4 says crawlers read as "disallow everything": the file
// fails closed. Kept five minutes, as public pages are; the vendors re-read it about daily anyway.
import type { RequestHandler } from "@sveltejs/kit";
import { MAX_AI_SEARCH_PAGES, robotsTxt } from "@unset/domains-profile";
import { services } from "../../lib/server/compose.ts";
import { listedPaths } from "../../lib/server/listed-paths.ts";
import { config } from "../../lib/server/runtime.ts";
import { PUBLIC_PAGE_CACHE } from "../../lib/shell.ts";

export const GET: RequestHandler = async ({ locals }) => {
  const pages = await services().publicProfiles.listed("aiSearch", MAX_AI_SEARCH_PAGES, locals.deadline);
  return new Response(robotsTxt(config.PUBLIC_ORIGIN, listedPaths(pages)), {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": PUBLIC_PAGE_CACHE },
  });
};
