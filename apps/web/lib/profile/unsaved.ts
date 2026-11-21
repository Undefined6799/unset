// The owner's unsaved cards (ADR 0074 item 4): what the member changed on each card on the page (its own form fields,
// such as a Text card's words, and the Width and Style chosen in its menu) with the version its editor opened, until
// one Save writes them. A card put back to what is stored is no longer unsaved, so the bar counts only real changes.
// Kept as plain values (a new map per change) so the page's state and its tests read alike.
import type { Draft } from "./drafts.ts";
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

/** The owner's cards as the page read them, with what says the read was not whole. */
export type CardsRead = {
  readonly cards: readonly CardView[];
  readonly profileUnavailable: boolean;
  readonly cardsIncomplete: boolean;
  readonly cardsOverflow: boolean;
};

/**
 * The edits without those of cards no longer on the page (deleted from their menu); the same map when none went. Only
 * a whole read says a card is gone: one that failed (no cards at all) or stopped early drops nothing.
 */
export function onPage(edits: UnsavedCards, read: CardsRead): UnsavedCards {
  if (read.profileUnavailable || read.cardsIncomplete || read.cardsOverflow) return edits;
  const cards = read.cards;
  const gone = [...edits.keys()].filter((key) => !cards.some((card) => card.key === key));
  if (gone.length === 0) return edits;
  const next = new Map(edits);
  for (const key of gone) next.delete(key);
  return next;
}

const sameEdit = (a: Unsaved, b: Pick<Unsaved, "fields" | "width" | "surface">) =>
  sameFields(a.fields, b.fields) && a.width === b.width && a.surface === b.surface;

/**
 * What is left unsaved once a Save wrote the cards `written` (as they were sent), read against the cards as now
 * `stored` and as they were `before` it. The page stays editable while a Save is on its way:
 * - a card that still holds what was sent is saved, even where the server tidied the words (trimmed, CRLF to LF);
 * - one that holds newer words stays unsaved, on the version just written so the next Save sends it without a
 *   conflict, unless those words are what is now stored;
 * - one put back to what was stored before has no edit left, yet differs from what was just written, so its earlier
 *   state comes back as an edit on the new version;
 * - one the refresh could not read (a failed or partial read) confirms nothing: newer words stay on their version;
 * - an edit that began on another version than was sent (a draft brought back meanwhile) keeps its own.
 * A card the Save did not write keeps its edit as it was.
 */
export function afterSave(
  edits: UnsavedCards,
  written: readonly CardEdit[],
  stored: readonly CardView[],
  before: readonly CardView[],
): UnsavedCards {
  const next = new Map(edits);
  for (const sent of written) {
    const card = stored.find((c) => c.key === sent.key);
    const fields = card === undefined ? null : storedFields(card);
    const unsaved = edits.get(sent.key) ?? putBack(before, sent);
    next.delete(sent.key);
    if (unsaved === undefined || sameEdit(unsaved, sent)) continue;
    // An edit that began on another version than was sent (a draft brought back meanwhile) keeps it.
    if (card?.version === undefined || fields === null || unsaved.version !== sent.version) next.set(sent.key, unsaved);
    else if (!sameEdit(unsaved, { fields, width: card.width, surface: card.surface }))
      next.set(sent.key, { ...unsaved, version: card.version });
  }
  return next;
}

/** A written card with no edit left was put back to what was stored before the Save: that state, as an edit. */
function putBack(before: readonly CardView[], sent: CardEdit): Unsaved | undefined {
  const card = before.find((c) => c.key === sent.key);
  const fields = card === undefined ? null : storedFields(card);
  if (card === undefined || fields === null) return undefined;
  return { version: sent.version, kind: sent.kind, width: card.width, surface: card.surface, fields };
}

/**
 * The drafts offered from an earlier visit once a Save wrote `written`: a card written from the version its draft began
 * on (only its Width or Style changed, as typing retires the offer) moves the draft to the version now `stored`, so
 * bringing it back and saving is no conflict. A draft that began on another version keeps it, so Save names the change
 * made elsewhere. The same map when none moved.
 */
export function offeredAfterSave(
  offered: ReadonlyMap<string, Draft>,
  written: readonly CardEdit[],
  stored: readonly CardView[],
): ReadonlyMap<string, Draft> {
  let next: Map<string, Draft> | undefined;
  for (const sent of written) {
    const draft = offered.get(sent.key);
    const version = stored.find((c) => c.key === sent.key)?.version;
    if (draft === undefined || draft.version !== sent.version || version === undefined) continue;
    next ??= new Map(offered);
    next.set(sent.key, { ...draft, version });
  }
  return next ?? offered;
}
