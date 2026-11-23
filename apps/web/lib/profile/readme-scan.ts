// Forward-only searches for the README parser (parse.ts). parseInline reads its text left to right, so each search
// remembers where it last looked and what it found: every opener that fails costs no new scan, and no member-written
// text can make a parse quadratic. readme.test.tsx sweeps repeated tokens at the lexicon's 100,000 characters.

export const isWord = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

/**
 * A link destination with its backslash escapes removed: "\\(" is "(" (CommonMark 0.31.2, "Backslash escapes": any
 * ASCII punctuation), so an escaped parenthesis reaches safeHref as itself, not as a path separator.
 */
/** ASCII punctuation: what a backslash escapes (CommonMark 0.31.2, "Backslash escapes"). */
export const isEscapable = (ch: string | undefined) => ch !== undefined && /^[!-/:-@[-`{-~]$/.test(ch);

/** Whether the character at `j` follows an odd run of backslashes, so it is text (CommonMark 0.31.2). */
export function isEscaped(text: string, j: number): boolean {
  let run = 0;
  while (text[j - 1 - run] === "\\") run += 1;
  return run % 2 === 1;
}

export const unescapeDestination = (destination: string) => destination.replace(/\\([!-/:-@[-`{-~])/g, "$1");

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
 * destination may not hold, or a bracket, which this subset does not link.
 * Remembered like the other finders: a destination starting inside one already scanned follows a "](" whose "]"
 * that scan read as escaped, so it closes no label (CommonMark 0.31.2, "Backslash escapes"), and no character is read
 * twice however many labels never link.
 */
export function destinationFinder(text: string): (from: number) => number {
  let scanned = 0;
  return (from) => {
    if (from < scanned) return -1;
    const [end, stop] = scanDestination(text, from);
    scanned = stop;
    return end;
  };
}

/** Where a destination ends, and where its scan stopped: the ")" it found, or the character or limit that ended the search. */
function scanDestination(text: string, from: number): readonly [end: number, stop: number] {
  let open = 0;
  const limit = Math.min(text.length, from + MAX_DESTINATION);
  for (let j = from; j < limit; j += 1) {
    const ch = text[j] ?? "";
    if (ch === "[" || ch === "]" || /\s/.test(ch)) return [-1, j];
    if (ch === "\\") j += 1;
    else if (ch === "(") open += 1;
    else if (ch === ")") {
      if (open === 0) return [j, j];
      open -= 1;
    }
  }
  return [-1, limit];
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

/**
 * As nextIndex, but a match whose first character is backslash-escaped is text and is skipped. Remembered the same
 * way: a later `from` up to the match found reuses it, so each escaped match is passed over once per text.
 */
export function nextUnescaped(text: string, needle: string): (from: number) => number {
  let searched = Number.POSITIVE_INFINITY;
  let found = -1;
  return (from) => {
    const stale = from < searched || (found !== -1 && found < from);
    if (stale) {
      searched = from;
      found = text.indexOf(needle, from);
      while (found !== -1 && isEscaped(text, found)) found = text.indexOf(needle, found + 1);
    }
    return found;
  };
}

export type Mark = "*" | "_" | "**" | "__" | "~~";

/**
 * Whether `mark` at `j` can close emphasis, judged from the text alone: a single mark that is not part of a longer
 * run, and an underscore mark with no letter or digit after it.
 */
export function closes(text: string, j: number, mark: Mark): boolean {
  if (!text.startsWith(mark, j) || isEscaped(text, j)) return false;
  const ch = mark[0];
  // An escaped mark before it is text, not part of its run (CommonMark 0.31.2, "Backslash escapes").
  const runBefore = text[j - 1] === ch && !isEscaped(text, j - 1);
  if (mark.length === 1 && (text[j + 1] === ch || runBefore)) return false;
  // Strikethrough closes only with a run of exactly two tildes (GFM 0.29, "Strikethrough (extension)", example 493).
  if (mark === "~~" && (text[j + 2] === "~" || runBefore)) return false;
  return ch !== "_" || !isWord(text[j + mark.length]);
}

/**
 * The spans an emphasis mark inside cannot close, as sorted [start, end) pairs: code spans, paired left to right as
 * parseInline pairs them (CommonMark 0.31.2: code spans bind more tightly than emphasis), link destinations and
 * autolinks, so "*[a](https://x/a*b) here*" keeps its link.
 */
export function codeSpans(text: string): readonly (readonly [number, number])[] {
  const closer = codeCloser(text);
  const code: [number, number][] = [];
  for (let i = text.indexOf("`"); i !== -1; ) {
    // An escaped backtick is text and opens nothing; the rest of its run may still open a span (CommonMark 0.31.2).
    if (isEscaped(text, i)) {
      i = text.indexOf("`", i + 1);
      continue;
    }
    const length = runLength(text, i, "`");
    const end = closer(length, i + length);
    if (end !== -1) code.push([i, end + length]);
    i = text.indexOf("`", end === -1 ? i + length : end + length);
  }
  const autolink = /<https?:\/\/[^\s<>]+>/gi;
  const links: [number, number][] = [];
  for (let m = autolink.exec(text); m !== null; m = autolink.exec(text)) links.push([m.index, m.index + m[0].length]);
  return mergeSpans([...code, ...destinations(text, code), ...links]);
}

/**
 * The destinations of "](" that can close a label: outside code, after an open label. Each scan starts where the last
 * one stopped: a "](" an earlier scan read past had its "]" escaped, so it closes no label, and no character is read
 * twice however many destinations fail.
 */
function destinations(text: string, code: readonly (readonly [number, number])[]): [number, number][] {
  const spans: [number, number][] = [];
  const labelOpenAt = openLabels(text, code);
  let scanned = 0;
  for (let i = text.indexOf("]("); i !== -1; i = text.indexOf("](", i + 2)) {
    if (i < scanned || !labelOpenAt(i) || spanEnd(code, i) !== -1) continue;
    const [end, stop] = scanDestination(text, i + 2);
    scanned = stop;
    if (end !== -1) spans.push([i + 2, end]);
  }
  return spans;
}

/**
 * Whether a label is open at a rising position: a "[" with no "]" after it, brackets inside code not counting, so
 * "[a `]` b](x)" is still one label. The text is walked once, however many positions are asked about.
 */
function openLabels(text: string, code: readonly (readonly [number, number])[]): (at: number) => boolean {
  let walked = 0;
  let lastOpen = -1;
  let lastClose = -1;
  return (at) => {
    for (; walked < at; walked += 1) {
      const inCode = spanEnd(code, walked);
      if (inCode !== -1) walked = inCode - 1;
      // An escaped bracket is text and neither opens nor closes a label (CommonMark 0.31.2, "Backslash escapes").
      else if ((text[walked] === "[" || text[walked] === "]") && isEscaped(text, walked)) continue;
      else if (text[walked] === "[") lastOpen = walked;
      else if (text[walked] === "]") lastClose = walked;
    }
    return lastOpen > lastClose;
  };
}

/** Sorted, with overlapping spans joined, so a binary search finds the one holding a position. */
function mergeSpans(spans: [number, number][]): readonly (readonly [number, number])[] {
  const merged: [number, number][] = [];
  for (const [start, end] of spans.sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last !== undefined && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/** The end of the code span holding `j`, or -1 when `j` is outside every span. */
function spanEnd(spans: readonly (readonly [number, number])[], j: number): number {
  let low = 0;
  let high = spans.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const [start, end] = spans[mid] ?? [0, 0];
    if (j < start) high = mid - 1;
    else if (j >= end) low = mid + 1;
    else return end;
  }
  return -1;
}

/**
 * The next closer for each mark at or after a position, remembered per mark: parseInline only moves forward and a
 * closer does not depend on its opener, so each mark's candidates are read once per text, however many openers fail.
 * A mark inside a code span is skipped with the span.
 */
export function emphasisCloser(text: string): (mark: Mark, from: number) => number {
  const memo = new Map<Mark, { searched: number; found: number }>();
  let spans: readonly (readonly [number, number])[] | undefined;
  return (mark, from) => {
    const seen = memo.get(mark);
    if (seen !== undefined && from >= seen.searched && (seen.found === -1 || seen.found >= from)) return seen.found;
    spans ??= codeSpans(text);
    let found = text.indexOf(mark, from);
    while (found !== -1) {
      const inCode = spanEnd(spans, found);
      if (inCode === -1 && closes(text, found, mark)) break;
      found = text.indexOf(mark, inCode === -1 ? found + 1 : inCode);
    }
    memo.set(mark, { searched: from, found });
    return found;
  };
}
