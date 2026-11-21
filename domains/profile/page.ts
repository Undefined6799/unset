// An account's page (ADR 0091): the sh.unset.page record that lists which of its cards show, and in what order, by
// their at:// addresses. The main page is the record under the key `self`; other keys wait for a later decision on
// where they show. Every stored entry and field this version does not know is kept as it was (ADR 0038).
import { LIMITS, validateRecord } from "@unset/shared-lexicons";
import { type CardKey, cardUri, isObject, type RepoDid } from "./cards.ts";
import { fitsIndex } from "./index-plan.ts";

export type PageError = "page.invalid" | "page.too_long";
export type PageRecord = { readonly $type: "sh.unset.page"; readonly createdAt: string } & Readonly<
  Record<string, unknown>
>;
type Built = { readonly ok: true; readonly record: PageRecord } | { readonly ok: false; readonly code: PageError };

/**
 * The page record to write over `existing` (the stored value, or null for a first page), with its card list set to
 * `list`: every other field kept, createdAt too. An empty list is no list. A list past the lexicon's count, or one
 * that takes the page past what the index keeps, is too long; a stored field another client broke is never written
 * back.
 */
function withList(existing: unknown, list: readonly unknown[], now: string): Built {
  if (list.length > LIMITS.page.cardsMax) return { ok: false, code: "page.too_long" };
  const { $type: _type, cards: _old, ...kept } = isObject(existing) ? existing : {};
  const createdAt = typeof kept.createdAt === "string" ? kept.createdAt : now;
  const record: PageRecord = {
    $type: "sh.unset.page",
    ...kept,
    ...(list.length === 0 ? {} : { cards: list }),
    createdAt,
  };
  if (!validateRecord("sh.unset.page", record, "read").ok) return { ok: false, code: "page.invalid" };
  // The index must keep what is written, or the public page would lose its order (index-plan.ts fitsIndex).
  if (!fitsIndex(record)) return { ok: false, code: "page.too_long" };
  return { ok: true, record };
}

/** The page's stored `cards` entries, unchecked, and whether one of them names `owner`'s card `key`. */
function storedList(existing: unknown): readonly unknown[] {
  return isObject(existing) && Array.isArray(existing.cards) ? existing.cards : [];
}
const names = (owner: RepoDid, key: CardKey) => (entry: unknown) =>
  isObject(entry) && entry.uri === cardUri(owner, key);

/**
 * The page with `owner`'s new card `key` at the end of its list, so the card shows (ADR 0091; ADR 0086 point 3). A
 * first card starts the page. A card already listed is not listed twice.
 */
export function withCardListed(owner: RepoDid, key: CardKey, existing: unknown, now: string): Built {
  const list = storedList(existing);
  return withList(existing, list.some(names(owner, key)) ? list : [...list, { uri: cardUri(owner, key) }], now);
}

/**
 * The page without the entries that name `owner`'s card `key`, every other entry kept; null when there is nothing to
 * write (no page, or the card is not listed).
 */
export function withCardUnlisted(
  owner: RepoDid,
  key: CardKey,
  existing: unknown,
  now: string,
): { readonly ok: true; readonly record: PageRecord | null } | { readonly ok: false; readonly code: PageError } {
  if (!isObject(existing)) return { ok: true, record: null };
  const list = storedList(existing);
  const kept = list.filter((entry) => !names(owner, key)(entry));
  return kept.length === list.length ? { ok: true, record: null } : withList(existing, kept, now);
}

/**
 * The page with its card order set: the cards in `order` first, then every stored entry the order does not name,
 * kept as it was (a card this version hides, another client's entry), since a card the list drops leaves the page.
 */
export function withCardOrder(owner: RepoDid, order: readonly CardKey[], existing: unknown, now: string): Built {
  const ordered = order.map((key) => ({ uri: cardUri(owner, key) }));
  const rest = storedList(existing).filter((entry) => !order.some((key) => names(owner, key)(entry)));
  return withList(existing, [...ordered, ...rest], now);
}
