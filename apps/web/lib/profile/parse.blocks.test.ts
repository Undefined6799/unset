// How a Text card's Markdown is cut into top-level blocks (book P1.21k). A look is placed on a block by the lines it
// starts and ends on (ADR 0110 decision 5: read "as CommonMark with the GFM table extension only: no math and no
// footnote extension"), so the page, the editor and any other app must cut the same text the same way. Each sample
// below is held three ways: to the blocks written out here, as CommonMark 0.31.2 and GFM 0.29 give them; to a parse
// with the table extension alone, which is the reader rule; and through it to the page's own parse, which also reads
// strikethrough, task items and bare addresses. A property test then holds the page's cut to the table-only cut on
// generated text. The editor's block count (a later step) must pass this same corpus.
import fc from "fast-check";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmTableFromMarkdown } from "mdast-util-gfm-table";
import { gfmTable } from "micromark-extension-gfm-table";
import { describe, expect, test } from "vitest";
import { parseReadme, topBlocks } from "./parse.ts";

type Cut = ReturnType<typeof topBlocks>;

/** The reader rule itself: CommonMark with GFM tables and nothing else; a link reference definition is no block. */
function tableOnly(text: string): Cut {
  const root = fromMarkdown(text, { extensions: [gfmTable()], mdastExtensions: [gfmTableFromMarkdown()] });
  return root.children
    .filter((node) => node.type !== "definition")
    .map((node) => ({ kind: node.type, from: node.position?.start.line ?? 0, to: node.position?.end.line ?? 0 }));
}

const block = (kind: string, from: number, to = from) => ({ kind, from, to });

/** A sample's name, its lines, and its blocks: kind, first line and last line, lines counted from 1. */
const CORPUS: readonly (readonly [name: string, lines: readonly string[], blocks: Cut])[] = [
  ["paragraphs split at a blank line", ["one", "two", "", "three"], [block("paragraph", 1, 2), block("paragraph", 4)]],
  [
    "a fenced code block ends on its closing fence",
    ["```js", "let a", "", "let b", "```", "after"],
    [block("code", 1, 5), block("paragraph", 6)],
  ],
  ["a fenced code block left open runs to the end", ["```", "a", "", "b"], [block("code", 1, 4)]],
  [
    "a shorter fence does not close a longer one",
    ["````", "```", "x", "````", "after"],
    [block("code", 1, 4), block("paragraph", 5)],
  ],
  [
    "indented code keeps its blank lines and drops the ones after it",
    ["    a", "", "    b", "", "", "after"],
    [block("code", 1, 3), block("paragraph", 6)],
  ],
  ["an indented line continues a paragraph", ["words", "    more"], [block("paragraph", 1, 2)]],
  ["a list ends on its last item's line", ["- a", "- b", "", "after"], [block("list", 1, 2), block("paragraph", 4)]],
  ["list items with a blank line between them are one list", ["- one", "", "- two"], [block("list", 1, 3)]],
  ["a changed bullet character starts a new list", ["- one", "* two"], [block("list", 1), block("list", 2)]],
  ["a nested list is part of its item", ["1. a", "   - b", "   - c", "2. d"], [block("list", 1, 4)]],
  ["a quote ends on its last line", ["> a", "> b", "", "after"], [block("blockquote", 1, 2), block("paragraph", 4)]],
  [
    "a lazy line continues the quote's paragraph",
    ["> a", "b", "", "after"],
    [block("blockquote", 1, 2), block("paragraph", 4)],
  ],
  ["a lazy line continues the item's paragraph", ["- a", "b", "- c"], [block("list", 1, 3)]],
  [
    "a table's header, delimiter and rows",
    ["| a | b |", "| - | - |", "| 1 | 2 |", "", "after"],
    [block("table", 1, 3), block("paragraph", 5)],
  ],
  // Unverified in ADR 0110 until this corpus: the paragraph keeps its line and the table starts on the header's.
  [
    "a table whose header follows a paragraph line",
    ["words", "| a | b |", "| - | - |", "| 1 | 2 |"],
    [block("paragraph", 1), block("table", 2, 4)],
  ],
  [
    "a table ends at the start of another block",
    ["| a |", "| - |", "| 1 |", "> q"],
    [block("table", 1, 3), block("blockquote", 4)],
  ],
  ["a row of hyphens under a line is a heading, not a table", ["| a |", "---"], [block("heading", 1, 2)]],
  [
    "headings of both kinds",
    ["# A", "B", "===", "C", "---", "## D ##"],
    [block("heading", 1), block("heading", 2, 3), block("heading", 4, 5), block("heading", 6)],
  ],
  [
    "a thematic break",
    ["a", "", "---", "***", "b"],
    [block("paragraph", 1), block("thematicBreak", 3), block("thematicBreak", 4), block("paragraph", 5)],
  ],
  ["a link reference definition is no block", ["[a]: https://a.example", "", "[a]"], [block("paragraph", 3)]],
  // Unverified in ADR 0110 until this corpus: the paragraph starts on its own line, after the definition's.
  [
    "a paragraph straight after a link reference definition",
    ["[a]: https://a.example", "words [a]"],
    [block("paragraph", 2)],
  ],
  [
    "definitions between blocks",
    ["one", "", "[a]: https://a.example", "[b]: https://b.example", "", "two"],
    [block("paragraph", 1), block("paragraph", 6)],
  ],
  ["a footnote definition is a link reference definition", ["[^1]: note", "", "text[^1]"], [block("paragraph", 3)]],
  [
    "a footnote definition with no address is a paragraph",
    ["[^1]:", "", "text"],
    [block("paragraph", 1), block("paragraph", 3)],
  ],
  [
    "a math block is the paragraphs CommonMark makes of it",
    ["$$", "x = 1", "", "y = 2", "$$"],
    [block("paragraph", 1, 2), block("paragraph", 4, 5)],
  ],
  [
    "a math block with no blank line is one paragraph",
    ["before", "", "$$", "x", "$$"],
    [block("paragraph", 1), block("paragraph", 3, 5)],
  ],
  [
    "an HTML block runs to its blank line",
    ["<div>", "**x**", "</div>", "", "after"],
    [block("html", 1, 3), block("paragraph", 5)],
  ],
  [
    "a script block runs to its closing tag, blank lines too",
    ["<script>", "", "x", "</script>", "after"],
    [block("html", 1, 4), block("paragraph", 5)],
  ],
  [
    "a tag alone on a line cannot break into a paragraph",
    ["words", "<br />", "", "<br />"],
    [block("paragraph", 1, 2), block("html", 4)],
  ],
  [
    "a struck run, a task and a bare address move no block",
    ["~~a~~ www.a.example", "", "- [x] done", "- [ ] https://a.example"],
    [block("paragraph", 1), block("list", 3, 4)],
  ],
  ["line ends of every kind", ["# A\r", "\r", "one\r", "two"], [block("heading", 1), block("paragraph", 3, 4)]],
];

describe("the page's top-level blocks", () => {
  test.each(CORPUS)("%s", (_name, lines, blocks) => {
    const text = lines.join("\n");
    expect(tableOnly(text)).toEqual(blocks);
    expect(topBlocks(text)).toEqual(blocks);
  });

  // What the page draws comes from the same tree: one drawn block for each counted one, wherever each has something
  // to show (an empty quote and the old empty-line mark draw nothing; rows past the cell guard add a paragraph).
  test.each(CORPUS)("the page draws one block for each: %s", (_name, lines, blocks) => {
    const drawn: Record<string, string> = { blockquote: "quote", thematicBreak: "rule", html: "paragraph" };
    const kinds = blocks
      .filter(({ kind, from }) => kind !== "html" || lines[from - 1] !== "<br />")
      .map(({ kind }) => drawn[kind] ?? kind);
    expect(parseReadme(lines.join("\n")).map((shown) => shown.kind)).toEqual(kinds);
  });

  // Strikethrough, task items and bare addresses are read inside a block's text, after the blocks are cut, so they
  // cannot move a block; this holds the page's parse to that on text built from the marks that start and end blocks.
  test("generated text is cut as the table extension alone cuts it", () => {
    const pieces = fc.constantFrom(
      "\n",
      "\n\n",
      " ",
      "    ",
      "\t",
      "a",
      "word ",
      "# ",
      "## ",
      "===",
      "---",
      "***",
      "- ",
      "* ",
      "+ ",
      "1. ",
      "2) ",
      "> ",
      ">",
      "```",
      "~~~",
      "`",
      "|",
      "| a | b |",
      "| - | - |",
      "|-|",
      ":-:",
      "[a]: https://a.example",
      "[a]",
      "[^1]: n",
      "[^1]",
      "$$",
      "<div>",
      "</div>",
      "<br />",
      "<!--",
      "-->",
      "<script>",
      "~~",
      "~",
      "[ ] ",
      "[x] ",
      "www.a.example",
      "https://a.example",
      "a@b.example",
      "*",
      "_",
      "**",
      "\\",
      "&amp;",
      "![a](https://a.example)",
      "\r\n",
      "\r",
    );
    fc.assert(
      fc.property(fc.array(pieces, { maxLength: 40 }), (parts) => {
        const text = parts.join("");
        expect(topBlocks(text)).toEqual(tableOnly(text.replace(/\r\n?/g, "\n")));
      }),
      { numRuns: 5_000, seed: 121 },
    );
  });
});
