// The Text card's reader against inputs written to break it, and the CommonMark cases review found on #1648. Moved
// from the React screen's test with P1.20k; the Svelte card passes a list's start to <ol start>
// (components/profile/readme.svelte).
//
// Since P1.21k the parser is micromark, which is not bounded on hostile text (parse.ts), so the time a parse may take
// is held by the page's reader and tested there (interfaces/web text-reader.test.ts). What is held here is that the
// parser itself never throws.
import { describe, expect, test } from "vitest";
import { type Inline, parseReadme, plainText } from "./parse.ts";

/** The inline nodes of a text that is one paragraph. */
function parseInline(src: string): readonly Inline[] {
  const [block] = parseReadme(src);
  return block?.kind === "paragraph" ? block.children : [];
}

describe("parseReadme, adversarial input", () => {
  // micromark 4.0.3 recurses once per level of nesting and overflows the stack on thousands of them (a RangeError
  // from inside mdast-util-find-and-replace or unist-util-visit-parents). The card is then shown as written.
  test("nesting deeper than the parser's stack is shown as plain text, not thrown", { timeout: 60_000 }, () => {
    const nested = ">".repeat(20_000);
    expect(parseReadme(nested)).toEqual(plainText(nested));
  });

  test("a heading line of any length is a heading", () => {
    const [block] = parseReadme(`## a${" ".repeat(19_000)}b`);
    expect(block).toMatchObject({ kind: "heading", level: 2 });
  });

  // A destination may hold brackets and be of any length (CommonMark 0.31.2, "Links"); before P1.21k the page's
  // subset linked neither. safeHref still decides: it refuses an address past its own length limit.
  test("a destination holding a bracket is a link, and one safeHref refuses for its length stays text", () => {
    const long = `[a](https://a.example/${"x".repeat(2_000)})`;
    expect(parseReadme(long)).toEqual([{ kind: "paragraph", children: [{ kind: "text", text: long }] }]);
    expect(parseReadme("[a](https://a.example/[x])")).toEqual([
      {
        kind: "paragraph",
        children: [{ kind: "link", href: "https://a.example/[x]", children: [{ kind: "text", text: "a" }] }],
      },
    ]);
  });

  test("a code span closes only on a run of the same length, so it can show backticks", () => {
    expect(parseInline("Use `` `x` `` here")).toEqual([
      { kind: "text", text: "Use " },
      { kind: "code", text: "`x`" },
      { kind: "text", text: " here" },
    ]);
    expect(parseInline("a ``b` c")).toEqual([{ kind: "text", text: "a ``b` c" }]);
  });

  test("an escaped parenthesis in a destination is the parenthesis itself", () => {
    expect(parseInline("[wiki](https://example.com/a\\(b\\))")).toMatchObject([
      { kind: "link", href: "https://example.com/a(b)" },
    ]);
  });

  test("an emphasis mark inside a code span does not close the emphasis around it", () => {
    expect(parseInline("*Use `a*b` here*")).toEqual([
      {
        kind: "em",
        children: [
          { kind: "text", text: "Use " },
          { kind: "code", text: "a*b" },
          { kind: "text", text: " here" },
        ],
      },
    ]);
  });

  test("an emphasis mark inside a link destination does not close the emphasis around it", () => {
    expect(parseInline("*[docs](https://example.com/a*b) here*")).toMatchObject([
      {
        kind: "em",
        children: [
          { kind: "link", href: "https://example.com/a*b" },
          { kind: "text", text: " here" },
        ],
      },
    ]);
  });

  test("a ]( that opens no link does not hide an emphasis closer", () => {
    expect(parseInline("*`a](b`c*)")).toEqual([
      {
        kind: "em",
        children: [
          { kind: "code", text: "a](b" },
          { kind: "text", text: "c" },
        ],
      },
      { kind: "text", text: ")" },
    ]);
    expect(parseInline("*a](b*)")).toEqual([
      { kind: "em", children: [{ kind: "text", text: "a](b" }] },
      { kind: "text", text: ")" },
    ]);
  });

  test("a bracket inside code in a link label does not end the label", () => {
    expect(parseInline("*[a `]` b](https://x/a*b) c*")).toMatchObject([
      {
        kind: "em",
        children: [
          { kind: "link", href: "https://x/a*b" },
          { kind: "text", text: " c" },
        ],
      },
    ]);
  });

  test("an ordered list keeps its first number", () => {
    expect(parseReadme("3. third\n4. fourth")).toMatchObject([{ kind: "list", ordered: true, start: 3 }]);
    expect(parseReadme("1. one")[0]).not.toHaveProperty("start");
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

  // Codex on #1958: a wide header with thousands of one-character rows is a few bytes per row but fifty cells each,
  // and the server renders every cell for each visitor. The card's tables share one budget of cells.
  test("the tables of one card hold at most 10,000 cells, however short their rows", () => {
    const head = `|${"h|".repeat(50)}\n|${"-|".repeat(50)}\n`;
    const cells = (blocks: ReturnType<typeof parseReadme>) =>
      blocks.reduce((n, b) => (b.kind === "table" ? n + (b.rows.length + 1) * b.head.length : n), 0);
    const one = parseReadme(`${head}${"x\n".repeat(9_700)}`);
    expect(cells(one)).toBeLessThanOrEqual(10_000);
    const many = parseReadme(`${head}${"x\n".repeat(100)}\n`.repeat(200));
    expect(cells(many)).toBeLessThanOrEqual(10_000);
    expect(many[0]).toMatchObject({ kind: "table" });
  });

  test("a longer fence holds a shorter one as code", () => {
    expect(parseReadme("````\n```js\nx\n```\n````\nafter")).toEqual([
      { kind: "code", text: "```js\nx\n```", language: "" },
      { kind: "paragraph", children: [{ kind: "text", text: "after" }] },
    ]);
  });
});
