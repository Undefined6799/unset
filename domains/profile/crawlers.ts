// What we tell crawlers (ADR 0062): robots.txt and the sitemap, built from the members' own choices. robots.txt follows
// RFC 9309 (https://www.rfc-editor.org/rfc/rfc9309.html, read 2026-11-19): a crawler obeys the group naming its
// product token, else the `*` group; within a group the longest matching path wins, and an equal Allow wins; `$`
// ends a pattern; crawlers must read at least 500 KiB. The tokens, read 2026-11-19 from each vendor's page:
// - Training, blocked for the whole site with no member switch (decision D11): GPTBot
//   (https://developers.openai.com/api/docs/bots), Google-Extended ("does not impact a site's inclusion in Google
//   Search", developers.google.com/search/docs/crawling-indexing/google-common-crawlers), Applebot-Extended ("does not
//   crawl webpages", support.apple.com/en-us/119829), CCBot (commoncrawl.org/ccbot).
// - AI search, per member (D12): OAI-SearchBot (ChatGPT search) and PerplexityBot (Perplexity search, "not used to
//   crawl content for AI foundation models", docs.perplexity.ai/guides/bots). Both take about 24 hours to apply.
// Search engines are not named: a page they may not list says `noindex` itself, which they can only read if robots.txt
// lets them fetch it.

export const TRAINING_CRAWLERS = ["GPTBot", "Google-Extended", "Applebot-Extended", "CCBot"] as const;
export const AI_SEARCH_CRAWLERS = ["OAI-SearchBot", "PerplexityBot"] as const;
/** Allow lines for AI search, at most: about 45 bytes each keeps the file well under RFC 9309's 500 KiB. */
export const MAX_AI_SEARCH_PAGES = 10_000;
/** URLs in one sitemap file (https://www.sitemaps.org/protocol.html, "no more than 50,000 URLs"). */
export const MAX_SITEMAP_PAGES = 50_000;

/** A profile path we may write into robots.txt or a sitemap: `/@` and a DID or handle, nothing a pattern could read. */
const SAFE_PATH = /^\/@[A-Za-z0-9._:-]+$/;

/**
 * robots.txt: training crawlers refused everywhere; AI search refused on every profile but those of members who
 * allowed it (each `$`-anchored, so `/@ann` never allows `/@anna`); everyone else, search engines included, may fetch
 * every page, which carries its own `noindex` until its member says otherwise.
 */
export function robotsTxt(origin: string, aiSearchPaths: readonly string[]): string {
  const allowed = aiSearchPaths.filter((path) => SAFE_PATH.test(path)).slice(0, MAX_AI_SEARCH_PAGES);
  return [
    "# unset.sh: AI training is not allowed anywhere on this site.",
    ...TRAINING_CRAWLERS.map((token) => `User-agent: ${token}`),
    "Disallow: /",
    "",
    "# AI search may show only the profiles whose members allowed it.",
    ...AI_SEARCH_CRAWLERS.map((token) => `User-agent: ${token}`),
    ...allowed.map((path) => `Allow: ${path}$`),
    "Disallow: /@",
    "",
    "User-agent: *",
    "Allow: /",
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");
}

const XML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

/** The sitemap of the profiles whose members let search engines list them (sitemaps.org protocol 0.9). */
export function sitemapXml(origin: string, paths: readonly string[]): string {
  const urls = paths
    .filter((path) => SAFE_PATH.test(path))
    .slice(0, MAX_SITEMAP_PAGES)
    .map((path) => `  <url><loc>${`${origin}${path}`.replace(/[&<>"']/g, (c) => XML_ESCAPES[c] ?? c)}</loc></url>`);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}
