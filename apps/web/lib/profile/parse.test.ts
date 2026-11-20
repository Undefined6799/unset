// The README parser's images and nested lists (staging walkthrough 2026-11-18, finding 7). The sweep for slow input
// is in parse.adversarial.test.ts.
import { describe, expect, test } from "vitest";
import { parseInline, parseReadme } from "./parse.ts";

const text = (t: string) => ({ kind: "text", text: t });
const item = (t: string, lists: unknown[] = []) => ({ text: [text(t)], lists });

describe("parseReadme", () => {
  test("an image is a link to it with its alt text, without the stray mark", () => {
    expect(parseInline("see ![a cat](https://example.com/cat.png) here")).toEqual([
      text("see "),
      { kind: "link", href: "https://example.com/cat.png", children: [text("a cat")] },
      text(" here"),
    ]);
  });

  test("an image whose address is refused stays text, as a link does", () => {
    expect(parseInline("![x](javascript:alert(1))")).toEqual([text("![x](javascript:alert(1))")]);
  });

  test("an item indented to the text of the one above is its own list, and lists of both kinds nest", () => {
    const src = ["- fruit", "  - apple", "  - pear", "    1. green", "- veg", "   1. leek"].join("\n");
    expect(parseReadme(src)).toEqual([
      {
        kind: "list",
        ordered: false,
        items: [
          item("fruit", [
            {
              kind: "list",
              ordered: false,
              items: [item("apple"), item("pear", [{ kind: "list", ordered: true, items: [item("green")] }])],
            },
          ]),
          item("veg", [{ kind: "list", ordered: true, items: [item("leek")] }]),
        ],
      },
    ]);
  });

  test("an item indented less than the text above is a sibling, and past three levels lists stop nesting", () => {
    expect(parseReadme("- a\n - b")).toEqual([{ kind: "list", ordered: false, items: [item("a"), item("b")] }]);
    const deep = ["- 1", "  - 2", "    - 3", "      - 4"].join("\n");
    const third = { kind: "list", ordered: false, items: [item("3"), item("4")] };
    expect(parseReadme(deep)).toEqual([
      {
        kind: "list",
        ordered: false,
        items: [item("1", [{ kind: "list", ordered: false, items: [item("2", [third])] }])],
      },
    ]);
  });
});

describe("parseReadme, the CommonMark subset (moved from the React card's test, P1.20k)", () => {
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
      {
        kind: "list",
        ordered: false,
        items: [
          { text: [{ kind: "text", text: "one" }], lists: [] },
          { text: [{ kind: "text", text: "two" }], lists: [] },
        ],
      },
      {
        kind: "list",
        ordered: true,
        items: [
          { text: [{ kind: "text", text: "first" }], lists: [] },
          { text: [{ kind: "text", text: "second" }], lists: [] },
        ],
      },
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

// CommonMark 0.31.2, "Backslash escapes" (https://spec.commonmark.org/0.31.2/#backslash-escapes): any ASCII
// punctuation after a backslash is that character as text, and opens or closes nothing. The rich editor (remark-
// stringify 11) writes these for a literal `*`, `_` or `[`, so the page must not show the backslash.
describe("backslash escapes", () => {
  test("an escaped mark is the mark as text", () => {
    expect(parseInline("a \\* b \\_ c \\[d]")).toEqual([text("a * b _ c [d]")]);
  });

  test("an escaped mark opens no emphasis and closes none", () => {
    expect(parseInline("\\*not em\\*")).toEqual([text("*not em*")]);
    expect(parseInline("*a \\* b*")).toEqual([{ kind: "em", children: [text("a * b")] }]);
  });

  test("an escaped backslash is one backslash, and the mark after it still counts", () => {
    expect(parseInline("\\\\*em*")).toEqual([text("\\"), { kind: "em", children: [text("em")] }]);
  });

  test("a backslash before anything that is not ASCII punctuation stays", () => {
    expect(parseInline("C:\\dir \\é")).toEqual([text("C:\\dir \\é")]);
  });

  test("inside a code span a backslash is text", () => {
    expect(parseInline("`a\\*b`")).toEqual([{ kind: "code", text: "a\\*b" }]);
  });

  // Codex review of #1827: an escaped backtick opens no code span, so it cannot hide the mark that closes emphasis.
  test("an escaped backtick opens no code span", () => {
    expect(parseInline("*a \\` b* c \\`")).toEqual([{ kind: "em", children: [text("a ` b")] }, text(" c `")]);
    expect(parseInline("\\``code`")).toEqual([text("`"), { kind: "code", text: "code" }]);
  });

  test("an escaped hash at the start of a line is a paragraph, not a heading", () => {
    expect(parseReadme("\\# not a heading")).toEqual([{ kind: "paragraph", children: [text("# not a heading")] }]);
  });
});
