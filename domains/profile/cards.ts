// Profile cards (ADR 0051): each card is one sh.unset.section record in the member's PDS, and the profile's `cards`
// list sets their order. Readers are lenient, since any client may write these records: a card that does not
// validate, or whose kind this version does not know, is hidden, and an address that is not plain http(s) is
// dropped. Writing is in card-edit.ts.
// Lexicon rules: https://atproto.com/specs/lexicon ("Lexicon Evolution", "Authority and Control").
import { LIMITS, validateRecord } from "@unset/shared-lexicons";
import { isWebAddress } from "./web-address.ts";

export type Obj = Readonly<Record<string, unknown>>;

declare const cardKey: unique symbol;
/** A record key of one of the member's sh.unset.section records. */
export type CardKey = string & { readonly [cardKey]: true };

export type CardSurface = "filled" | "outlined" | "plain";
export type CardWidth = "full" | "half";
export type CardLayout = "list" | "carousel" | "grid";
export type LinkPreset = "bookCall" | "hire" | "subscribe" | "custom";
/** Optional text is "" when unset. */
export type CardLink = { readonly uri: string; readonly label: string; readonly description: string };
export type CardEntry = {
  readonly title: string;
  readonly tag: string;
  readonly description: string;
  readonly uri: string;
};
export type CardButton =
  | { readonly kind: "email"; readonly address: string }
  | { readonly kind: "link"; readonly preset: LinkPreset; readonly uri: string; readonly label: string };
export type CardFit = "contain" | "fill";
declare const draftImage: unique symbol;
/** A member's uploaded image not yet in their PDS (domains/content's library row id), as the editor names it. */
export type DraftImageId = string & { readonly [draftImage]: true };
/**
 * A picture card's picture: one the member just picked (a draft web publishes before the write), the card's own
 * picture kept as it is, or one published to the member's PDS (its blob ref and pixel size, ADR 0070 point 5).
 */
export type CardPicture =
  | { readonly kind: "draft"; readonly id: DraftImageId }
  | { readonly kind: "kept" }
  | { readonly kind: "published"; readonly blob: Obj; readonly width: number; readonly height: number };
/** What a page shows of a card. */
export type ShownCardContent =
  | { readonly kind: "readme"; readonly text: string }
  | { readonly kind: "links"; readonly title: string; readonly layout: CardLayout; readonly items: readonly CardLink[] }
  | {
      readonly kind: "collection";
      readonly title: string;
      readonly layout: CardLayout;
      readonly items: readonly CardEntry[];
    }
  | {
      readonly kind: "buttons";
      readonly heading: string;
      readonly text: string;
      readonly buttons: readonly CardButton[];
    };
/** What the editor writes: any shown kind, and a picture card, which pages draw from P2.19c. */
export type CardContent =
  | ShownCardContent
  | {
      readonly kind: "image";
      readonly picture: CardPicture;
      readonly alt: string;
      readonly caption: string;
      readonly fit: CardFit;
    };
export type CardKind = CardContent["kind"];
export type Card = {
  readonly key: CardKey;
  readonly width: CardWidth;
  readonly surface: CardSurface;
  readonly createdAt: string;
  readonly content: ShownCardContent;
};

export type CardError =
  | "card.invalid"
  | "card.kind_unknown"
  | "card.required"
  | "card.too_long"
  | "card.url_invalid"
  | "card.email_invalid"
  | "card.empty"
  | "card.order_invalid"
  /** The member's cards together would pass MAX_PAGE_BYTES (index-plan.ts `fitsPage`). */
  | "card.page_full";
/**
 * A refusal; `field`, when one field is to blame, is its path in the editor's input: "text", "title", "heading", or
 * a row's field such as "items.1.uri" (the row's place in the list as read, blank rows left out).
 */
export type Failed = { readonly ok: false; readonly code: CardError; readonly field?: string };

export const NSID = "sh.unset.section";
/** The most cards a member keeps: the profile's `cards` order holds this many, and the page reads this many. */
export const CARDS_MAX = LIMITS.profile.cardsMax;
/** The kinds a page shows; a picture card stays hidden until P2.19c draws it (book P2.19a). */
const KINDS: readonly ShownCardContent["kind"][] = ["readme", "links", "collection", "buttons"];
export const FITS: readonly CardFit[] = ["contain", "fill"];
export const SURFACES: readonly CardSurface[] = ["filled", "outlined", "plain"];
export const WIDTHS: readonly CardWidth[] = ["full", "half"];
export const LAYOUTS: readonly CardLayout[] = ["list", "carousel", "grid"];
export const PRESETS: readonly LinkPreset[] = ["bookCall", "hire", "subscribe", "custom"];
export const DEFAULT_LAYOUT = { links: "list", collection: "carousel" } as const;

export const isObject = (value: unknown): value is Obj =>
  typeof value === "object" && value !== null && !Array.isArray(value);
export const oneOf = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === "string" && (list as readonly string[]).includes(value);
const text = (value: unknown) => (typeof value === "string" ? value : "");
const bytes = (value: string) => new TextEncoder().encode(value).length;

/** atproto.com/specs/record-key: 1 to 512 of A-Za-z0-9 . - _ : ~, and never "." or "..". */
export function parseCardKey(raw: unknown): CardKey | null {
  if (typeof raw !== "string" || raw === "." || raw === "..") return null;
  return /^[A-Za-z0-9._:~-]{1,512}$/.test(raw) ? (raw as CardKey) : null;
}

/** A library row id as Postgres writes a UUID: lowercase, hyphenated (RFC 9562 section 4). */
export function parseDraftImageId(raw: unknown): DraftImageId | null {
  return typeof raw === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(raw)
    ? (raw as DraftImageId)
    : null;
}

declare const cardVersion: unique symbol;
/** The version of a card as the member's editor opened it: the record's CID, which changes with every write. */
export type CardVersion = string & { readonly [cardVersion]: true };

/**
 * A record CID as a PDS returns it: CIDv1 in base32, multibase prefix "b" (atproto.com/specs/data-model, "Link and
 * CID Formats": CIDv1, base32 in string form). Only compared with what the PDS answers, never parsed further.
 */
export function parseCardVersion(raw: unknown): CardVersion | null {
  return typeof raw === "string" && /^b[a-z2-7]{20,100}$/.test(raw) ? (raw as CardVersion) : null;
}

/**
 * A published address of plain characters only: letters, digits and . _ + - before the @, dot-separated labels of
 * letters, digits and - after it, at most the lexicon's 254 bytes. Nothing that means something in a mailto: URL
 * (? & = # %) can pass, so a stored address can never add headers or recipients to the link (RFC 6068 section 2).
 */
export function isEmailAddress(value: string): boolean {
  return bytes(value) <= LIMITS.section.emailBytes && /^[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(value);
}

function readButton(value: unknown): CardButton | null {
  if (!isObject(value)) return null;
  if (value.$type === `${NSID}#emailButton`) {
    const address = text(value.address);
    return isEmailAddress(address) ? { kind: "email", address } : null;
  }
  if (value.$type !== `${NSID}#linkButton` || !isWebAddress(text(value.uri))) return null;
  const preset = oneOf(PRESETS, value.preset) ? value.preset : "custom";
  return { kind: "link", preset, uri: text(value.uri), label: text(value.label) };
}

function readContent(content: Obj): ShownCardContent | null {
  const prefix = `${NSID}#`;
  const type = text(content.$type);
  const kind = type.startsWith(prefix) ? type.slice(prefix.length) : "";
  if (!oneOf(KINDS, kind)) return null;
  const items = Array.isArray(content.items) ? content.items.filter(isObject) : [];
  const layout = (fallback: CardLayout) => (oneOf(LAYOUTS, content.layout) ? content.layout : fallback);
  switch (kind) {
    case "readme":
      return { kind, text: text(content.text) };
    case "links":
      return {
        kind,
        title: text(content.title),
        layout: layout(DEFAULT_LAYOUT.links),
        items: items
          .filter((item) => isWebAddress(text(item.uri)))
          .map((item) => ({ uri: text(item.uri), label: text(item.label), description: text(item.description) })),
      };
    case "collection":
      return {
        kind,
        title: text(content.title),
        layout: layout(DEFAULT_LAYOUT.collection),
        items: items.map((item) => ({
          title: text(item.title),
          tag: text(item.tag),
          description: text(item.description),
          uri: isWebAddress(text(item.uri)) ? text(item.uri) : "",
        })),
      };
    case "buttons": {
      const buttons = Array.isArray(content.buttons) ? content.buttons.map(readButton) : [];
      return {
        kind,
        heading: text(content.heading),
        text: text(content.text),
        buttons: buttons.filter((b) => b !== null),
      };
    }
  }
}

/** The card a stored record shows, or null when it is hidden. */
export function readCard(key: CardKey, value: unknown): Card | null {
  if (!isObject(value) || !validateRecord(NSID, value, "read").ok || !isObject(value.content)) return null;
  const content = readContent(value.content);
  if (content === null) return null;
  const width = oneOf(WIDTHS, value.width) ? value.width : "full";
  const surface = oneOf(SURFACES, value.surface) ? value.surface : "filled";
  return { key, width, surface, createdAt: text(value.createdAt), content };
}

/**
 * Page order (ADR 0051 decision 2): cards the profile lists, in its order, skipping keys with no card and repeats;
 * then the cards it does not list, oldest first. `order` is the stored profile's `cards`, unchecked.
 */
export function orderCards(order: unknown, cards: readonly Card[]): Card[] {
  const byKey = new Map(cards.map((card) => [card.key as string, card]));
  const listed: Card[] = [];
  for (const raw of Array.isArray(order) ? order : []) {
    const card = typeof raw === "string" ? byKey.get(raw) : undefined;
    if (card === undefined) continue;
    listed.push(card);
    byKey.delete(raw);
  }
  const rest = [...byKey.values()].sort(byMadeAt);
  return [...listed, ...rest];
}

/** A card record as a repo holds it: its record key and value, neither checked yet. */
export type StoredCardRecord = { readonly key: string; readonly value: unknown };

/** The cards a page shows: a key that is not a record key, or a card that does not read, is left out. */
export function shownCards(stored: readonly StoredCardRecord[]): Card[] {
  const cards: Card[] = [];
  for (const item of stored) {
    const key = parseCardKey(item.key);
    const card = key === null ? null : readCard(key, item.value);
    if (card !== null) cards.push(card);
  }
  return cards;
}

/** The shown cards in page order: as the profile record's `cards` list sets it, then the rest oldest first. */
export function pageCards(profileRecord: unknown, stored: readonly StoredCardRecord[]): Card[] {
  return orderCards(cardOrder(profileRecord), shownCards(stored));
}

function cardOrder(record: unknown): unknown {
  if (typeof record !== "object" || record === null) return undefined;
  return (record as { readonly cards?: unknown }).cards;
}

/**
 * Oldest first, by the instant each card was made: lexicon datetimes may carry any offset and precision
 * (https://atproto.com/specs/lexicon#datetime), so their text does not sort. Date.parse stops at milliseconds, so
 * within one millisecond the finer digits decide; offsets are whole minutes and never change them. A time that does
 * not parse sorts last.
 */
function byMadeAt(a: Card, b: Card): number {
  const [msA, msB] = [Date.parse(a.createdAt), Date.parse(b.createdAt)];
  if (Number.isNaN(msA) || Number.isNaN(msB)) return Number(Number.isNaN(msA)) - Number(Number.isNaN(msB));
  return msA - msB || finerDigits(a.createdAt).localeCompare(finerDigits(b.createdAt));
}

/** The fraction's digits past the millisecond, padded so that they compare as text. */
const finerDigits = (datetime: string) => (/\.\d{3}(\d*)/.exec(datetime)?.[1] ?? "").padEnd(16, "0");
