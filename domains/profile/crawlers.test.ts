import { describe, expect, test } from "vitest";
import {
  AI_SEARCH_CRAWLERS,
  CLOSED_ROBOTS_TXT,
  MAX_AI_SEARCH_PAGES,
  robotsTxt,
  sitemapXml,
  TRAINING_CRAWLERS,
} from "./crawlers.ts";

const ORIGIN = "https://unset.sh";

describe("robotsTxt", () => {
  test("training_blocked_everywhere_ai_search_only_where_allowed", () => {
    const text = robotsTxt(ORIGIN, ["/@ann.unset.im", "/@did:plc:aaaaaaaaaaaaaaaaaaaaaaaa"]);
    expect(text).toContain(
      [
        "User-agent: GPTBot",
        "User-agent: ClaudeBot",
        "User-agent: Google-Extended",
        "User-agent: Applebot-Extended",
        "User-agent: meta-externalagent",
        "User-agent: Amazonbot",
        "User-agent: CCBot",
        "User-agent: AI2Bot",
        "Disallow: /\n",
      ].join("\n"),
    );
    expect(text).toContain(
      [
        "User-agent: OAI-SearchBot",
        "User-agent: PerplexityBot",
        "User-agent: Claude-SearchBot",
        "User-agent: meta-webindexer",
        "User-agent: Amzn-SearchBot",
        "Disallow: /@",
        "Allow: /@ann.unset.im$",
        "Allow: /@did:plc:aaaaaaaaaaaaaaaaaaaaaaaa$\n",
      ].join("\n"),
    );
    expect(text).toContain("User-agent: *\nAllow: /\n");
    expect(text).toContain("Sitemap: https://unset.sh/sitemap.xml");
  });

  test("no_member_means_no_allow_line", () => {
    expect(robotsTxt(ORIGIN, [])).not.toContain("Allow: /@");
  });

  test("a_path_that_could_change_a_rule_is_left_out", () => {
    const text = robotsTxt(ORIGIN, ["/@a*", "/@a\nUser-agent: *", "/@a$", "/x", "/@ok.unset.im"]);
    expect(text.match(/^Allow: \/@/gm)).toEqual(["Allow: /@"]);
    expect(text).toContain("Allow: /@ok.unset.im$");
  });

  test("long_handles_never_push_the_denial_past_500_kib", () => {
    // RFC 9309 section 2.5: a crawler may stop reading at 500 KiB, and every rule it read must still deny by default.
    const long = Array.from({ length: MAX_AI_SEARCH_PAGES }, (_, i) => `/@${"h".repeat(240)}${i}.unset.im`);
    const text = robotsTxt(ORIGIN, long);
    expect(Buffer.byteLength(text)).toBeLessThan(500 * 1024);
    const group = text.slice(text.indexOf("User-agent: OAI-SearchBot"));
    expect(group.indexOf("Disallow: /@\n")).toBeLessThan(group.indexOf("Allow: /@"));
    expect(text.indexOf("User-agent: *")).toBeLessThan(text.indexOf("User-agent: OAI-SearchBot"));
  });

  test("capped", () => {
    const many = Array.from({ length: MAX_AI_SEARCH_PAGES + 5 }, (_, i) => `/@m${i}.unset.im`);
    expect(robotsTxt(ORIGIN, many).match(/^Allow: \/@/gm)).toHaveLength(MAX_AI_SEARCH_PAGES);
    expect(Buffer.byteLength(robotsTxt(ORIGIN, many))).toBeLessThan(500 * 1024);
  });
});

describe("sitemapXml", () => {
  test("lists_safe_paths_only", () => {
    const xml = sitemapXml(ORIGIN, ["/@ann.unset.im", "/@<x>"]);
    expect(xml).toContain("<loc>https://unset.sh/@ann.unset.im</loc>");
    expect(xml).not.toContain("<x>");
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset')).toBe(true);
  });
});

describe("CLOSED_ROBOTS_TXT", () => {
  // Search and AI listing switched off on the whole site (P1.21b): search engines may fetch every page, so they read its
  // noindex (a page robots.txt blocks never shows it, ADR 0031 Decision 1); training and AI search crawlers are refused
  // every path; no sitemap and no member is named.
  test("search_engines_read_noindex_ai_crawlers_are_refused_and_no_sitemap", () => {
    const groups = CLOSED_ROBOTS_TXT.split("\n\n");
    expect(groups).toHaveLength(2);
    const refused = groups[0] ?? "";
    for (const token of [...TRAINING_CRAWLERS, ...AI_SEARCH_CRAWLERS])
      expect(refused).toContain(`User-agent: ${token}\n`);
    expect(refused.endsWith("\nDisallow: /")).toBe(true);
    expect(groups[1]).toBe("User-agent: *\nAllow: /\n");
    expect(CLOSED_ROBOTS_TXT).not.toMatch(/^(Sitemap:|Allow: \/@|Disallow: \/@)/m);
  });
});
