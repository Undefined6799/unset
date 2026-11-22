// A place in a Text card's words, told the same way in the page's own drawing (readme.svelte) and in the editor, which
// draw some blocks at different sizes: so a press made before the editor opened lands in the same words once it has,
// not at the same point on the screen (staging, 2026-11-21). Imported by the card's markup in the page bundle, so this
// file imports nothing.

/**
 * How many characters of the card's words come before the place, counted through all its blocks as one (each block
 * starts another line, as a list's next item does), whether a space or the start of another line comes between them
 * and the place, and how many characters the words hold in all. Counted over all the blocks, not within one: the two
 * drawings can split the same words into blocks differently (items with a blank line between them are lists of their
 * own on the page and one list in the editor, CommonMark 0.31.2 §5.3), and the words are the same either way. The
 * editor uses the place only when its words hold as many characters in all; otherwise it falls back to the point on
 * the screen. A character is a code point, as `for...of` walks a string.
 */
export type Place = {
  readonly chars: number;
  readonly space: boolean;
  readonly total: number;
};

/**
 * A count of a block's characters, carried from one piece of its words to the next. `pending` is the white space a
 * code block keeps as written, counted once a character follows it or another line starts; `ending` is whether the
 * last of it is a line ending, which the page's code holds after its last line and the editor's does not; `line` is
 * set at the start of a line and cleared by its first character, and set before the first one, which a break may end
 * too.
 */
export type Count = { chars: number; space: boolean; pending: number; ending: boolean; line: boolean };

export const emptyCount = (): Count => ({ chars: 0, space: false, pending: 0, ending: false, line: true });

/**
 * The white space HTML collapses (ASCII white space, WHATWG Infra): a no-break space and the other Unicode spaces are
 * kept as written by both drawings, so each is a character of its own.
 */
const COLLAPSED = /[\t\n\f\r ]/;

/**
 * Counts characters as both drawings show them: a run of white space is one space, and none before the block's first
 * word (the page's headings hold the markup's line breaks around their words). In a code block (`literal`) each white
 * space character is one, as both draw it, except at the end of the code.
 */
export function countChars(text: string, count: Count, literal = false): void {
  for (const ch of text) {
    if (COLLAPSED.test(ch)) {
      if (literal) {
        count.pending += 1;
        count.ending = ch === "\n";
      } else count.space = count.chars > 0;
      continue;
    }
    count.chars += (count.space ? 2 : 1) + count.pending;
    count.space = false;
    count.pending = 0;
    count.ending = false;
    count.line = false;
  }
}

/**
 * The characters before a place the count has reached: with a code block's white space just before it, that space
 * counted out, so the place is after it rather than before.
 */
export function placeOf(count: Count): { chars: number; space: boolean } {
  if (count.pending === 0) return { chars: count.chars, space: count.space };
  return { chars: count.chars + (count.space ? 1 : 0) + count.pending, space: false };
}

/**
 * Starts another line of the block's words (a list item, a quote's paragraph, a table cell, the line after a hard
 * line break): counted as one space, as the editor counts the start of each of its text blocks, since the page draws
 * `<li>one</li><li>two</li>` with nothing between the two words. White space a code block ends with is counted first,
 * all but the page's last line ending, so a place in it is told from one in the words after it.
 */
export function startLine(count: Count): void {
  const kept = count.pending - (count.ending ? 1 : 0);
  if (kept > 0) count.chars += (count.space ? 1 : 0) + kept;
  count.space = count.chars > 0;
  count.pending = 0;
  count.ending = false;
  count.line = true;
}

/**
 * A hard line break (the page's <br>, the editor's hard break node): it starts another line, and when the line it ends
 * held nothing (two breaks in a row, or a break before the first words) that empty line counts as a character, so a
 * place on it is told from one at the start of the line after it.
 */
export function breakLine(count: Count): void {
  if (count.line) count.chars += 1;
  startLine(count);
}

/** The page's elements that hold one line of a block's words, as the editor's text blocks do. */
const LINES = "p, li, h1, h2, h3, h4, h5, h6, pre, td, th";

/** Counts the words of `block` (one block, or all of them) up to the end of `range` (to its end when there is none). */
function countIn(block: Node, range?: Range): Count {
  const count = emptyCount();
  // NodeFilter.SHOW_ELEMENT | SHOW_TEXT: the text, and the <br> of a hard line break.
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let line: Element | null | undefined;
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (range !== undefined && !range.intersectsNode(node)) break;
    if (node.nodeName === "BR") breakLine(count);
    if (!(node instanceof Text)) continue;
    const owner = node.parentElement?.closest(LINES) ?? null;
    if (owner !== line) {
      if (line !== undefined) startLine(count);
      line = owner;
    }
    countChars(textBefore(node, range), count, owner?.nodeName === "PRE");
  }
  return count;
}

/** The part of `text` before the end of `range`: all of it unless the range ends inside it. */
const textBefore = (text: Text, range?: Range) =>
  range?.endContainer === text ? text.data.slice(0, range.endOffset) : text.data;

/** The place of (node, offset) in the page's drawing held by `root`, or undefined when it is not in its words. */
export function placeIn(root: HTMLElement, node: Node, offset: number): Place | undefined {
  const blocks = root.firstElementChild;
  if (blocks === null || !blocks.contains(node) || node === blocks) return undefined;
  // A line with no words (an empty code block, list item or table cell) is no place in them: one in it would be the
  // same as one before the words after it, so the point on the screen is used instead.
  const line = (node instanceof Element ? node : node.parentElement)?.closest(LINES);
  if (line != null && blocks.contains(line) && countIn(line).chars === 0) return undefined;
  const before = document.createRange();
  before.setStart(blocks, 0);
  before.setEnd(node, offset);
  return { ...placeOf(countIn(blocks, before)), total: countIn(blocks).chars };
}
