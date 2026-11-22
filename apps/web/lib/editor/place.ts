// A place in a Text card's words, told the same way in the page's own drawing (readme.svelte) and in the editor, which
// draw some blocks at different sizes: so a press made before the editor opened lands in the same words once it has,
// not at the same point on the screen (staging, 2026-11-21). Imported by the card's markup in the page bundle, so this
// file imports nothing.

/**
 * The block (its index among the top-level blocks), how many characters of its words come before the place, whether a
 * space or the start of another line of the block (a list's next item, a table's next cell) comes between them and the
 * place, and how many characters the block holds in all: the editor uses the place only when its block holds as many,
 * so a block the two drawings show differently falls back to the point on the screen. A character is a code point, as
 * `for...of` walks a string.
 */
export type Place = {
  readonly block: number;
  readonly chars: number;
  readonly space: boolean;
  readonly total: number;
};

/** A count of a block's characters, carried from one piece of its words to the next. */
export type Count = { chars: number; space: boolean };

/**
 * Counts characters as both drawings show them: a run of white space is one space, and none before the block's first
 * word (the page's headings hold the markup's line breaks around their words).
 */
export function countChars(text: string, count: Count): void {
  for (const ch of text) {
    if (/\s/.test(ch)) {
      count.space = count.chars > 0;
      continue;
    }
    count.chars += count.space ? 2 : 1;
    count.space = false;
  }
}

/**
 * Starts another line of the block's words (a list item, a quote's paragraph, a table cell): counted as one space, as
 * the editor counts the start of each of its text blocks, since the page draws `<li>one</li><li>two</li>` with nothing
 * between the two words.
 */
export function startLine(count: Count): void {
  count.space = count.chars > 0;
}

/** The page's elements that hold one line of a block's words, as the editor's text blocks do. */
const LINES = "p, li, h1, h2, h3, h4, h5, h6, pre, td, th";

/** Counts the words of `block` up to the end of `range` (to its end when there is none). */
function countIn(block: Node, range?: Range): Count {
  const count = { chars: 0, space: false };
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let line: Element | null | undefined;
  for (let text = walker.nextNode(); text !== null; text = walker.nextNode()) {
    if (range !== undefined && !range.intersectsNode(text)) break;
    const owner = text.parentElement?.closest(LINES) ?? null;
    if (owner !== line) {
      if (line !== undefined) startLine(count);
      line = owner;
    }
    const data = (text as Text).data;
    countChars(range?.endContainer === text ? data.slice(0, range.endOffset) : data, count);
  }
  return count;
}

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
  return { block: index, chars: count.chars, space: count.space, total: countIn(block).chars };
}
