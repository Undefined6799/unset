// Codex on #2020: two formulas side by side in the editor were saved as "$x$$y$", which micromark-extension-math 3.1.0
// reads as one formula "x$$y" (a closing run must be as long as the opening one), so the card showed its source. And a
// formula holding a pipe in a table cell was saved with the pipe bare, which split the cell.
import katex from "katex";
import { expect, test } from "vitest";
import { parseReadme } from "../profile/parse.ts";
import { type InlineFormula, pipesAsTex, writeFormulaRun } from "./math-write.ts";

type Phrase = InlineFormula | { readonly type: "text"; readonly value: string };

const formula = (value: string): InlineFormula => ({ type: "inlineMath", value });
const words = (value: string): Phrase => ({ type: "text", value });
/** mdast-util-math 3.0.0's writer for these values: one dollar, or two when asked for at least two. */
const writer = (node: InlineFormula, wide: boolean) => (wide ? `$$${node.value}$$` : `$${node.value}$`);
const written = (children: Phrase[]) =>
  children.map((node) => (node.type === "inlineMath" ? writeFormulaRun(node, children, writer) : node.value));

test("formulas side by side are written as one, at least two dollars wide, so the page reads them as math", () => {
  const children = [words("a "), formula("x"), formula("\\alpha"), formula("y"), words(" b")];
  expect(written(children)).toEqual(["a ", "$$x \\alpha y$$", "", "", " b"]);
  const [paragraph] = parseReadme(written(children).join(""));
  const kinds = paragraph?.kind === "paragraph" ? paragraph.children.map((inline) => inline.kind) : [];
  expect(kinds).toEqual(["text", "math", "text"]);
});

test("a formula with words beside it is written by mdast-util-math's writer as it was", () => {
  expect(written([formula("x"), words(" and "), formula("y")])).toEqual(["$x$", " and ", "$y$"]);
});

test("pipes in a formula become the TeX that draws them, so a table cell keeps its formula and its neighbours", () => {
  expect(pipesAsTex("|x| + \\|y\\| + \\\\|z")).toBe("\\vert x\\vert + \\|y\\| + \\\\\\vert z");
  const text = `| a | b |\n| --- | --- |\n| $${pipesAsTex("|x|")}$ | keep |`;
  const [table] = parseReadme(text);
  expect(table?.kind === "table" && table.rows[0]?.map((cell) => cell.map((inline) => inline.kind))).toEqual([
    ["math"],
    ["text"],
  ]);
});

// Codex on #2020 (b301932): a pipe in \verb is shown as it is written (KaTeX 0.16.47 Lexer: \verb and \verb* take
// any one delimiter and the line up to the next), so "\vert" there would show as the word. The page must show the same.
const shown = (tex: string) =>
  katex
    .renderToString(tex, { output: "mathml", throwOnError: true })
    .replace(/<annotation[\s\S]*?<\/annotation>/g, "")
    .replace(/<[^>]+>/g, "");

test.each([
  ["\\verb!a|b!", "\\verb!a!\\texttt{\\textbar}\\verb!b!"],
  ["\\verb*!a |b!", "\\verb*!a !\\texttt{\\textbar}\\verb*!b!"],
  ["\\verb|x y|", "\\verb!x y!"],
  ["\\verb|!+=/;:@~^,.?'\"#&-_|", "\\verb\u00a1!+=/;:@~^,.?'\"#&-_\u00a1"],
  ["\\verb!|!+|x|", "\\texttt{\\textbar}+\\vert x\\vert"],
])("a pipe in \\verb stays one the page shows as written: %s", (tex, expected) => {
  expect(pipesAsTex(tex)).toBe(expected);
  expect(pipesAsTex(tex)).not.toMatch(/(?<!\\)\|/);
  expect(shown(pipesAsTex(tex))).toBe(shown(tex));
});
