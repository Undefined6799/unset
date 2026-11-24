// Profile cards (ADR 0051, ADR 0086): each card is one sh.unset.card record in the member's PDS holding one
// sh.unset.block, and the profile's `cards` list of at:// addresses sets their order. Readers are lenient, since any client may write these records: a card that does not
// validate, or whose kind this version does not know, is hidden, and an address that is not plain http(s) is
// dropped. Writing is in card-edit.ts.
// Lexicon rules: https://atproto.com/specs/lexicon ("Lexicon Evolution", "Authority and Control").
import { LIMITS, validateRecord } from "@unset/shared-lexicons";
import { isWebAddress } from "./web-address.ts";

export type Obj = Readonly<Record<string, unknown>>;

declare const cardKey: unique symbol;
/** A record key of one of the member's sh.unset.card records. */
export type CardKey = string & { readonly [cardKey]: true };
declare const repoDid: unique symbol;
/** The DID of the repository a profile and its cards live in; the card list's addresses must name it. */
export type RepoDid = string & { readonly [repoDid]: true };

export type CardSurface = "filled" | "outlined" | "plain";
export type CardWidth = "full" | "half";
export type CardLayout = "list" | "carousel" | "grid";
export type LinkPreset = "bookCall" | "hire" | "subscribe" | "custom";
/**
 * The four switches for every table in a Text card (ADR 0110 point 2), each false when left out: our look with none
 * on draws the header line and the row lines, and no column lines or outline.
 */
export type TableLines = {
  readonly hideHeaderLine: boolean;
  readonly hideRowLines: boolean;
  readonly showColumnLines: boolean;
  readonly showOutline: boolean;
};
export const TABLE_SWITCHES = ["hideHeaderLine", "hideRowLines", "showColumnLines", "showOutline"] as const;
/** One single cell side of a table (sh.unset.block.text#edge): shown, or hidden with `hide`. */
export type TableEdge = {
  readonly direction: "horizontal" | "vertical";
  readonly line: number;
  readonly cell: number;
  readonly hide: boolean;
};
/** One table's single cell sides, named by a fingerprint of each of its lines (ADR 0110 points 4-5). */
export type TableSides = { readonly lines: readonly string[]; readonly edges: readonly TableEdge[] };
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
  /**
   * `tableLines` only when a switch is on, `tableSides` only when a look is stored; an edit without them keeps the
   * card's stored table lines.
   */
  | {
      readonly kind: "readme";
      readonly text: string;
      readonly tableLines?: TableLines;
      readonly tableSides?: readonly TableSides[];
    }
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

export const NSID = "sh.unset.card";
/**
 * The block each card kind writes (ADR 0086). The kinds keep the editor's names; the record's names are the
 * lexicon's, and only this map and the value maps below join them.
 */
export const BLOCKS = {
  readme: "sh.unset.block.text",
  links: "sh.unset.block.links",
  collection: "sh.unset.block.showcase",
  buttons: "sh.unset.block.buttons",
  image: "sh.unset.block.images",
} as const satisfies Record<CardKind, string>;
const KIND_OF_BLOCK = new Map<string, CardKind>(
  Object.entries(BLOCKS).map(([kind, block]) => [block, kind as CardKind]),
);
/**
 * The lexicon's kebab-case values for the presets and fits whose editor names differ. A custom button writes no preset:
 * the lexicon has no such value, and an absent preset means the reader shows the label (ADR 0086).
 */
export const PRESET_VALUES: Readonly<Record<LinkPreset, string>> = {
  bookCall: "book-call",
  hire: "hire",
  subscribe: "subscribe",
  custom: "",
};
export const FIT_VALUES: Readonly<Record<CardFit, string>> = { contain: "contain", fill: "cover" };
const fromValue = <T extends string>(values: Readonly<Record<T, string>>, raw: unknown): T | undefined =>
  (Object.keys(values) as T[]).find((key) => values[key] === raw);
/**
 * The most cards a member keeps: the editor creates and the page reads this many. The lexicon's ceiling is
 * LIMITS.profile.cardsMax (100), so this can grow without a new schema (ADR 0086; Alex, 2026-11-21).
 */
export const CARDS_MAX = 50;
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

/** atproto.com/specs/tid: 13 characters of base32-sortable, the first in 2-7 or a-j. */
const TID = /^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/;

/** A key the card lexicon accepts (sh.unset.card `"key": "tid"`), so a card under it is valid and indexed. */
export function parseNewCardKey(raw: unknown): CardKey | null {
  return typeof raw === "string" && TID.test(raw) ? parseCardKey(raw) : null;
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
  return bytes(value) <= LIMITS.card.emailBytes && /^[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(value);
}

function readButton(value: unknown): CardButton | null {
  if (!isObject(value)) return null;
  if (value.$type === `${BLOCKS.buttons}#email`) {
    const address = text(value.address);
    return isEmailAddress(address) ? { kind: "email", address } : null;
  }
  if (value.$type !== `${BLOCKS.buttons}#link` || !isWebAddress(text(value.uri))) return null;
  const preset = fromValue(PRESET_VALUES, value.preset) ?? "custom";
  return { kind: "link", preset, uri: text(value.uri), label: text(value.label) };
}

/** A Text card's table switches, or null when none is on. */
function tableLinesOf(style: unknown): TableLines | null {
  if (!isObject(style) || !TABLE_SWITCHES.some((name) => style[name] === true)) return null;
  const on = (name: (typeof TABLE_SWITCHES)[number]) => style[name] === true;
  return {
    hideHeaderLine: on("hideHeaderLine"),
    hideRowLines: on("hideRowLines"),
    showColumnLines: on("showColumnLines"),
    showOutline: on("showOutline"),
  };
}

const DIRECTIONS = ["horizontal", "vertical"] as const;

/** One stored edge, or null when its direction is one this version does not know (the lexicon's knownValues). */
function readEdge(value: Obj): TableEdge | null {
  if (!oneOf(DIRECTIONS, value.direction)) return null;
  const { line, cell } = value;
  if (!Number.isInteger(line) || !Number.isInteger(cell)) return null;
  return { direction: value.direction, line: line as number, cell: cell as number, hide: value.hide === true };
}

/** A Text card's single cell sides (tableStyle.tables), each look's fingerprints and the edges this version knows. */
function tableSidesOf(style: unknown): TableSides[] {
  if (!isObject(style) || !Array.isArray(style.tables)) return [];
  return style.tables.filter(isObject).map((table) => ({
    lines: Array.isArray(table.lines) ? table.lines.map(text) : [],
    edges: Array.isArray(table.edges) ? table.edges.filter(isObject).flatMap((edge) => readEdge(edge) ?? []) : [],
  }));
}

function readContent(content: Obj): ShownCardContent | null {
  const kind = KIND_OF_BLOCK.get(text(content.$type));
  if (!oneOf(KINDS, kind)) return null;
  const items = Array.isArray(content.items) ? content.items.filter(isObject) : [];
  const layout = (fallback: CardLayout) => (oneOf(LAYOUTS, content.layout) ? content.layout : fallback);
  switch (kind) {
    case "readme": {
      const tableLines = tableLinesOf(content.tableStyle);
      const tableSides = tableSidesOf(content.tableStyle);
      return {
        kind,
        text: text(content.text),
        ...(tableLines === null ? {} : { tableLines }),
        ...(tableSides.length === 0 ? {} : { tableSides }),
      };
    }
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

/**
 * A list block with no row left to show (ADR 0086): another client's empty list, or one whose every row was dropped
 * on read. The editor never writes one (card-edit.ts `filled`), so it is hidden, never drawn as an empty card.
 */
function isEmpty(content: ShownCardContent): boolean {
  if (content.kind === "links" || content.kind === "collection") return content.items.length === 0;
  return content.kind === "buttons" && content.buttons.length === 0;
}

/** The card a stored record shows, or null when it is hidden. */
export function readCard(key: CardKey, value: unknown): Card | null {
  if (!isObject(value) || !validateRecord(NSID, value, "read").ok || !isObject(value.content)) return null;
  const content = readContent(value.content);
  if (content === null || isEmpty(content)) return null;
  const width = oneOf(WIDTHS, value.width) ? value.width : "full";
  const surface = oneOf(SURFACES, value.surface) ? value.surface : "filled";
  return { key, width, surface, createdAt: text(value.createdAt), content };
}

/** A DID as the at:// addresses in a card list carry it (atproto.com/specs/did, "DID Syntax"). */
export function parseRepoDid(raw: unknown): RepoDid | null {
  return typeof raw === "string" && /^did:[a-z]+:[A-Za-z0-9._:%-]{1,2040}$/.test(raw) && !raw.endsWith(":")
    ? (raw as RepoDid)
    : null;
}

/** The at:// address the page's card list names a card of `owner` by (atproto.com/specs/at-uri-scheme). */
export const cardUri = (owner: RepoDid, key: CardKey) => `at://${owner}/${NSID}/${key}`;

/** The key of a listed card, or null when the entry names no card of `owner` (another account's cards are skipped). */
function listedKey(owner: RepoDid, entry: unknown): string | null {
  const uri = isObject(entry) ? entry.uri : undefined;
  const prefix = `at://${owner}/${NSID}/`;
  return typeof uri === "string" && uri.startsWith(prefix) ? uri.slice(prefix.length) : null;
}

/**
 * Page order (ADR 0086 point 3, ADR 0091): only the cards the page lists, in its order; an entry with no card is
 * skipped and a repeat shows once, at its first place. A card the list does not name is not on the page. `order` is
 * the stored page's `cards`, unchecked.
 */
export function orderCards(owner: RepoDid, order: unknown, cards: readonly Card[]): Card[] {
  const byKey = new Map(cards.map((card) => [card.key as string, card]));
  const listed: Card[] = [];
  for (const entry of Array.isArray(order) ? order : []) {
    const key = listedKey(owner, entry);
    const card = key === null ? undefined : byKey.get(key);
    if (key === null || card === undefined) continue;
    listed.push(card);
    byKey.delete(key);
  }
  return listed;
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

/** The shown cards in page order: the ones the page record's `cards` list names, in its order (none without a page). */
export function pageCards(owner: RepoDid, pageRecord: unknown, stored: readonly StoredCardRecord[]): Card[] {
  return orderCards(owner, cardOrder(pageRecord), shownCards(stored));
}

function cardOrder(record: unknown): unknown {
  if (typeof record !== "object" || record === null) return undefined;
  return (record as { readonly cards?: unknown }).cards;
}
