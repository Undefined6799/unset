// A place in a Text card's words, told the same way in the page's own drawing (readme.svelte) and in the editor, which
// draw some blocks at different sizes: so a press made before the editor opened lands in the same words once it has,
// not at the same point on the screen (staging, 2026-11-21). Imported by the card's markup in the page bundle, so this
// file imports nothing.

/**
 * The block (its index among the top-level blocks), how many characters of its words come before the place, whether a
 * space or the start of another line of the block (a list's next item, a table's next cell) comes between them and the
 * place, and how many characters each top-level block holds in all: the editor uses the place only when its blocks
 * are as many and each holds as many, so words the two drawings split into blocks differently (items with a blank line
 * between them are two lists on the page and one in the editor, CommonMark 0.31.2 §5.3) fall back to the point on the
 * screen. A character is a code point, as `for...of` walks a string.
 */
export type Place = {
  readonly block: number;
  readonly chars: number;
  readonly space: boolean;
  readonly blocks: readonly number[];
};

/**
 * A count of a block's characters, carried from one piece of its words to the next. `pending` is the white space a
 * code block keeps as written, counted once a character follows it.
 */
export type Count = { chars: number; space: boolean; pending: number };

export const emptyCount = (): Count => ({ chars: 0, space: false, pending: 0 });

/**
 * Counts characters as both drawings show them: a run of white space is one space, and none before the block's first
 * word (the page's headings hold the markup's line breaks around their words). In a code block (`literal`) each white
 * space character is one, as both draw it, except at the end of the code.
 */
export function countChars(text: string, count: Count, literal = false): void {
  for (const ch of text) {
    if (/\s/.test(ch)) {
      if (literal) count.pending += 1;
      else count.space = count.chars > 0;
      continue;
    }
    count.chars += (count.space ? 2 : 1) + count.pending;
    count.space = false;
    count.pending = 0;
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
 * `<li>one</li><li>two</li>` with nothing between the two words.
 */
export function startLine(count: Count): void {
  count.space = count.chars > 0;
  count.pending = 0;
}

/** The page's elements that hold one line of a block's words, as the editor's text blocks do. */
const LINES = "p, li, h1, h2, h3, h4, h5, h6, pre, td, th";

/** Counts the words of `block` up to the end of `range` (to its end when there is none). */
function countIn(block: Node, range?: Range): Count {
  const count = emptyCount();
  // NodeFilter.SHOW_ELEMENT | SHOW_TEXT: the text, and the <br> of a hard line break.
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let line: Element | null | undefined;
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (range !== undefined && !range.intersectsNode(node)) break;
    if (node.nodeName === "BR") startLine(count);
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
  let block: Node = node;
  while (block.parentNode !== blocks) {
    if (block.parentNode === null) return undefined;
    block = block.parentNode;
  }
  const before = document.createRange();
  before.setStart(block, 0);
  before.setEnd(node, offset);
  const count = countIn(block, before);
  const index = Array.prototype.indexOf.call(blocks.children, block);
  const blocksChars = Array.from(blocks.children, (each) => countIn(each).chars);
  return { block: index, ...placeOf(count), blocks: blocksChars };
}
