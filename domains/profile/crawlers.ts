// What we tell crawlers (ADR 0062): robots.txt and the sitemap, built from the members' own choices. robots.txt follows
// RFC 9309 (https://www.rfc-editor.org/rfc/rfc9309.html, read 2026-11-19): a crawler obeys the group naming its
// product token, else the `*` group; within a group the longest matching path wins, and an equal Allow wins; `$`
// ends a pattern; crawlers must read at least 500 KiB; tokens match case-insensitively. A line is a request that binds
// only crawlers that honour it and that we name. Tokens read 2026-11-19 from each vendor's page (quoted in ADR 0062):
// - Training, blocked site-wide (D11), each with its vendor's search token where one exists: GPTBot and OAI-SearchBot
//   (developers.openai.com/api/docs/bots); ClaudeBot and Claude-SearchBot (support.claude.com/en/articles/8896518);
//   Google-Extended (developers.google.com/search/docs/crawling-indexing/google-common-crawlers); Applebot-Extended
//   (support.apple.com/en-us/119829); meta-externalagent and meta-webindexer
//   (developers.facebook.com/docs/sharing/webmasters/web-crawlers); Amazonbot and Amzn-SearchBot
//   (developer.amazon.com/amazonbot); CCBot (commoncrawl.org/ccbot); AI2Bot (allenai.org/crawler, silent on
//   robots.txt). Cohere and ByteDance publish no page naming a token, so they are not guessed.
// - AI search, per member (D12): the search tokens above and PerplexityBot (docs.perplexity.ai/guides/bots). Unnamed,
//   they would follow the `*` group's `Allow: /`; named, each reads only the pages members allowed.
// Fetchers a person triggers and search engines are not named (ADR 0062): a search engine reads each page's `noindex`.

export const TRAINING_CRAWLERS = [
  "GPTBot",
  "ClaudeBot",
  "Google-Extended",
  "Applebot-Extended",
  "meta-externalagent",
  "Amazonbot",
  "CCBot",
  "AI2Bot",
] as const;
export const AI_SEARCH_CRAWLERS = [
  "OAI-SearchBot",
  "PerplexityBot",
  "Claude-SearchBot",
  "meta-webindexer",
  "Amzn-SearchBot",
] as const;
/** AI search Allow lines the query reads, at most; the file's byte budget, under RFC 9309's 500 KiB, may keep fewer. */
export const MAX_AI_SEARCH_PAGES = 10_000;
const ROBOTS_BYTE_BUDGET = 450 * 1024;
/** URLs in one sitemap file (https://www.sitemaps.org/protocol.html, "no more than 50,000 URLs"). */
export const MAX_SITEMAP_PAGES = 50_000;

/** A profile path we may write into robots.txt or a sitemap: `/@` and a DID or handle, nothing a pattern could read. */
const SAFE_PATH = /^\/@[A-Za-z0-9._:-]+$/;

/**
 * robots.txt: training refused everywhere; everyone else may fetch every page (each says `noindex` until its member
 * says otherwise); AI search refused on every profile but those allowed (`$`-anchored, so `/@ann` never allows
 * `/@anna`). Member lines come last, after `Disallow: /@`, within a byte budget: a crawler that stops at 500 KiB (RFC
 * 9309 section 2.5) misses some members, never the denial.
 */
export function robotsTxt(origin: string, aiSearchPaths: readonly string[]): string {
  const lines = [
    "# unset.sh: AI training is not allowed anywhere on this site. We ask each training crawler below by name.",
    ...TRAINING_CRAWLERS.map((token) => `User-agent: ${token}`),
    "Disallow: /",
    "",
    "User-agent: *",
    "Allow: /",
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
    "# AI search may show only the profiles whose members allowed it.",
    ...AI_SEARCH_CRAWLERS.map((token) => `User-agent: ${token}`),
    "Disallow: /@",
  ];
  let bytes = Buffer.byteLength(lines.join("\n"));
  for (const path of aiSearchPaths.filter((one) => SAFE_PATH.test(one)).slice(0, MAX_AI_SEARCH_PAGES)) {
    const line = `Allow: ${path}$`;
    bytes += line.length + 1;
    if (bytes > ROBOTS_BYTE_BUDGET) break;
    lines.push(line);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * robots.txt when Search and AI listing is off on the whole site (P1.21b): one `*` group that every crawler reads when
 * no group names it, refusing every path, and no sitemap. Members' choices are not read.
 */
export const CLOSED_ROBOTS_TXT = [
  "# Search and AI listing is switched off on this site: no crawler may fetch any page.",
  "User-agent: *",
  "Disallow: /",
  "",
].join("\n");

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
