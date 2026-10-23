// The member-written markdown subset (Alex, 2026-10-23 02:32Z: "README subset plus columns"). Member-written text,
// so the parser is total: every input gives blocks, and anything it does not recognise stays literal text.
import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { MARKDOWN_LIMITS, parseMarkdown } from "./markdown.ts";

const only = (source: string) => {
  const doc = parseMarkdown(source);
  expect(doc.rows).toHaveLength(1);
  expect(doc.rows[0]?.columns).toHaveLength(1);
  return doc.rows[0]?.columns[0] ?? [];
};

describe("blocks", () => {
  test("headings: # and ## are section headings, ### a subheading", () => {
    expect(only("# One\n## Two\n### Three")).toEqual([
      { kind: "h", level: 2, children: [{ kind: "text", text: "One" }] },
      { kind: "h", level: 2, children: [{ kind: "text", text: "Two" }] },
      { kind: "h", level: 3, children: [{ kind: "text", text: "Three" }] },
    ]);
  });

  test("a paragraph keeps single line breaks and ends at a blank line", () => {
    expect(only("one\ntwo\n\nthree")).toEqual([
      { kind: "p", lines: [[{ kind: "text", text: "one" }], [{ kind: "text", text: "two" }]] },
      { kind: "p", lines: [[{ kind: "text", text: "three" }]] },
    ]);
  });

  test("bulleted and numbered lists", () => {
    expect(only("- a\n* b\n\n1. c\n2. d")).toEqual([
      { kind: "ul", items: [[{ kind: "text", text: "a" }], [{ kind: "text", text: "b" }]] },
      { kind: "ol", items: [[{ kind: "text", text: "c" }], [{ kind: "text", text: "d" }]] },
    ]);
  });

  test("a quote joins its lines", () => {
    expect(only("> keep it\n> small")).toEqual([
      { kind: "quote", lines: [[{ kind: "text", text: "keep it" }], [{ kind: "text", text: "small" }]] },
    ]);
  });

  test("a fenced code block keeps its text as written, markdown included", () => {
    expect(only("```\nnpx **tidy**\n  two\n```")).toEqual([{ kind: "code", text: "npx **tidy**\n  two" }]);
  });

  test("an unclosed fence runs to the end of the text", () => {
    expect(only("```\nleft open")).toEqual([{ kind: "code", text: "left open" }]);
  });
});

describe("rows and columns", () => {
  test("--- starts a new row and ::: a new column inside it", () => {
    const doc = parseMarkdown("## About\nhi\n:::\n## Projects\n- a\n---\n## Posts");
    expect(doc.rows.map((row) => row.columns.length)).toEqual([2, 1]);
    expect(doc.rows[0]?.columns[1]?.[0]).toEqual({
      kind: "h",
      level: 2,
      children: [{ kind: "text", text: "Projects" }],
    });
  });

  test("at most three columns: a fourth ::: is literal text", () => {
    const doc = parseMarkdown("a\n:::\nb\n:::\nc\n:::\nd");
    expect(doc.rows[0]?.columns).toHaveLength(3);
    expect(doc.rows[0]?.columns[2]).toEqual([
      {
        kind: "p",
        lines: [[{ kind: "text", text: "c" }], [{ kind: "text", text: ":::" }], [{ kind: "text", text: "d" }]],
      },
    ]);
  });

  test("empty rows and columns are dropped", () => {
    const doc = parseMarkdown("---\n:::\nx\n---\n---");
    expect(doc.rows).toEqual([{ columns: [[{ kind: "p", lines: [[{ kind: "text", text: "x" }]] }]] }]);
  });

  test("empty text has no rows", () => {
    expect(parseMarkdown("  \n\n").rows).toEqual([]);
  });
});

describe("inlines", () => {
  test("strong, emphasis and code", () => {
    expect(only("**b** *i* `c`")).toEqual([
      {
        kind: "p",
        lines: [
          [
            { kind: "strong", children: [{ kind: "text", text: "b" }] },
            { kind: "text", text: " " },
            { kind: "em", children: [{ kind: "text", text: "i" }] },
            { kind: "text", text: " " },
            { kind: "code", text: "c" },
          ],
        ],
      },
    ]);
  });

  test("links go through safeHref: https and our own paths only", () => {
    expect(only("[site](https://alice.dev) [post](/@alice/p/1)")).toEqual([
      {
        kind: "p",
        lines: [
          [
            { kind: "link", href: "https://alice.dev/", children: [{ kind: "text", text: "site" }] },
            { kind: "text", text: " " },
            { kind: "link", href: "/@alice/p/1", children: [{ kind: "text", text: "post" }] },
          ],
        ],
      },
    ]);
  });

  test.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,<b>x</b>",
    "vbscript:x",
    "//evil.example",
    "http://plain.example",
    "https://user:pw@evil.example",
  ])("a refused link stays literal text: %s", (url) => {
    const source = `[x](${url})`;
    expect(only(source)).toEqual([{ kind: "p", lines: [[{ kind: "text", text: source }]] }]);
  });

  test("HTML is text", () => {
    expect(only("<script>alert(1)</script>")).toEqual([
      { kind: "p", lines: [[{ kind: "text", text: "<script>alert(1)</script>" }]] },
    ]);
  });

  test("an unclosed mark is literal", () => {
    expect(only("**open *half `tick")).toEqual([
      { kind: "p", lines: [[{ kind: "text", text: "**open *half `tick" }]] },
    ]);
  });

  test("a link inside strong stays literal (no nesting beyond text)", () => {
    expect(only("**[x](https://a.example)**")).toEqual([
      { kind: "p", lines: [[{ kind: "strong", children: [{ kind: "text", text: "[x](https://a.example)" }] }]] },
    ]);
  });
});

describe("limits and hostile input", () => {
  test("control characters are removed, tabs and newlines kept", () => {
    expect(only("a\u0000b\u0007c\td")).toEqual([{ kind: "p", lines: [[{ kind: "text", text: "abc\td" }]] }]);
  });

  test("only the first MARKDOWN_LIMITS.characters characters are read", () => {
    const doc = parseMarkdown("x".repeat(MARKDOWN_LIMITS.characters + 50));
    const block = doc.rows[0]?.columns[0]?.[0];
    expect(block?.kind === "p" && block.lines[0]?.[0]).toEqual({
      kind: "text",
      text: "x".repeat(MARKDOWN_LIMITS.characters),
    });
  });

  test("no more than MARKDOWN_LIMITS.blocks blocks", () => {
    const doc = parseMarkdown(Array.from({ length: 500 }, (_, i) => `p${i}`).join("\n\n"));
    const count = doc.rows.flatMap((row) => row.columns).flat().length;
    expect(count).toBe(MARKDOWN_LIMITS.blocks);
  });

  test("never throws, and every link it keeps is https or a path", () => {
    const pieces = fc.constantFrom(
      "[",
      "]",
      "(",
      ")",
      "*",
      "**",
      "`",
      "```",
      "\n",
      ":::",
      "---",
      "> ",
      "- ",
      "1. ",
      "#",
      "<",
      "javascript:",
      "https://a.example",
      "/p",
      "x",
      " ",
      "\u0000",
    );
    fc.assert(
      fc.property(fc.array(pieces, { maxLength: 80 }), (parts) => {
        const doc = parseMarkdown(parts.join(""));
        const hrefs = JSON.stringify(doc).match(/"href":"[^"]*"/g) ?? [];
        for (const href of hrefs) expect(href).toMatch(/^"href":"(https:\/\/|\/[^/])/);
      }),
      { numRuns: 2000, seed: 20261023 },
    );
  });
});
