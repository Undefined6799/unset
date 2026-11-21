// The README parser against inputs written to break it: parse time on repeated tokens (member text is rendered on
// the server), and the CommonMark cases review found on #1648. Moved from the React screen's test with P1.20k; the
// Svelte card passes a list's start to <ol start> (components/profile/readme.svelte).
import { describe, expect, test } from "vitest";
import { parseInline, parseReadme } from "./parse.ts";

describe("parseReadme, adversarial input", () => {
  test("a heading line of any length parses in linear time", () => {
    const line = `## a${" ".repeat(90_000)}b`;
    const started = performance.now();
    const [block] = parseReadme(line);
    expect(performance.now() - started).toBeLessThan(500);
    expect(block).toMatchObject({ kind: "heading", level: 2 });
  });

  // Member text is rendered on the server, so no input may make the parser quadratic. Rather than a list of known
  // bad inputs, every token below, alone and in each ordered pair, is repeated to the lexicon's 100,000 characters.
  const TOKENS = [
    "a",
    "1",
    " ",
    "\t",
    "\n",
    "\n\n",
    "\\",
    "é",
    "😀",
    "&",
    "!",
    "*",
    "**",
    "_",
    "__",
    "*a",
    "a*",
    "_a",
    "a_",
    "__a",
    "a__",
    "**a",
    "a**",
    "_a _",
    "`",
    "``",
    "`a",
    "a`",
    "```",
    "~~~",
    "[",
    "]",
    "(",
    ")",
    "](",
    "\\](",
    "\\[",
    "\\]",
    "[a]",
    "[a](",
    "](x)",
    "[a](https://a.example)",
    "![",
    "![a](https://a.example)",
    "![a](",
    "  - ",
    "    1. ",
    "\n  - a",
    "\n      - a",
    "<",
    ">",
    "<http://a",
    "<https://a.example>",
    "https://a.example",
    "www.",
    "www.a",
    "http://",
    ").",
    "#",
    "## ",
    "> ",
    "- ",
    "1. ",
    "---",
    "***",
    "___",
  ];
  const PARSE_BUDGET_MS = 500;
  // The inputs that once read each character thousands of times parse in a few milliseconds now; a tighter bar
  // catches a scan that is linear only up to a large constant (each opener reading 2,000 characters).
  const LINEAR_BUDGET_MS = 150;

  test(`${TOKENS.length} tokens and every ordered pair, at 100,000 characters, each parse in under ${PARSE_BUDGET_MS} ms`, () => {
    const shapes = [...TOKENS, ...TOKENS.flatMap((a) => TOKENS.map((b) => a + b))];
    const slow: string[] = [];
    for (const shape of shapes) {
      const src = shape.repeat(Math.ceil(100_000 / shape.length)).slice(0, 100_000);
      const started = performance.now();
      parseReadme(src);
      const took = performance.now() - started;
      if (took >= PARSE_BUDGET_MS) slow.push(`${JSON.stringify(shape)} ${Math.round(took)} ms`);
    }
    expect(slow).toEqual([]);
  }, 600_000);

  test.each([
    ["blank lines before many short fences", `${"\n".repeat(80_000)}${"```\nx\n```\n".repeat(2_000)}`],
    ["backtick runs of rising length", Array.from({ length: 445 }, (_, n) => `${"`".repeat(n + 1)}a`).join("")],
    ["emphasis openers before a run of marks", `${"*a".repeat(25_000)}${"*".repeat(50_000)}`],
    ["an emphasis opener before escaped label closers", `*a${"\\](".repeat(33_330)}`],
  ])("%s parse in linear time", (_name, src) => {
    const started = performance.now();
    parseReadme(src);
    expect(performance.now() - started).toBeLessThan(PARSE_BUDGET_MS);
  });

  test.each([
    ["labels whose destinations escape the next bracket", "[a\\](\\".repeat(16_667)],
    ["escaped labels whose destinations escape the next bracket", "\\[a\\](".repeat(16_667)],
    // Review of #1827 at b449c4d: each opener looked for the next unescaped "](" past every escaped one.
    ["label openers before escaped label closers", `${"[".repeat(50_000)}${"\\](".repeat(16_000)}`],
    ["labels of escaped closers", "[\\](".repeat(25_000)],
    // Bare addresses (GFM autolink literals): each start reads its address once, and a refused one is not reread.
    ["bare names whose domains are refused", "www._".repeat(20_000)],
    ["bare names inside one long address-like run", "(www.a_b.c_".repeat(9_000)],
    ["an address before a run of closing marks", `https://a.example/${")".repeat(99_000)}`],
    ["an address before a run of references", `https://a.example/${"&a;".repeat(33_000)}`],
  ])("%s read each destination once", (_name, src) => {
    const started = performance.now();
    parseReadme(src);
    expect(performance.now() - started).toBeLessThan(LINEAR_BUDGET_MS);
  });

  test("a destination past the address limit, or holding a bracket, stays text", () => {
    const long = `[a](https://a.example/${"x".repeat(2_000)})`;
    expect(parseReadme(long)).toEqual([{ kind: "paragraph", children: [{ kind: "text", text: long }] }]);
    // The label is not a link; the address in it is a bare one (GFM "Autolinks (extension)"), which ends before
    // "])", as GFM's trailing punctuation does.
    const bracket = "[a](https://a.example/[x])";
    expect(parseReadme(bracket)).toEqual([
      {
        kind: "paragraph",
        children: [
          { kind: "text", text: "[a](" },
          { kind: "link", href: "https://a.example/[x", children: [{ kind: "text", text: "https://a.example/[x" }] },
          { kind: "text", text: "])" },
        ],
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

  test("a longer fence holds a shorter one as code", () => {
    expect(parseReadme("````\n```js\nx\n```\n````\nafter")).toEqual([
      { kind: "code", text: "```js\nx\n```" },
      { kind: "paragraph", children: [{ kind: "text", text: "after" }] },
    ]);
  });
});
