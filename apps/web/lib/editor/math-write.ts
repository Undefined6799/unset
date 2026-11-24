// How formulas in a line are written back (Codex on #2020). This file imports nothing, so a test can hold it to the
// page's reader without loading the editor.

/** A formula in a line as mdast-util-math 3.0.0 gives it to the writer. */
export type InlineFormula = { readonly type: "inlineMath"; readonly value: string };

/**
 * A formula's Markdown among its siblings in a line. mdast-util-math 3.0.0 writes each formula alone (lib/index.js
 * inlineMath), so two side by side came out as "$x$$y$", and micromark-extension-math 3.1.0 closes a formula only on a
 * run of dollars as long as the one that opened it (dev/lib/math-text.js), so the page read one formula "x$$y" and
 * showed its source. Dollars cannot divide two formulas with nothing between them, so a run of them is written as one
 * formula, their TeX joined by a space (which TeX ignores in math, and which keeps "\alpha" from running into a
 * letter), by the writer asked for at least two dollars, which the page always reads as math (math-syntax.ts
 * isInlineMath). The first of the run writes it; the others write nothing.
 */
export function writeFormulaRun(
  node: InlineFormula,
  siblings: readonly { readonly type: string }[],
  write: (formula: InlineFormula, wide: boolean) => string,
): string {
  const at = siblings.indexOf(node);
  if (siblings[at - 1]?.type === "inlineMath") return "";
  let last = at;
  while (siblings[last + 1]?.type === "inlineMath") last += 1;
  if (last === at) return write(node, false);
  const run = siblings.slice(at, last + 1).map((formula) => ("value" in formula ? String(formula.value) : ""));
  return write({ type: "inlineMath", value: run.join(" ") }, true);
}

/**
 * A formula's TeX with each bare pipe written as `\vert`, the same delimiter in TeX, with a space after it before a
 * letter, which TeX ignores in math and which keeps the letter from joining the command. A table cell ends at a bare
 * pipe (GFM 0.29, "Tables (extension)"), and mdast-util-gfm-table 2.0.1 escapes pipes only in inline code (lib/index.js
 * inlineCodeWithTable), so in a cell this keeps the formula and the cells after it. `\|` (TeX's double bar) is no
 * cell's end and stays as it is, and so does `\\`, a line break: a backslash and the character after it are one.
 */
export function pipesAsTex(tex: string): string {
  return tex.replace(/\\[\s\S]|\|/g, (found: string, at: number) => {
    if (found !== "|") return found;
    return /[A-Za-z]/.test(tex[at + 1] ?? "") ? "\\vert " : "\\vert";
  });
}
