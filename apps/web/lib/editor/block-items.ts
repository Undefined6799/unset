// The block menu's items in their groups, as Crepe 7.23.0 lists them (src/feature/block-edit/menu/config.ts), less
// Image and Math, which the page cannot show yet. Imported by the editor (menus.ts) and by the menu's markup
// (text-menus.svelte), which the page bundle holds, so this file imports nothing.

/** Each group's items, in order; the menu's tabs are the groups. */
export const BLOCK_GROUPS = {
  text: ["text", "heading1", "heading2", "heading3", "heading4", "heading5", "heading6", "quote", "divider"],
  list: ["bullets", "numbers", "tasks"],
  advanced: ["codeBlock", "table"],
} as const;

export type BlockGroup = keyof typeof BLOCK_GROUPS;
export type BlockItem = (typeof BLOCK_GROUPS)[BlockGroup][number];

export const BLOCK_ITEMS: readonly BlockItem[] = Object.values(BLOCK_GROUPS).flat();

export function groupOf(item: BlockItem): BlockGroup {
  return (Object.keys(BLOCK_GROUPS) as BlockGroup[]).find((group) =>
    (BLOCK_GROUPS[group] as readonly BlockItem[]).includes(item),
  ) as BlockGroup;
}

/**
 * Where Arrow Right (1) or Arrow Left (-1) takes the active item in the shown `items`: to the next group's first item,
 * or to the previous group's last; it stays at either end (Crepe's menu component.tsx onKeydown).
 */
export function acrossGroups(items: readonly BlockItem[], index: number, dir: -1 | 1): number {
  const active = items[index];
  if (active === undefined) return index;
  const group = groupOf(active);
  if (dir === 1) {
    const next = items.findIndex((item, at) => at > index && groupOf(item) !== group);
    return next === -1 ? index : next;
  }
  const first = items.findIndex((item) => groupOf(item) === group);
  return first > 0 ? first - 1 : index;
}
