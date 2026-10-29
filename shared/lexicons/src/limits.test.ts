import { describe, expect, test } from "vitest";
import { IMAGE_ACCEPT, LIMITS } from "./limits.ts";
import { validateRecord } from "./validate.ts";

const CREATED = "2026-10-12T00:00:00.000Z";
const profile = { $type: "sh.unset.profile", displayName: "Ada", createdAt: CREATED };
const section = { $type: "sh.unset.section", type: "links", title: "Links", position: 0, createdAt: CREATED };
const text = (n: number) => "x".repeat(n);
const ORIGIN = "https://a.example.com/";
const url = (bytes: number) => `${ORIGIN}${"p".repeat(bytes - ORIGIN.length)}`;
const MAIL_DOMAIN = "@a.example.com";
const blob = (size: number) => ({
  $type: "blob",
  ref: { $link: "bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku" },
  mimeType: IMAGE_ACCEPT[0],
  size,
});
const stats = (n: number) => Array.from({ length: n }, () => ({ label: "a", value: "1" }));
const items = (n: number) => Array.from({ length: n }, () => ({ title: "a" }));
// README blocks: unions carry their def's $type (https://atproto.com/specs/lexicon#union).
const DEFS = "sh.unset.profile#";
const [PARAGRAPH, HEADING, LIST_ITEM, CODE, COLUMNS, RUN, LINK] = [
  "paragraph",
  "heading",
  "listItem",
  "codeBlock",
  "columns",
  "textRun",
  "linkRun",
].map((def) => `${DEFS}${def}`);
const run = (t: string) => ({ $type: RUN, text: t });
const paragraph = (content: unknown[]) => ({ $type: PARAGRAPH, content });
const para = paragraph([run("a")]);
const readme = (block: unknown) => ({ blocks: [block] });
const columns = (n: number) => Array.from({ length: n }, () => ({ blocks: [para] }));

// One record per limit: the value exactly at the limit passes and one past it fails, which proves LIMITS equals the
// schema's constraint. A new LIMITS entry without a row here fails `every_limit_has_a_fixture`.
type Build = (n: number) => { nsid: "sh.unset.profile" | "sh.unset.section"; value: Record<string, unknown> };
const P =
  (field: (n: number) => Record<string, unknown>): Build =>
  (n) => ({ nsid: "sh.unset.profile", value: { ...profile, ...field(n) } });
const S =
  (field: (n: number) => Record<string, unknown>): Build =>
  (n) => ({ nsid: "sh.unset.section", value: { ...section, ...field(n) } });
const FIXTURES: Record<string, Build> = {
  "profile.displayName": P((n) => ({ displayName: text(n) })),
  "profile.headline": P((n) => ({ headline: text(n) })),
  "profile.bio": P((n) => ({ bio: text(n) })),
  "profile.readmeBlocksMax": P((n) => ({ readme: { blocks: Array.from({ length: n }, () => para) } })),
  "profile.readmeColumnsMax": P((n) => ({ readme: readme({ $type: COLUMNS, columns: columns(n) }) })),
  "profile.readmeColumnBlocksMax": P((n) => ({
    readme: readme({ $type: COLUMNS, columns: [{ blocks: Array.from({ length: n }, () => para) }, { blocks: [] }] }),
  })),
  "profile.readmeRunsMax": P((n) => ({ readme: readme(paragraph(Array.from({ length: n }, () => run("a")))) })),
  "profile.readmeLinkRunsMax": P((n) => ({
    readme: readme(paragraph([{ $type: LINK, uri: ORIGIN, content: Array.from({ length: n }, () => run("a")) }])),
  })),
  "profile.readmeRunText": P((n) => ({ readme: readme(paragraph([run(text(n))])) })),
  "profile.readmeHeadingLevelMax": P((n) => ({ readme: readme({ $type: HEADING, level: n, content: [] }) })),
  "profile.readmeIndentMax": P((n) => ({
    readme: readme({ $type: LIST_ITEM, style: "bullet", indent: n, content: [] }),
  })),
  "profile.readmeCode": P((n) => ({ readme: readme({ $type: CODE, text: text(n) }) })),
  "profile.readmeCodeLanguageBytes": P((n) => ({ readme: readme({ $type: CODE, text: "", language: text(n) }) })),
  "profile.readmeLinkUriBytes": P((n) => ({
    readme: readme(paragraph([{ $type: LINK, uri: url(n), content: [run("a")] }])),
  })),
  "profile.location": P((n) => ({ location: text(n) })),
  "profile.websiteBytes": P((n) => ({ website: url(n) })),
  "profile.linksMax": P((n) => ({ links: Array.from({ length: n }, () => ({ uri: ORIGIN })) })),
  "profile.linkUriBytes": P((n) => ({ links: [{ uri: url(n) }] })),
  "profile.emailBytes": P((n) => ({ email: `${text(n - MAIL_DOMAIN.length)}${MAIL_DOMAIN}` })),
  "profile.availabilityLabel": P((n) => ({ availability: { label: text(n) } })),
  "profile.availabilityDetail": P((n) => ({ availability: { detail: text(n) } })),
  "profile.statsMax": P((n) => ({ stats: stats(n) })),
  "profile.statLabel": P((n) => ({ stats: [{ label: text(n), value: "1" }] })),
  "profile.statValue": P((n) => ({ stats: [{ label: "a", value: text(n) }] })),
  "profile.ctaTitle": P((n) => ({ cta: { title: text(n) } })),
  "profile.ctaBody": P((n) => ({ cta: { body: text(n) } })),
  "profile.ctaLabel": P((n) => ({ cta: { label: text(n) } })),
  "profile.ctaHrefBytes": P((n) => ({ cta: { href: url(n) } })),
  "profile.avatarMaxSize": P((n) => ({ avatar: blob(n) })),
  "profile.coverMaxSize": P((n) => ({ coverImage: blob(n) })),
  "section.title": S((n) => ({ title: text(n) })),
  "section.summary": S((n) => ({ summary: text(n) })),
  "section.positionMax": S((n) => ({ position: n })),
  "section.itemsMax": S((n) => ({ items: items(n) })),
  "section.itemTag": S((n) => ({ items: [{ tag: text(n) }] })),
  "section.itemTitle": S((n) => ({ items: [{ title: text(n) }] })),
  "section.itemSummary": S((n) => ({ items: [{ summary: text(n) }] })),
  "section.itemUrlBytes": S((n) => ({ items: [{ url: url(n) }] })),
  "section.itemHandle": S((n) => ({ items: [{ handle: text(n) }] })),
  "section.itemLabel": S((n) => ({ items: [{ label: text(n) }] })),
};
const limitEntries = Object.entries(LIMITS).flatMap(([record, fields]) =>
  Object.entries(fields).map(([field, limit]) => [`${record}.${field}`, limit] as const),
);

describe("LIMITS", () => {
  test("every_limit_has_a_fixture", () => {
    expect(limitEntries.map(([key]) => key).sort()).toEqual(Object.keys(FIXTURES).sort());
  });

  test("limits_enforced", () => {
    for (const [key, limit] of limitEntries) {
      const build = FIXTURES[key];
      if (!build) throw new Error(`no fixture for ${key}`);
      const at = build(limit);
      const over = build(limit + 1);
      expect(validateRecord(at.nsid, at.value, "write").ok, `${key} at ${limit}`).toBe(true);
      expect(validateRecord(over.nsid, over.value, "write").ok, `${key} over ${limit}`).toBe(false);
    }
  });

  test("a_columns_block_needs_two_columns", () => {
    const value = (n: number) => ({ ...profile, readme: readme({ $type: COLUMNS, columns: columns(n) }) });
    expect(validateRecord("sh.unset.profile", value(2), "write").ok).toBe(true);
    expect(validateRecord("sh.unset.profile", value(1), "write").ok).toBe(false);
  });

  test("a_readme_string_is_refused", () => {
    expect(validateRecord("sh.unset.profile", { ...profile, readme: "## Hi" }, "write").ok).toBe(false);
  });
});
