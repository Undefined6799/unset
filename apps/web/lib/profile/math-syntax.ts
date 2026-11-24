// Where math between dollars is read as math, shared by the page (parse.ts) and the editor (lib/editor/math.ts), so
// both read a card alike. This file imports nothing: the editor's first load must not carry KaTeX.

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
