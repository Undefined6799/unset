// Forward-only searches for the README parser (readme.tsx). parseInline reads its text left to right, so each search
// remembers where it last looked and what it found: every opener that fails costs no new scan, and no member-written
// text can make a parse quadratic. readme.test.tsx sweeps repeated tokens at the lexicon's 100,000 characters.

export const isWord = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

/** The length of the run of `ch` starting at `i`. */
export function runLength(text: string, i: number, ch: string): number {
  let j = i;
  while (text[j] === ch) j += 1;
  return j - i;
}

/**
 * Where the next run of exactly `length` backticks starts, at or after a position; -1 when none does. Remembered per
 * length, as parseInline only moves forward, so a run that never closes is searched for once, not once per opener.
 */
export function codeCloser(text: string): (length: number, from: number) => number {
  const memo = new Map<number, { searched: number; found: number }>();
  return (length, from) => {
    const seen = memo.get(length);
    if (seen !== undefined && from >= seen.searched && (seen.found === -1 || seen.found >= from)) return seen.found;
    const ticks = "`".repeat(length);
    let found = text.indexOf(ticks, from);
    while (found !== -1) {
      const run = runLength(text, found, "`");
      if (run === length && text[found - 1] !== "`") break;
      found = text.indexOf(ticks, found + run);
    }
    memo.set(length, { searched: from, found });
    return found;
  };
}

/** The longest link destination scanned: the lexicon's 2,000-byte address limit. */
export const MAX_DESTINATION = 2_000;

/**
 * Where a link destination ends: the ")" that balances its parentheses, a backslash escaping the next character
 * (CommonMark 0.31.2, "Links"). -1 when none does within MAX_DESTINATION characters, or before whitespace, which a
 * destination may not hold, or a bracket, which this subset does not link. A scan therefore never crosses the next
 * label, so all the scans together read each character at most once, however many links never close.
 */
export function destinationEnd(text: string, from: number): number {
  let open = 0;
  const limit = Math.min(text.length, from + MAX_DESTINATION);
  for (let j = from; j < limit; j += 1) {
    const ch = text[j] ?? "";
    if (ch === "[" || ch === "]" || /\s/.test(ch)) return -1;
    if (ch === "\\") j += 1;
    else if (ch === "(") open += 1;
    else if (ch === ")") {
      if (open === 0) return j;
      open -= 1;
    }
  }
  return -1;
}

/**
 * The next index of `needle` at or after a position, remembered: parseInline only moves forward, so the text is
 * searched once per needle rather than once per opener (an unclosed "[" repeated would otherwise be quadratic).
 */
export function nextIndex(text: string, needle: string): (from: number) => number {
  let searched = Number.POSITIVE_INFINITY;
  let found = -1;
  return (from) => {
    const stale = from < searched || (found !== -1 && found < from);
    if (stale) {
      searched = from;
      found = text.indexOf(needle, from);
    }
    return found;
  };
}

export type Mark = "*" | "_" | "**" | "__";

/**
 * Whether `mark` at `j` can close emphasis, judged from the text alone: a single mark that is not part of a longer
 * run, and an underscore mark with no letter or digit after it.
 */
export function closes(text: string, j: number, mark: Mark): boolean {
  if (!text.startsWith(mark, j)) return false;
  const ch = mark[0];
  if (mark.length === 1 && (text[j + 1] === ch || text[j - 1] === ch)) return false;
  return ch !== "_" || !isWord(text[j + mark.length]);
}

/**
 * The next closer for each mark at or after a position, remembered per mark: parseInline only moves forward and a
 * closer does not depend on its opener, so each mark's candidates are read once per text, however many openers fail.
 */
export function emphasisCloser(text: string): (mark: Mark, from: number) => number {
  const memo = new Map<Mark, { searched: number; found: number }>();
  return (mark, from) => {
    const seen = memo.get(mark);
    if (seen !== undefined && from >= seen.searched && (seen.found === -1 || seen.found >= from)) return seen.found;
    let found = text.indexOf(mark, from);
    while (found !== -1 && !closes(text, found, mark)) found = text.indexOf(mark, found + 1);
    memo.set(mark, { searched: from, found });
    return found;
  };
}
