// Codex on #2020: two formulas side by side in the editor were saved as "$x$$y$", which micromark-extension-math 3.1.0
// reads as one formula "x$$y" (a closing run must be as long as the opening one), so the card showed its source. And a
// formula holding a pipe in a table cell was saved with the pipe bare, which split the cell.
import katex from "katex";
import { expect, test } from "vitest";
import { MAX_TEX_CHARS } from "../profile/math-syntax.ts";
import { parseReadme } from "../profile/parse.ts";
import { type InlineFormula, pipesAsTex, writeFormulaRun } from "./math-write.ts";

type Phrase = InlineFormula | { readonly type: "text"; readonly value: string };

const formula = (value: string): InlineFormula => ({ type: "inlineMath", value });
const words = (value: string): Phrase => ({ type: "text", value });
/** mdast-util-math 3.0.0's writer for these values: one dollar, or two when asked for at least two. */
/** What KaTeX 0.16.47 shows for some TeX, as text; it throws where the TeX does not render. */
const shown = (tex: string) =>
  katex
    .renderToString(tex, { output: "mathml", throwOnError: true })
    .replace(/<annotation[\s\S]*?<\/annotation>/g, "")
    .replace(/<[^>]+>/g, "");
const writer = (node: InlineFormula, wide: boolean) => (wide ? `$$${node.value}$$` : `$${node.value}$`);
const written = (children: Phrase[]) =>
  children.map((node) => (node.type === "inlineMath" ? writeFormulaRun(node, children, writer) : node.value));

test("formulas side by side are written as one, at least two dollars wide, so the page reads them as math", () => {
  const children = [words("a "), formula("x"), formula("\\alpha"), formula("y"), words(" b")];
  expect(written(children)).toEqual(["a ", "$${x}{\\alpha}{y}$$", "", "", " b"]);
  const [paragraph] = parseReadme(written(children).join(""));
  const kinds = paragraph?.kind === "paragraph" ? paragraph.children.map((inline) => inline.kind) : [];
  expect(kinds).toEqual(["text", "math", "text"]);
});

// Codex on #2020 (bebe04e): joined by a space, "x^2" and "^3" made "x^2 ^3", a double superscript. Each keeps its group.
test("formulas side by side keep their own groups, so scripts at their edges do not meet", () => {
  expect(written([formula("x^2"), formula("^3")])).toEqual(["$${x^2}{^3}$$", ""]);
  expect(() => shown("{x^2}{^3}")).not.toThrow();
});

// Codex on #2020 (7d3ca66): a TeX comment runs to the line's end (KaTeX 0.16.47 src/Lexer.ts), so in "{x% note}{y}" it
// took the group's end and the next formula. Comments, which draw nothing, move to the end of the run.
test("a comment in a formula side by side with others moves to the end, so it takes nothing after it", () => {
  const children = [formula("x% note"), formula("\\% y \\verb!%!"), formula("z % last")];
  expect(written(children)).toEqual(["$${x}{\\% y \\verb!%!}{z }% note% last$$", "", ""]);
  expect(shown("{x}{\\% y \\verb!%!}{z }% note% last")).toBe(shown("x\\% y \\verb!%!z"));
});

// Codex on #2020 (9277e7e): two formulas of 1,100 characters each drew alone, but joined they passed the page's
// MAX_TEX_CHARS and showed as source. A run is cut where joining would pass it, with a space between the parts.
test("a run longer than a formula may be is cut into formulas each within it, a space between", () => {
  const long = "x".repeat(1_100);
  const children = [formula(long), formula(long), formula("y")];
  const [markdown] = written(children);
  expect(markdown).toBe(`$$${long}$$ $$${`{${long}}{y}`}$$`);
  // The writer is told what follows the whole run, not a part, so every part is written wide (review of c2a74a8: a
  // run cut into [a, b] and [c] before "5" saved "$c$5", which the page reads as words).
  const tail = written([formula(long), formula(long), words("5")]);
  expect(tail[0]).toBe(`$$${long}$$ $$${long}$$`);
  const [digits] = parseReadme(tail.join(""));
  const after = digits?.kind === "paragraph" ? digits.children.map((inline) => inline.kind) : [];
  expect(after).toEqual(["math", "text", "math", "text"]);
  const [paragraph] = parseReadme(markdown ?? "");
  const kinds = paragraph?.kind === "paragraph" ? paragraph.children.map((inline) => inline.kind) : [];
  expect(kinds).toEqual(["math", "text", "math"]);
  expect(`{${long}}{y}`.length).toBeLessThanOrEqual(MAX_TEX_CHARS);
});

// In a table cell each formula's pipes are written as TeX before the run is joined, so the cut counts them.
test("a run in a table cell is measured with its pipes written as TeX", () => {
  const children = [formula("|x|"), formula("y")];
  const cell = (node: InlineFormula) => writeFormulaRun(node, children, writer, pipesAsTex);
  expect(cell(children[0] as InlineFormula)).toBe('$${{\\char"7C}x{\\char"7C}}{y}$$');
});

test("a formula with words beside it is written by mdast-util-math's writer as it was", () => {
  expect(written([formula("x"), words(" and "), formula("y")])).toEqual(["$x$", " and ", "$y$"]);
});

test("pipes in a formula become the TeX that draws them, so a table cell keeps its formula and its neighbours", () => {
  const tex = "|x| + \\|y\\| + \\\\|z";
  expect(pipesAsTex(tex)).toBe('{\\char"7C}x{\\char"7C} + \\|y\\| + \\\\{\\char"7C}z');
  expect(shown(pipesAsTex(tex))).toBe(shown(tex));
  const text = `| a | b |\n| --- | --- |\n| $${pipesAsTex("|x|")}$ | keep |`;
  const [table] = parseReadme(text);
  expect(table?.kind === "table" && table.rows[0]?.map((cell) => cell.map((inline) => inline.kind))).toEqual([
    ["math"],
    ["text"],
  ]);
});

// Codex on #2020 (b301932): a pipe in \verb is shown as it is written (KaTeX 0.16.47 Lexer: \verb and \verb* take
// any one delimiter and the line up to the next), so "\vert" there would show as the word. The page must show the same.
test.each([
  ["\\verb!a|b!", "\\verb!a!\\texttt{\\textbar}\\verb!b!"],
  ["\\verb*!a |b!", "\\verb*!a !\\texttt{\\textbar}\\verb*!b!"],
  ["\\verb|x y|", "\\verb!x y!"],
  ["\\verb|!+=/;:@~^,.?'\"#&-_|", "\\verb\u00a1!+=/;:@~^,.?'\"#&-_\u00a1"],
  ["\\verb!|!+|x|", '\\texttt{\\textbar}+{\\char"7C}x{\\char"7C}'],
])("a pipe in \\verb stays one the page shows as written: %s", (tex, expected) => {
  expect(pipesAsTex(tex)).toBe(expected);
  expect(pipesAsTex(tex)).not.toMatch(/(?<!\\)\|/);
  expect(shown(pipesAsTex(tex))).toBe(shown(tex));
});

// Codex on #2020 (bebe04e): KaTeX 0.16.47 defines \vert in math only (src/symbols.ts), so "\text{a|b}" became TeX that
// does not render. \char"7C draws the pipe in both modes; only a delimiter after \left and its kin needs \vert.
const PIPE = '{\\char"7C}';
test.each([
  ["\\text{a|b}", '\\text{a{\\char"7C}b}'],
  ["\\text{$|x|$}", `\\text{$${PIPE}x${PIPE}$}`],
  ["\\left|x\\right|", "\\left\\vert x\\right\\vert"],
  ["\\bigl| x \\Bigr|", "\\bigl\\vert x \\Bigr\\vert"],
])("a pipe outside \\verb becomes TeX that draws it where it stands: %s", (tex, expected) => {
  expect(pipesAsTex(tex)).toBe(expected);
  expect(pipesAsTex(tex)).not.toMatch(/(?<!\\)\|/);
  expect(shown(pipesAsTex(tex))).toBe(shown(tex));
});

// Codex on #2020 (e7cf785): {\char"7C} is ten characters for one, so 201 pipes drew in the editor and passed the
// page's MAX_TEX_CHARS once written. Past it, the pipes are written as \vert, half the length, for math.
test("pipes that would pass the page's limit as char are written as vert", () => {
  const tex = "|".repeat(201);
  const written = pipesAsTex(tex);
  expect(written.length).toBeLessThanOrEqual(MAX_TEX_CHARS);
  expect(written).not.toMatch(/(?<!\\)\|/);
  expect(shown(written)).toBe(shown(tex));
});
