// Math in a Text card's Markdown, drawn on the server as MathML (math.ts): what a formula becomes, what never gets
// through (colours, styles, links, pictures), and where a formula is shown as its source instead.
import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { drawMath, MATH_ATTRIBUTES, MATH_ELEMENTS, type MathNode, mathBudget } from "./math.ts";
import { MAX_TEX_CHARS } from "./math-syntax.ts";

const draw = (tex: string, display = false) => drawMath(tex, display, mathBudget());

/** Every element and attribute in a drawn formula. */
function walk(node: MathNode, seen: { names: Set<string>; attrs: Map<string, string> }): void {
  seen.names.add(node.name);
  for (const [name, value] of Object.entries(node.attrs)) seen.attrs.set(name, value);
  for (const child of node.children) if (typeof child !== "string") walk(child, seen);
}

describe("drawMath", () => {
  test("a formula is its MathML, without KaTeX's wrapper and the TeX annotation", () => {
    expect(draw("x^2")).toEqual({
      name: "math",
      attrs: {},
      children: [
        {
          name: "mrow",
          attrs: {},
          children: [
            {
              name: "msup",
              attrs: {},
              children: [
                { name: "mi", attrs: {}, children: ["x"] },
                { name: "mn", attrs: {}, children: ["2"] },
              ],
            },
          ],
        },
      ],
    });
  });

  test("a display formula says so, and the attributes that shape it are kept", () => {
    const drawn = draw("\\mathbb{R}\\left(\\frac12\\right)", true);
    expect(drawn?.attrs).toEqual({ display: "block" });
    const seen = { names: new Set<string>(), attrs: new Map<string, string>() };
    if (drawn !== null) walk(drawn, seen);
    expect(seen.attrs.get("mathvariant")).toBe("double-struck");
    expect(seen.attrs.get("fence")).toBe("true");
    expect(seen.names).toContain("mfrac");
  });

  test("colours, styles, links and pictures never get through", () => {
    for (const tex of [
      "\\color{red}{x}",
      "\\textcolor{#f00}{x}",
      "\\colorbox{red}{x}",
      "\\rule{1em}{2em}",
      "\\href{https://example.com}{x}",
      "\\url{https://example.com}",
      "\\includegraphics{https://example.com/a.png}",
      "\\htmlStyle{color:red}{x}",
      "\\htmlClass{a}{x}",
      "\\htmlId{a}{x}",
      "\\htmlData{a=b}{x}",
    ]) {
      const drawn = draw(tex);
      const seen = { names: new Set<string>(), attrs: new Map<string, string>() };
      if (drawn !== null) walk(drawn, seen);
      for (const name of ["style", "class", "id", "href", "src", "mathcolor", "mathbackground"]) {
        expect([tex, seen.attrs.has(name)]).toEqual([tex, false]);
      }
      expect([tex, seen.names.has("mglyph")]).toEqual([tex, false]);
    }
  });

  // Review of #2019 at d1f2a98: nested \raisebox added up voffset past the card, over the page's own header. Nothing
  // that moves a formula's text off its own box is kept: no voffset, no negative length, no length counted in another
  // part's size ("-1width").
  test("nothing moves a formula's text off its own box", () => {
    const raised = "\\raisebox{10em}{".repeat(3);
    for (const tex of [
      `${raised}X${"}".repeat(3)}`,
      "\\kern-50em X",
      "\\hspace{-20em} X",
      "\\mathllap{X}",
      "\\mathrlap{X}",
      "\\smash{X}",
      "\\lower{5em}{X}",
      "\\mkern-90mu X",
      "\\negthickspace\\negthickspace X",
    ]) {
      const drawn = draw(tex);
      const seen = { names: new Set<string>(), attrs: new Map<string, string>() };
      if (drawn !== null) walk(drawn, seen);
      expect([tex, seen.attrs.has("voffset")]).toEqual([tex, false]);
      const all: string[] = [];
      const every = (node: MathNode) => {
        // A font name such as "sans-serif" has a hyphen and moves nothing.
        all.push(...Object.entries(node.attrs).flatMap(([name, value]) => (name === "mathvariant" ? [] : [value])));
        for (const child of node.children) if (typeof child !== "string") every(child);
      };
      if (drawn !== null) every(drawn);
      for (const value of all) expect([tex, value]).toEqual([tex, expect.not.stringMatching(/-|width|height|depth/)]);
    }
  });

  test("markup in a formula's text stays text", () => {
    expect(draw("\\text{<script>alert(1)</script>}")).toEqual({
      name: "math",
      attrs: {},
      children: [
        { name: "mrow", attrs: {}, children: [{ name: "mtext", attrs: {}, children: ["<script>alert(1)</script>"] }] },
      ],
    });
  });

  test("a formula KaTeX cannot read, or nested past its stack, is not drawn", () => {
    expect(draw("\\frac{")).toBeNull();
    expect(draw("\\tag{1} x")).toBeNull();
    expect(draw(`${"{".repeat(3_000)}x${"}".repeat(3_000)}`)).toBeNull();
  });

  test("a macro that expands without end is stopped", () => {
    expect(draw("\\def\\a{\\a\\a}\\a")).toBeNull();
    const tens = "\\def\\a{xxxxxxxxxx}\\def\\b{\\a\\a\\a\\a\\a\\a\\a\\a\\a\\a}\\def\\c{\\b\\b\\b\\b\\b\\b\\b\\b\\b\\b}";
    expect(draw(`${tens}\\c\\c\\c`)).toBeNull();
  });

  test("a formula longer than the limit is not drawn", () => {
    expect(draw("x".repeat(MAX_TEX_CHARS))).not.toBeNull();
    expect(draw("x".repeat(MAX_TEX_CHARS + 1))).toBeNull();
  });

  test("one card's formulas share a budget of elements and of formulas", () => {
    const budget = mathBudget();
    let drawn = 0;
    while (drawMath("\\begin{matrix}a&b\\\\c&d\\end{matrix}", false, budget) !== null) drawn += 1;
    expect(drawn).toBeGreaterThan(10);
    expect(drawMath("x", false, budget)).toBeNull();

    const many = mathBudget();
    const counts = Array.from({ length: 300 }, () => drawMath("x", false, many) !== null);
    expect(counts.filter(Boolean).length).toBeLessThan(300);
  });

  test("whatever is written, only the allowed elements and attributes come out, with plain values", () => {
    const pieces = fc.constantFrom(
      "x",
      "^",
      "_",
      "{",
      "}",
      "\\frac",
      "\\sqrt",
      "\\left(",
      "\\right)",
      "\\begin{pmatrix}",
      "\\end{pmatrix}",
      "\\begin{array}{|c|}",
      "\\end{array}",
      "\\hline",
      "&",
      "\\\\",
      "\\color{red}",
      "\\colorbox{blue}",
      "\\rule{1em}{1em}",
      "\\kern2em",
      "\\raisebox{1em}",
      "\\boxed",
      "\\cancel",
      "\\overbrace",
      "\\mathbb",
      "\\text{<b>}",
      "\\verb|<i>|",
      "\\href{https://a}",
      "\\phantom",
      "\\big(",
      "\\operatorname{f}",
      '\\char"41',
      "\\def\\a{y}\\a",
      "1",
      " ",
    );
    fc.assert(
      fc.property(fc.array(pieces, { maxLength: 20 }), fc.boolean(), (parts, display) => {
        const drawn = draw(parts.join(""), display);
        if (drawn === null) return;
        const seen = { names: new Set<string>(), attrs: new Map<string, string>() };
        walk(drawn, seen);
        for (const name of seen.names) expect(MATH_ELEMENTS.has(name)).toBe(true);
        for (const [name, value] of seen.attrs) {
          expect(MATH_ATTRIBUTES.has(name)).toBe(true);
          expect(value).toMatch(name === "mathvariant" ? /^[a-z]+(-[a-z]+)*$/ : /^[A-Za-z0-9.+ ]{0,64}$/);
        }
      }),
      { numRuns: 2_000, seed: 121 },
    );
  });
});
