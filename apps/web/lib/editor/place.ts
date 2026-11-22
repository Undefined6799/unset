// A place in a Text card's words, told the same way in the page's own drawing (readme.svelte) and in the editor, which
// draw some blocks at different sizes: so a press made before the editor opened lands in the same words once it has,
// not at the same point on the screen (staging, 2026-11-21). Imported by the card's markup in the page bundle, so this
// file imports nothing.

/** The block (its index among the top-level blocks) and how many characters of its words come before the place. */
export type Place = { readonly block: number; readonly chars: number };

/**
 * Counts characters as both drawings show them: a run of white space is one space, and none before the block's first
 * word (the page's headings hold the markup's line breaks around their words). `count` carries the state from one
 * piece of the block's words to the next.
 */
export function countChars(text: string, count: { chars: number; space: boolean }): void {
  for (const ch of text) {
    if (/\s/.test(ch)) {
      count.space = count.chars > 0;
      continue;
    }
    count.chars += count.space ? 2 : 1;
    count.space = false;
  }
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
  const count = { chars: 0, space: false };
  countChars(before.toString(), count);
  return { block: Array.prototype.indexOf.call(blocks.children, block), chars: count.chars };
}
