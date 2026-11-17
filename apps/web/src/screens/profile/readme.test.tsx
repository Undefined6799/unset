// The README card's markdown (ADR 0051): a CommonMark subset parsed into blocks and rendered by React, never as HTML.
import fc from "fast-check";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { parseReadme, Readme } from "./readme.tsx";

const html = (src: string) => renderToStaticMarkup(<Readme text={src} />);

describe("parseReadme", () => {
  test("headings, paragraphs, lists, quotes, code and rules", () => {
    const src = [
      "# Hello",
      "",
      "I build **small** tools and *write* about them.",
      "Second line.",
      "",
      "- one",
      "* two",
      "",
      "1. first",
      "2. second",
      "",
      "> quoted",
      "",
      "```",
      "<b>raw</b>",
      "```",
      "",
      "---",
    ].join("\n");
    expect(parseReadme(src)).toEqual([
      { kind: "heading", level: 1, children: [{ kind: "text", text: "Hello" }] },
      {
        kind: "paragraph",
        children: [
          { kind: "text", text: "I build " },
          { kind: "strong", children: [{ kind: "text", text: "small" }] },
          { kind: "text", text: " tools and " },
          { kind: "em", children: [{ kind: "text", text: "write" }] },
          { kind: "text", text: " about them. Second line." },
        ],
      },
      { kind: "list", ordered: false, items: [[{ kind: "text", text: "one" }], [{ kind: "text", text: "two" }]] },
      { kind: "list", ordered: true, items: [[{ kind: "text", text: "first" }], [{ kind: "text", text: "second" }]] },
      { kind: "quote", children: [{ kind: "text", text: "quoted" }] },
      { kind: "code", text: "<b>raw</b>" },
      { kind: "rule" },
    ]);
  });

  test("inline code, links and autolinks", () => {
    expect(parseReadme("Run `npm ci` then see [the docs](https://x.example/d) or <https://y.example>.")).toEqual([
      {
        kind: "paragraph",
        children: [
          { kind: "text", text: "Run " },
          { kind: "code", text: "npm ci" },
          { kind: "text", text: " then see " },
          { kind: "link", href: "https://x.example/d", children: [{ kind: "text", text: "the docs" }] },
          { kind: "text", text: " or " },
          { kind: "link", href: "https://y.example/", children: [{ kind: "text", text: "https://y.example/" }] },
          { kind: "text", text: "." },
        ],
      },
    ]);
  });

  test("underscores inside a word stay text", () => {
    expect(parseReadme("my_var_name and _this_")).toEqual([
      {
        kind: "paragraph",
        children: [
          { kind: "text", text: "my_var_name and " },
          { kind: "em", children: [{ kind: "text", text: "this" }] },
        ],
      },
    ]);
  });

  test("a heading deeper than three reads as level three", () => {
    expect(parseReadme("##### Deep")).toEqual([
      { kind: "heading", level: 3, children: [{ kind: "text", text: "Deep" }] },
    ]);
  });

  test("an unclosed code fence runs to the end", () => {
    expect(parseReadme("```js\nlet a\n\nlet b")).toEqual([{ kind: "code", text: "let a\n\nlet b" }]);
  });

  test("NUL and other controls are removed before parsing", () => {
    expect(parseReadme("a\u0000b\u0007c")).toEqual([{ kind: "paragraph", children: [{ kind: "text", text: "abc" }] }]);
  });
});

describe("parseReadme, review findings on #1648", () => {
  test("a heading line of any length parses in linear time", () => {
    const line = `## a${" ".repeat(90_000)}b`;
    const started = performance.now();
    const [block] = parseReadme(line);
    expect(performance.now() - started).toBeLessThan(500);
    expect(block).toMatchObject({ kind: "heading", level: 2 });
  });

  // Member text is rendered on the server, so no input may make the parser quadratic. Each case is 100,000
  // characters (the lexicon's limit) of an opener that never closes.
  test.each([
    ["unclosed link destinations", "[a](".repeat(25_000)],
    ["unclosed labels", `${"[".repeat(99_996)}](x)`],
    ["labels with no destination", "[a]".repeat(33_333)],
    ["unclosed autolinks", "<https://a".repeat(10_000)],
    ["lone backticks", "a`".repeat(50_000)],
    ["emphasis openers before a run of marks", `${"*a".repeat(25_000)}${"*".repeat(50_000)}`],
    ["strong openers", "**a".repeat(33_333)],
    ["underscores", " _a".repeat(33_333)],
    ["fence lines", "```\n~~~~\n".repeat(12_500)],
    ["nested emphasis", "*_**".repeat(25_000)],
  ])("%s parse in linear time", (_name, src) => {
    expect(src.length).toBeGreaterThanOrEqual(99_000);
    const started = performance.now();
    parseReadme(src);
    expect(performance.now() - started).toBeLessThan(500);
  });

  test("a destination past the address limit, or holding a bracket, stays text", () => {
    const long = `[a](https://a.example/${"x".repeat(2_000)})`;
    expect(parseReadme(long)).toEqual([{ kind: "paragraph", children: [{ kind: "text", text: long }] }]);
    const bracket = "[a](https://a.example/[x])";
    expect(parseReadme(bracket)).toEqual([{ kind: "paragraph", children: [{ kind: "text", text: bracket }] }]);
  });

  test("trailing hashes are a closing sequence only after a space", () => {
    expect(parseReadme("## C#")).toEqual([{ kind: "heading", level: 2, children: [{ kind: "text", text: "C#" }] }]);
    expect(parseReadme("## Title ##")).toEqual([
      { kind: "heading", level: 2, children: [{ kind: "text", text: "Title" }] },
    ]);
    expect(parseReadme("#")).toEqual([{ kind: "heading", level: 1, children: [] }]);
  });

  test("a link destination keeps balanced parentheses", () => {
    const [block] = parseReadme("[wiki](https://en.wikipedia.org/wiki/Function_(mathematics)) after");
    expect(block).toMatchObject({
      kind: "paragraph",
      children: [
        { kind: "link", href: "https://en.wikipedia.org/wiki/Function_(mathematics)" },
        { kind: "text", text: " after" },
      ],
    });
  });

  test("a longer fence holds a shorter one as code", () => {
    expect(parseReadme("````\n```js\nx\n```\n````\nafter")).toEqual([
      { kind: "code", text: "```js\nx\n```" },
      { kind: "paragraph", children: [{ kind: "text", text: "after" }] },
    ]);
  });
});

describe("Readme", () => {
  test("headings sit under the card's own heading", () => {
    expect(html("# A\n\n## B\n\n### C")).toBe("<h3>A</h3><h4>B</h4><h5>C</h5>");
  });

  test.each([
    "[x](javascript:alert(1))",
    "[x](JaVaScRiPt:alert(1))",
    "[x](data:text/html,hi)",
    "[x](vbscript:x)",
    "[x](//evil.example)",
    "[x](/relative)",
    "[x](https://user:pw@evil.example)",
    "[x](mailto:a@b.example)",
    "<javascript:alert(1)>",
  ])("a link that is not plain http or https stays text: %s", (src) => {
    expect(html(src)).not.toContain("<a");
  });

  test("raw HTML is shown as text", () => {
    expect(html('<script>alert(1)</script><img src=x onerror="alert(1)">')).toBe(
      "<p>&lt;script&gt;alert(1)&lt;/script&gt;&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</p>",
    );
  });

  test("links open as user content", () => {
    expect(html("[a](https://a.example)")).toBe(
      '<p><a href="https://a.example/" rel="nofollow ugc noopener noreferrer">a</a></p>',
    );
  });

  test("random input never yields script, handlers or unsafe links", () => {
    const pieces = fc.constantFrom(
      "<",
      ">",
      '"',
      "'",
      "&",
      "javascript:",
      "data:",
      "\u0000",
      "[",
      "](",
      ")",
      "*",
      "**",
      "`",
      "```\n",
      "\n",
      "# ",
      "> ",
      "- ",
      "https://a.example",
      "<script>",
      " onerror=",
      "x",
      " ",
    );
    fc.assert(
      fc.property(fc.array(pieces, { maxLength: 60 }), (parts) => {
        const out = html(parts.join(""));
        expect(out).not.toMatch(/<script/i);
        expect(out).not.toMatch(/<[a-z]+[^>]*\son[a-z]+=/i);
        for (const [, href] of out.matchAll(/<a href="([^"]*)"/g)) expect(href).toMatch(/^https?:\/\//);
      }),
      { numRuns: 10_000, seed: 51 },
    );
  });
});
