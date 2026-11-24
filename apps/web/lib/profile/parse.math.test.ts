// Math in a Text card as the page reads it (parse.ts with math.ts): GitHub's syntax, $…$ in a line, $$…$$ and a
// ```math block on lines of their own (https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/writing-mathematical-expressions),
// read by micromark-extension-math 3.1.0 (its readme, "Syntax"). A formula the page cannot draw is its source.
import { describe, expect, test } from "vitest";
import { drawMath, mathBudget } from "./math.ts";
import { type Inline, parseReadme, topBlocks } from "./parse.ts";

const text = (t: string) => ({ kind: "text", text: t });
const tree = (tex: string, display = false) => drawMath(tex, display, mathBudget());

function parseInline(src: string): readonly Inline[] {
  const [block] = parseReadme(src);
  return block?.kind === "paragraph" ? block.children : [];
}

describe("math in the text", () => {
  test("a formula between single dollars is drawn in the line", () => {
    expect(parseInline("so $x^2$ grows")).toEqual([
      text("so "),
      { kind: "math", tex: "x^2", tree: tree("x^2") },
      text(" grows"),
    ]);
  });

  test("a formula between two dollars on lines of their own is a block, blank lines and all", () => {
    expect(parseReadme("$$\nx = 1\n\ny = 2\n$$\nafter")).toEqual([
      { kind: "math", tree: tree("x = 1\n\ny = 2", true) },
      { kind: "paragraph", children: [text("after")] },
    ]);
  });

  test("a code block whose language is math is a formula", () => {
    expect(parseReadme("```math\n\\frac{a}{b}\n```")).toEqual([{ kind: "math", tree: tree("\\frac{a}{b}", true) }]);
  });

  test("an escaped dollar is a dollar", () => {
    expect(parseInline("\\$5 or \\$6")).toEqual([text("$5 or $6")]);
  });

  test("a formula KaTeX cannot read is its source: as written in a line, as code in a block", () => {
    expect(parseInline("see $\\frac{$ here")).toEqual([text("see $\\frac{$ here")]);
    expect(parseReadme("$$\n\\frac{\n$$")).toEqual([{ kind: "code", text: "\\frac{", language: "" }]);
    expect(parseReadme("```math\n\\frac{\n```")).toEqual([{ kind: "code", text: "\\frac{", language: "" }]);
  });

  test("a formula in a list item or a quote is drawn in its line", () => {
    expect(parseReadme("- $a$\n- $$\n  b\n  $$")).toEqual([
      {
        kind: "list",
        ordered: false,
        items: [
          { text: [{ kind: "math", tex: "a", tree: tree("a") }], lists: [] },
          { text: [{ kind: "math", tex: "b", tree: tree("b") }], lists: [] },
        ],
      },
    ]);
    expect(parseReadme("> $c$")).toEqual([
      { kind: "quote", paragraphs: [[{ kind: "math", tex: "c", tree: tree("c") }]] },
    ]);
  });

  test("a card's formulas past its budget are their source", () => {
    const blocks = parseReadme("$x$ ".repeat(250));
    const [paragraph] = blocks;
    const nodes = paragraph?.kind === "paragraph" ? paragraph.children : [];
    expect(nodes.filter((node) => node.kind === "math")).toHaveLength(200);
    expect(nodes.at(-1)).toEqual(text(` ${"$x$ ".repeat(50).trimEnd()}`));
  });

  // Looks are placed on the blocks CommonMark with GFM tables cuts (ADR 0110 decision 5), never on the math blocks.
  test("math moves no block a look is placed by", () => {
    expect(topBlocks("$$\nx\n\ny\n$$")).toEqual([
      { kind: "paragraph", from: 1, to: 2 },
      { kind: "paragraph", from: 4, to: 5 },
    ]);
  });
});
