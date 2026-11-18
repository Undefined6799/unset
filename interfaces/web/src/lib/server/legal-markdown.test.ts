// P1.20d: the web process's copy of the legal parser (apps/web/src/legal/markdown.ts until P1.20k deletes it) parses
// the three committed documents, refuses every link outside its allowlist, and refuses an unknown hole. The documents'
// own contents (markers, versions) stay tested in apps/web/src/legal/documents.test.tsx until then; escaping is
// checked on the built server (tests/integration/web/public/public-pages.test.ts).
import { describe, expect, test } from "vitest";
import domains from "../../../../../apps/web/legal/domains.en.md?raw";
import privacy from "../../../../../apps/web/legal/privacy.en.md?raw";
import terms from "../../../../../apps/web/legal/terms.en.md?raw";
import { parseLegal } from "./legal-markdown.ts";

const linkTo = (href: string) => `# T\n\n[x](${href})\n`;

describe("legal markdown", () => {
  test("parses_the_committed_documents", () => {
    for (const source of [terms, privacy, domains]) expect(parseLegal(source).blocks.length).toBeGreaterThan(0);
    expect(parseLegal(terms).version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(parseLegal(domains).version).toBeNull();
  });

  test("keeps_only_allowlisted_links", () => {
    for (const ok of ["/legal/privacy", "https://www.priv.gc.ca/en/report-a-concern/", "mailto:a@b.example"]) {
      expect(() => parseLegal(linkTo(ok)), ok).not.toThrow();
    }
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,x",
      "//evil.example/x",
      "/\\evil.example",
      "http://plain.example/",
      "https://user:pass@x.example/",
      "relative/path",
      "/a b",
    ]) {
      expect(() => parseLegal(linkTo(bad)), bad).toThrow(/link refused/);
    }
  });

  test("refuses_an_unknown_hole_and_raw_html_stays_text", () => {
    expect(() => parseLegal("# T\n\n{{nope}}\n")).toThrow(/unknown hole/);
    const doc = parseLegal("# T\n\nSee <b>no</b>.\n");
    expect(doc.blocks[1]).toEqual({ kind: "p", children: [{ kind: "text", text: "See <b>no</b>." }] });
  });
});
