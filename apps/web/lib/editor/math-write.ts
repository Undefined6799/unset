// How formulas side by side in a line are written back (Codex on #2020). This file imports nothing, so a test can
// hold it to the page's reader without loading the editor.

/** A formula in a line as mdast-util-math 3.0.0 gives it to the writer. */
export type InlineFormula = { readonly type: "inlineMath"; readonly value: string };

/**
 * A formula's Markdown among its siblings in a line. mdast-util-math 3.0.0 writes each formula alone (lib/index.js
 * inlineMath), so two side by side came out as "$x$$y$", and micromark-extension-math 3.1.0 closes a formula only on a
 * run of dollars as long as the one that opened it (dev/lib/math-text.js), so the page read one formula "x$$y" and
 * showed its source. Dollars cannot divide two formulas with nothing between them, so a run of them is written as one
 * formula, their TeX joined by a space (which TeX ignores in math, and which keeps "\alpha" from running into a
 * letter), between double dollars, which the page always reads as math (math-syntax.ts isInlineMath). The first of
 * the run writes it; the others write nothing.
 */
export function writeFormulaRun(
  node: InlineFormula,
  siblings: readonly { readonly type: string }[],
  write: (formula: InlineFormula) => string,
): string {
  const at = siblings.indexOf(node);
  if (siblings[at - 1]?.type === "inlineMath") return "";
  let last = at;
  while (siblings[last + 1]?.type === "inlineMath") last += 1;
  if (last === at) return write(node);
  const run = siblings.slice(at, last + 1).map((formula) => ("value" in formula ? String(formula.value) : ""));
  const written = write({ type: "inlineMath", value: run.join(" ") });
  return written.startsWith("$$") ? written : `$${written}$`;
}
