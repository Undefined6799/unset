// The owner's unsaved cards (ADR 0074 item 4): what the member changed on each card on the page (its own form fields,
// such as a Text card's words, and the Width and Style chosen in its menu) with the version its editor opened, until
// one Save writes them. A card put back to what is stored is no longer unsaved, so the bar counts only real changes.
// Kept as plain values (a new map per change) so the page's state and its tests read alike.
import type { CardEdit } from "./save-all.ts";
import type { CardView } from "./types.ts";

export type Unsaved = Omit<CardEdit, "key">;
export type UnsavedCards = ReadonlyMap<string, Unsaved>;
/** What the member changed on a card: some of its own fields, or its Width or Style. */
export type CardChange = Partial<Pick<Unsaved, "width" | "surface">> & {
  readonly fields?: Readonly<Record<string, string>>;
};

export const NO_EDITS: UnsavedCards = new Map();

/**
 * A card's own fields as stored, by the names its form posts, for each kind edited on the page; null for a kind that
 * is edited only in its own form. A new kind edited on the page adds its line here.
 */
function storedFields(card: CardView): Readonly<Record<string, string>> | null {
  return card.content.kind === "readme" ? { text: card.content.text } : null;
}

const sameFields = (a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>) =>
  Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([name, value]) => b[name] === value);

/**
 * The edits with `change` made to card `key`. A card of a kind not edited on the page, one that came with no version,
 * and a field its kind does not have are left out.
 */
export function edit(edits: UnsavedCards, cards: readonly CardView[], key: string, change: CardChange): UnsavedCards {
  const card = cards.find((c) => c.key === key);
  const fields = card === undefined ? null : storedFields(card);
  if (card?.version === undefined || fields === null) return edits;
  const before = edits.get(key);
  const known = Object.entries(change.fields ?? {}).filter(([name]) => name in fields);
  const now: Unsaved = {
    version: before?.version ?? card.version,
    kind: card.content.kind,
    width: change.width ?? before?.width ?? card.width,
    surface: change.surface ?? before?.surface ?? card.surface,
    fields: { ...fields, ...before?.fields, ...Object.fromEntries(known) },
  };
  const next = new Map(edits);
  if (sameFields(now.fields, fields) && now.width === card.width && now.surface === card.surface) next.delete(key);
  else next.set(key, now);
  return next;
}

/** What Save posts: each edited card still on the page, in page order. */
export function editsToSave(edits: UnsavedCards, cards: readonly CardView[]): CardEdit[] {
  return cards.flatMap((card) => {
    const unsaved = edits.get(card.key);
    return unsaved === undefined ? [] : [{ key: card.key, ...unsaved }];
  });
}

/**
 * What is left unsaved once a Save wrote the cards `written`, read against the cards as now stored. The page stays
 * editable while a Save is on its way, so a written card may hold newer words than were sent: it stays unsaved, now
 * on the version just written, so the next Save sends it without a conflict. One that holds what is now stored is
 * saved. A card the Save did not write keeps its edit as it was.
 */
export function afterSave(edits: UnsavedCards, written: readonly string[], stored: readonly CardView[]): UnsavedCards {
  const next = new Map(edits);
  for (const key of written) {
    const unsaved = edits.get(key);
    const card = stored.find((c) => c.key === key);
    const fields = card === undefined ? null : storedFields(card);
    next.delete(key);
    if (unsaved === undefined || card?.version === undefined || fields === null) continue;
    const same = sameFields(unsaved.fields, fields) && unsaved.width === card.width && unsaved.surface === card.surface;
    if (!same) next.set(key, { ...unsaved, version: card.version });
  }
  return next;
}
