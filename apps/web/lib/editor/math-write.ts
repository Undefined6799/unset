// How formulas in a line are written back (Codex on #2020). This file imports only the page's limit, from a file that
// imports nothing, so the editor's first load carries no KaTeX and a test can hold it to the page's reader.
import { MAX_TEX_CHARS } from "../profile/math-syntax.ts";

/** A formula in a line as mdast-util-math 3.0.0 gives it to the writer. */
export type InlineFormula = { readonly type: "inlineMath"; readonly value: string };

/**
 * A formula's Markdown among its siblings in a line. mdast-util-math 3.0.0 writes each formula alone (lib/index.js
 * inlineMath), so two side by side came out as "$x$$y$", and micromark-extension-math 3.1.0 closes a formula only on a
 * run of dollars as long as the one that opened it (dev/lib/math-text.js), so the page read one formula "x$$y" and
 * showed its source. Dollars cannot divide two formulas with nothing between them, so a run of them is written as one
 * formula, each formula's TeX in its own group, so "\alpha" does not run into a letter and "x^2" and "^3" do not
 * become a double superscript (KaTeX 0.16.47 src/Parser.ts), by the writer asked for at least two dollars, which the
 * page always reads as math (math-syntax.ts isInlineMath). The page draws no formula longer than MAX_TEX_CHARS
 * (profile/math.ts drawMath), so a run that would pass it is cut there, a space between the parts. `tex` is the TeX
 * each formula is written as (its pipes in a table cell), so the cut counts what is written. The first of the run
 * writes it; the others write nothing.
 */
export function writeFormulaRun(
  node: InlineFormula,
  siblings: readonly { readonly type: string }[],
  write: (formula: InlineFormula, wide: boolean) => string,
  tex: (value: string) => string = (value) => value,
): string {
  const at = siblings.indexOf(node);
  if (siblings[at - 1]?.type === "inlineMath") return "";
  let last = at;
  while (siblings[last + 1]?.type === "inlineMath") last += 1;
  const run = siblings.slice(at, last + 1).map((formula) => tex("value" in formula ? String(formula.value) : ""));
  if (run.length === 1) return write(formulaOf(run[0] ?? ""), false);
  // Each part is written wide: the writer is told what follows the whole run, not what follows a part.
  return withinLimit(run)
    .map((part) => write(formulaOf(part.length === 1 ? (part[0] ?? "") : joined(part)), true))
    .join(" ");
}

const formulaOf = (value: string): InlineFormula => ({ type: "inlineMath", value });

/** The run's formulas in parts, each joined within MAX_TEX_CHARS; a formula longer than that stays alone. */
function withinLimit(run: readonly string[]): string[][] {
  const parts: string[][] = [];
  for (const value of run) {
    const part = parts.at(-1);
    if (part !== undefined && joined([...part, value]).length <= MAX_TEX_CHARS) part.push(value);
    else parts.push([value]);
  }
  return parts;
}

/** Formulas side by side as one TeX: each in its own group, their comments moved to the end. */
function joined(run: readonly string[]): string {
  const comments: string[] = [];
  const keep = (comment: string) => {
    comments.push(comment);
    return "";
  };
  const groups = run.map(
    (value) => `{${value.replace(COMMENT, (found) => (found.startsWith("%") ? keep(found) : found))}}`,
  );
  return groups.join("") + comments.join("");
}

/**
 * A TeX comment, which runs from a bare `%` to the line's end and draws nothing (KaTeX 0.16.47 src/Lexer.ts), so in a
 * run it would take the group's end and the formulas after it; moved to the run's end it takes nothing. `\%` and a `%`
 * in `\verb` are no comment, so those and every backslash pair are read first, as the Lexer does.
 */
const COMMENT = /\\verb(?:\*(.).*?\1|([^*a-zA-Z]).*?\2)|\\[\s\S]|%[^\n]*/g;

/**
 * A formula's TeX with each bare pipe written as `{\char"7C}`, which KaTeX 0.16.47 draws as the same pipe in math and
 * in text (`\vert` is math only and `\textbar` text only, src/symbols.ts; the group ends the hex number). A pipe after
 * `\left`, `\right`, `\middle` or `\big` and its kin is a delimiter, which `\char` cannot be, so it is written as
 * `\vert`, with a space before a letter so the letter does not join the command. A table cell ends at a bare
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
    return pipeAsTex(found, tex[Number(at) + found.length] ?? "");
  });
}

/** A bare pipe, a delimiter pipe or a backslash pair, given the character after it. */
function pipeAsTex(found: string, after: string): string {
  if (found === "|") return '{\\char"7C}';
  if (found.length <= 2 || !found.endsWith("|")) return found;
  return `${found.slice(0, -1)}\\vert${/[A-Za-z]/.test(after) ? " " : ""}`;
}

/**
 * `\verb*` and `\verb` as KaTeX 0.16.47 reads them (src/Lexer.ts tokenRegexString: any one character as the delimiter,
 * but no letter or star after the unstarred form, then the line up to the same character), tried before the other
 * backslash pairs as the Lexer does; then a pipe as a delimiter; then a backslash and the character after it; then a
 * bare pipe.
 */
const VERB_OR_PIPE =
  /\\verb(?:\*(.)(.*?)\1|([^*a-zA-Z])(.*?)\3)|\\(?:left|right|middle|[bB]igg?[lmr]?)\s*\||\\[\s\S]|\|/g;

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
