// The owner's unsaved Text cards (ADR 0074 item 4): the words typed into each card on the page and the version its
// editor opened, with the Width and Style chosen in its menu, until one Save writes them. A card put back to what is
// stored is no longer unsaved, so the bar counts only real changes. Kept as plain values (a new map per change) so the page's state and its tests read alike.
import type { TextEdit } from "./save-all.ts";
import type { CardSurface, CardView, CardWidth } from "./types.ts";

export type Unsaved = {
  readonly version: string;
  readonly text: string;
  readonly width: CardWidth;
  readonly surface: CardSurface;
};
/** What the member changed on a card: its words, or the Width or Style chosen in its menu. */
export type CardChange = Partial<Pick<Unsaved, "text" | "width" | "surface">>;
export type UnsavedCards = ReadonlyMap<string, Unsaved>;

export const NO_EDITS: UnsavedCards = new Map();

/** The edits with `change` made to card `key`. A card that is not a Text card or came with no version is left out. */
export function edit(edits: UnsavedCards, cards: readonly CardView[], key: string, change: CardChange): UnsavedCards {
  const card = cards.find((c) => c.key === key);
  if (card?.content.kind !== "readme" || card.version === undefined) return edits;
  const stored = { version: card.version, text: card.content.text, width: card.width, surface: card.surface };
  const now = { ...stored, ...edits.get(key), ...change };
  const next = new Map(edits);
  if (now.text === stored.text && now.width === stored.width && now.surface === stored.surface) next.delete(key);
  else next.set(key, now);
  return next;
}

/** What Save posts: each edited card still on the page, in page order. */
export function editsToSave(edits: UnsavedCards, cards: readonly CardView[]): TextEdit[] {
  return cards.flatMap((card) => {
    const unsaved = edits.get(card.key);
    if (unsaved === undefined) return [];
    const { version, text, width, surface } = unsaved;
    return [{ key: card.key, version, text, width, surface }];
  });
}

/** What is left unsaved once a Save wrote the cards `saved`. */
export function settle(edits: UnsavedCards, saved: readonly string[]): UnsavedCards {
  const next = new Map(edits);
  for (const key of saved) next.delete(key);
  return next;
}
