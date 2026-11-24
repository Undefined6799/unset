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
 * `\verb` shows what it holds as written, so a pipe there is written as a typewriter `\textbar` between two `\verb`s,
 * and a `\verb` delimited by pipes gets another delimiter (verbAsTex).
 */
export function pipesAsTex(tex: string): string {
  return tex.replace(VERB_OR_PIPE, (found: string, ...groups: (string | number | undefined)[]) => {
    const [starred, starredBody, plain, plainBody, at] = groups;
    const delimiter = starred ?? plain;
    const body = starredBody ?? plainBody;
    if (typeof delimiter === "string" && typeof body === "string") {
      return verbAsTex(starred === undefined ? "" : "*", delimiter, body, found);
    }
    if (found !== "|") return found;
    return /[A-Za-z]/.test(tex[Number(at) + 1] ?? "") ? "\\vert " : "\\vert";
  });
}

/**
 * `\verb*` and `\verb` as KaTeX 0.16.47 reads them (src/Lexer.ts tokenRegexString: any one character as the delimiter,
 * but no letter or star after the unstarred form, then the line up to the same character), tried before the other
 * backslash pairs as the Lexer does; then a backslash and the character after it; then a bare pipe.
 */
const VERB_OR_PIPE = /\\verb(?:\*(.)(.*?)\1|([^*a-zA-Z])(.*?)\3)|\\[\s\S]|\|/g;

/**
 * One `\verb`'s Markdown in a table cell, showing what it held: its pipes become a typewriter `\textbar` between `\verb`s,
 * and a pipe delimiter becomes one the piece does not hold. Any character but a letter or a star delimits, and a piece
 * is shorter than the run from U+00A1 to the surrogates, so one is always free.
 */
function verbAsTex(star: string, delimiter: string, body: string, found: string): string {
  if (delimiter !== "|" && !body.includes("|")) return found;
  const pieces = body.split("|").map((piece) => {
    if (piece === "") return "";
    return `\\verb${star}${delimiter === "|" ? delimited(piece) : `${delimiter}${piece}${delimiter}`}`;
  });
  return pieces.join("\\texttt{\\textbar}");
}

function delimited(piece: string): string {
  let code = 0xa1;
  const candidates = [..."!+=/;:@~^,.?'\"#&-_"];
  let free = candidates.find((char) => !piece.includes(char));
  while (free === undefined) {
    const char = String.fromCharCode(code++);
    if (!piece.includes(char)) free = char;
  }
  return `${free}${piece}${free}`;
}
