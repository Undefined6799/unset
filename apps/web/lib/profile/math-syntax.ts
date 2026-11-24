// Where math between dollars is read as math, shared by the page (parse.ts) and the editor (lib/editor/math.ts), so
// both read a card alike. This file imports nothing: the editor's first load must not carry KaTeX.

/** A formula's TeX past this many characters is shown as its source (math.ts drawMath; the editor's writer, too). */
export const MAX_TEX_CHARS = 2_000;

/**
 * Whether math written as `raw` (its dollars included), followed in the text by `after`, is math: between two or more
 * dollars always; between single dollars only by Pandoc's rule, as Milkdown's Crepe 7.23.0 holds its editor to it
 * (src/feature/latex/remark.ts, remarkInlineMathGuardPlugin): the opening dollar is followed by a non-space, the
 * closing one follows a non-space and is not followed by a digit, so "$5 and $10" stays words.
 */
export function isInlineMath(raw: string, after: string): boolean {
  if (raw.startsWith("$$")) return true;
  return !/^\$\s/.test(raw) && !/\s\$$/.test(raw) && !/\d/.test(after);
}

/**
 * The text between a refused span's dollars as it was written: micromark-extension-math 3.1.0 drops one space or line
 * ending at each end when both ends have one and there is more (math-text.js resolveMathText), and keeps a line's
 * container marks (a quote's ">") out of the value, so the value with what was dropped put back is that text.
 */
export function between(raw: string, value: string): string {
  const first = raw[1] ?? "";
  const last = raw[raw.length - 2] ?? "";
  const padded = /^[ \n]$/.test(first) && /^[ \n]$/.test(last) && /[^ \n]/.test(value);
  return padded ? `${first}${value}${last}` : value;
}
