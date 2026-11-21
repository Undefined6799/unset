// Writing profile cards (ADR 0051): the editor's input is read once into checked content (DM-1), and the record built
// from it must validate before it goes to the member's PDS. Reading is in cards.ts.
import { LIMITS, validateRecord } from "@unset/shared-lexicons";
import {
  type CardButton,
  type CardContent,
  type CardEntry,
  type CardError,
  type CardFit,
  type CardKey,
  type CardKind,
  type CardLayout,
  type CardSurface,
  type CardWidth,
  DEFAULT_LAYOUT,
  type Failed,
  FITS,
  isEmailAddress,
  isObject,
  LAYOUTS,
  NSID,
  type Obj,
  oneOf,
  PRESETS,
  parseDraftImageId,
  SURFACES,
  WIDTHS,
} from "./cards.ts";
import { fitsIndex } from "./index-plan.ts";
import { isPlainText } from "./member-text.ts";
import { isWebAddress, withScheme } from "./web-address.ts";

/** The content fields this version writes, per kind; an edit replaces these and keeps any other. */
const OWN_FIELDS: Record<CardKind, readonly string[]> = {
  readme: ["text"],
  links: ["title", "layout", "items"],
  collection: ["title", "layout", "items"],
  buttons: ["heading", "text", "buttons"],
  image: ["image", "caption", "fit"],
};

/**
 * How many rows the editor may write per list, under the lexicon's (ADR 0051 point 5: app limits may change, the
 * schema's may not). Reads keep the lexicon's limits, so a card another client wrote with more still shows in full.
 */
export const CARD_EDIT_LIMITS = {
  links: 30,
  collection: 30,
  buttons: LIMITS.section.buttonsMax,
} as const satisfies Partial<Record<CardKind, number>>;

type Field<T> = { readonly ok: true; readonly value: T } | Failed;
const fail = (code: CardError, field?: string): Failed =>
  field === undefined ? { ok: false, code } : { ok: false, code, field };
/** The refusal with `name` in front of its field path, or as its field when it has none. */
const under = (name: string, failed: Failed): Failed =>
  fail(failed.code, failed.field === undefined ? name : `${name}.${failed.field}`);

/**
 * A string field: absent reads as "", anything else that is not a string is refused. Printable text only, one line
 * unless `multiline` (member-text.ts).
 */
function field(raw: unknown, multiline = false): Field<string> {
  if (raw === undefined || raw === null) return { ok: true, value: "" };
  if (typeof raw !== "string") return fail("card.invalid");
  const value = raw.replace(/\r\n?/g, "\n").trim();
  if (!isPlainText(value, multiline)) return fail("card.invalid");
  return { ok: true, value };
}

function address(raw: unknown, required: boolean): Field<string> {
  const read = field(raw);
  if (!read.ok) return read;
  if (read.value === "") return required ? fail("card.required") : read;
  const uri = withScheme(read.value);
  return isWebAddress(uri) ? { ok: true, value: uri } : fail("card.url_invalid");
}

function list(raw: unknown, max: number): Field<readonly Obj[]> {
  if (raw === undefined) return { ok: true, value: [] };
  if (!Array.isArray(raw) || !raw.every(isObject)) return fail("card.invalid");
  return raw.length > max ? fail("card.too_long") : { ok: true, value: raw };
}

/** Reads each field in turn; the first refusal is the answer, naming its field. */
function fields<K extends string>(reads: Record<K, Field<string>>): Field<Record<K, string>> {
  const out = {} as Record<K, string>;
  for (const [name, read] of Object.entries(reads) as [K, Field<string>][]) {
    if (!read.ok) return under(name, read);
    out[name] = read.value;
  }
  return { ok: true, value: out };
}

/** Reads each row of the list `name`; a refusal names the row, as `name.N.field`. */
function all<T>(name: string, items: readonly Obj[], read: (item: Obj) => Field<T>): Field<T[]> {
  const out: T[] = [];
  for (const [index, item] of items.entries()) {
    const one = read(item);
    if (!one.ok) return under(`${name}.${index}`, one);
    out.push(one.value);
  }
  return { ok: true, value: out };
}

/** A list card needs at least one row: one with none shows an empty card, so the member deletes it instead. */
function filled<T>(rows: Field<T[]>): Field<T[]> {
  return rows.ok && rows.value.length === 0 ? fail("card.empty") : rows;
}

const readLink = (item: Obj) =>
  fields({ uri: address(item.uri, true), label: field(item.label), description: field(item.description) });

function readEntry(item: Obj): Field<CardEntry> {
  const read = fields({
    title: field(item.title),
    tag: field(item.tag),
    description: field(item.description),
    uri: address(item.uri, false),
  });
  return read.ok && read.value.title === "" ? fail("card.required", "title") : read;
}

function readButtonInput(item: Obj): Field<CardButton> {
  if (item.kind === "email") {
    const read = field(item.address);
    if (!read.ok) return under("address", read);
    return isEmailAddress(read.value)
      ? { ok: true, value: { kind: "email", address: read.value } }
      : fail("card.email_invalid", "address");
  }
  if (item.kind !== "link" || !oneOf(PRESETS, item.preset)) return fail("card.invalid");
  const read = fields({ uri: address(item.uri, true), label: field(item.label) });
  return read.ok ? { ok: true, value: { kind: "link", preset: item.preset, ...read.value } } : read;
}

function layoutOf(raw: unknown, kind: "links" | "collection"): Field<CardLayout> {
  if (raw === undefined) return { ok: true, value: DEFAULT_LAYOUT[kind] };
  return oneOf(LAYOUTS, raw) ? { ok: true, value: raw } : fail("card.invalid");
}

function readReadme(input: Obj): Field<CardContent> {
  const read = field(input.text, true);
  if (!read.ok) return under("text", read);
  return read.value === "" ? fail("card.required", "text") : { ok: true, value: { kind: "readme", text: read.value } };
}

function readLinks(input: Obj): Field<CardContent> {
  const head = fields({ title: field(input.title) });
  const layout = layoutOf(input.layout, "links");
  const raw = list(input.items, LIMITS.section.linksMax);
  if (!head.ok) return head;
  if (!layout.ok) return layout;
  if (!raw.ok) return raw;
  const items = filled(all("items", raw.value, readLink));
  return items.ok
    ? { ok: true, value: { kind: "links", ...head.value, layout: layout.value, items: items.value } }
    : items;
}

function readCollection(input: Obj): Field<CardContent> {
  const head = fields({ title: field(input.title) });
  const layout = layoutOf(input.layout, "collection");
  const raw = list(input.items, LIMITS.section.entriesMax);
  if (!head.ok) return head;
  if (!layout.ok) return layout;
  if (!raw.ok) return raw;
  const items = filled(all("items", raw.value, readEntry));
  const value = {
    kind: "collection",
    ...head.value,
    layout: layout.value,
    items: items.ok ? items.value : [],
  } as const;
  return items.ok ? { ok: true, value } : items;
}

function readButtons(input: Obj): Field<CardContent> {
  const head = fields({ heading: field(input.heading), text: field(input.text, true) });
  if (!head.ok) return head;
  if (head.value.heading === "") return fail("card.required", "heading");
  const raw = list(input.buttons, LIMITS.section.buttonsMax);
  if (!raw.ok) return raw;
  const buttons = filled(all("buttons", raw.value, readButtonInput));
  return buttons.ok ? { ok: true, value: { kind: "buttons", ...head.value, buttons: buttons.value } } : buttons;
}

/** A picture card: a new draft's id, or no id to keep the card's picture; alt text may span lines, a caption not. */
function readImage(input: Obj): Field<CardContent> {
  const id = field(input.image);
  if (!id.ok) return under("image", id);
  const draft = id.value === "" ? null : parseDraftImageId(id.value);
  if (id.value !== "" && draft === null) return fail("card.invalid", "image");
  const text = fields({ alt: field(input.alt, true), caption: field(input.caption) });
  if (!text.ok) return text;
  if (input.fit !== undefined && input.fit !== "" && !oneOf(FITS, input.fit)) return fail("card.invalid");
  const fit: CardFit = oneOf(FITS, input.fit) ? input.fit : "contain";
  const picture = draft === null ? ({ kind: "kept" } as const) : ({ kind: "draft", id: draft } as const);
  return { ok: true, value: { kind: "image", picture, ...text.value, fit } };
}

const READERS: Record<string, (input: Obj) => Field<CardContent>> = {
  readme: readReadme,
  links: readLinks,
  collection: readCollection,
  buttons: readButtons,
  image: readImage,
};

/** Reads one card as the editor sends it (untrusted JSON): `kind`, optional `width` and `surface`, then the kind's fields. */
export function parseCardInput(
  input: Obj,
):
  | { readonly ok: true; readonly content: CardContent; readonly width: CardWidth; readonly surface?: CardSurface }
  | Failed {
  if (input.width !== undefined && !oneOf(WIDTHS, input.width)) return fail("card.invalid");
  // Like width, no field is named: only a crafted request sends a surface the editor does not offer.
  if (input.surface !== undefined && !oneOf(SURFACES, input.surface)) return fail("card.invalid");
  const reader = typeof input.kind === "string" && Object.hasOwn(READERS, input.kind) ? READERS[input.kind] : undefined;
  if (reader === undefined) return fail("card.kind_unknown");
  const content = reader(input);
  if (!content.ok) return content;
  const sized = validateRecord(NSID, { $type: NSID, content: toLexicon(content.value), createdAt: EPOCH }, "write");
  if (!sized.ok) return fail("card.too_long", tooLongField(sized.errors));
  return {
    ok: true,
    content: content.value,
    width: oneOf(WIDTHS, input.width) ? input.width : "full",
    ...(oneOf(SURFACES, input.surface) ? { surface: input.surface } : {}),
  };
}

const EPOCH = "1970-01-01T00:00:00.000Z";
/**
 * The input field a size refusal names, read from the validator's path: @atproto/lex-schema 0.2.8 ends each message
 * with "at $.content.items[1].label" (card-edit.test.ts pins it). A message in any other form names no field.
 */
function tooLongField(errors: readonly string[]): string | undefined {
  if (/ at \$\.content\.image\.alt$/.test(errors[0] ?? "")) return "alt";
  const path = / at \$\.content\.([a-z]+)(?:\[(\d+)\]\.([a-z]+))?$/i.exec(errors[0] ?? "");
  if (path === null) return undefined;
  const [, name = "", index, inner] = path;
  return index === undefined ? name : `${name}.${index}.${inner}`;
}

/** An object with the fields that are set; "" means unset and is not written. */
const set = (entries: Record<string, string>) =>
  Object.fromEntries(Object.entries(entries).filter(([, v]) => v !== ""));

/**
 * Sizes a picture not yet published, or kept, while its input is checked: the stored picture is a blob ref of fixed
 * shape, so only the alt text and caption can make the record too long. Never written (toCardRecord).
 */
const SIZING_PICTURE = {
  image: {
    $type: "blob",
    ref: { $link: "bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku" },
    mimeType: "image/jpeg",
    size: 1,
  },
  aspectRatio: { width: 1, height: 1 },
};

function toLexicon(content: CardContent): Record<string, unknown> {
  const $type = `${NSID}#${content.kind}`;
  switch (content.kind) {
    case "image": {
      const { picture } = content;
      const image =
        picture.kind === "published"
          ? { image: picture.blob, aspectRatio: { width: picture.width, height: picture.height } }
          : SIZING_PICTURE;
      return { $type, image: { ...image, alt: content.alt }, ...set({ caption: content.caption }), fit: content.fit };
    }
    case "readme":
      return { $type, text: content.text };
    case "links":
      return {
        $type,
        ...set({ title: content.title }),
        layout: content.layout,
        items: content.items.map((i) => set(i)),
      };
    case "collection":
      return {
        $type,
        ...set({ title: content.title }),
        layout: content.layout,
        items: content.items.map((i) => set(i)),
      };
    case "buttons":
      return {
        $type,
        ...set({ heading: content.heading, text: content.text }),
        buttons: content.buttons.map((b) =>
          b.kind === "email"
            ? { $type: `${NSID}#emailButton`, address: b.address }
            : { $type: `${NSID}#linkButton`, ...set({ preset: b.preset, uri: b.uri, label: b.label }) },
        ),
      };
  }
}

/** The fields this version writes on a list element; any other a stored element holds belongs to another client. */
const ELEMENT_FIELDS: readonly string[] = ["$type", "uri", "label", "description", "title", "tag", "preset", "address"];
/** The list each kind keeps its elements in. */
const ELEMENTS: Partial<Record<CardKind, string>> = { links: "items", collection: "items", buttons: "buttons" };

/**
 * An element stays the same one while it keeps its place, its `$type` and its uri or address. One with neither (a
 * collection entry may have no address) is the same only while every field this version writes is unchanged, so a
 * deleted neighbour's fields never land on the entry that moves into its place.
 */
function sameElement(old: Obj, next: Obj): boolean {
  const addressed = next.uri !== undefined || next.address !== undefined;
  const fields = addressed ? ["$type", "uri", "address"] : ELEMENT_FIELDS;
  return fields.every((field) => old[field] === next[field]);
}

/**
 * Each new element keeps the unknown fields of the stored element in the same place when it is the same one
 * (ADR 0038: fields we do not know are kept, inside list elements too). A changed element starts clean.
 */
function keepElementFields(fresh: Obj, old: Obj, kind: CardKind): Obj {
  const list = ELEMENTS[kind];
  if (list === undefined || !Array.isArray(fresh[list]) || !Array.isArray(old[list])) return fresh;
  const before = old[list] as readonly unknown[];
  const merged = (fresh[list] as readonly Obj[]).map((next, i) => {
    const prior = before[i];
    if (!isObject(prior) || !sameElement(prior, next)) return next;
    const unknown = Object.entries(prior).filter(([field]) => !ELEMENT_FIELDS.includes(field));
    return { ...Object.fromEntries(unknown), ...next };
  });
  return { ...fresh, [list]: merged };
}

function rows(content: unknown, kind: CardKind): number {
  const list = ELEMENTS[kind];
  if (list === undefined || !isObject(content) || content.$type !== `${NSID}#${kind}`) return 0;
  const value = content[list];
  return Array.isArray(value) ? value.length : 0;
}

/**
 * A list may hold up to the editor's limit, or as many rows as the stored card of the same kind already has, so a
 * card past the limit can still be edited or trimmed but never grown.
 */
function withinEditLimit(fresh: Obj, existing: unknown, kind: CardKind): boolean {
  const limit: number | undefined = (CARD_EDIT_LIMITS as Partial<Record<CardKind, number>>)[kind];
  if (limit === undefined) return true;
  const stored = isObject(existing) ? rows(existing.content, kind) : 0;
  return rows(fresh, kind) <= Math.max(limit, stored);
}

/**
 * The picture object a picture card writes: a published one as built, the card's stored one with the new alt text
 * when it is kept (its blob ref and ratio are the PDS's own), and never a draft web has not published.
 */
function pictureToWrite(content: Extract<CardContent, { kind: "image" }>, existing: unknown): Field<Obj> {
  if (content.picture.kind === "draft") return fail("card.invalid");
  if (content.picture.kind === "published") return { ok: true, value: toLexicon(content).image as Obj };
  const stored = isObject(existing) && isObject(existing.content) ? existing.content : {};
  const image = stored.$type === `${NSID}#image` && isObject(stored.image) ? stored.image : null;
  if (image === null || !isObject(image.image)) return fail("card.required", "image");
  return { ok: true, value: { ...image, alt: content.alt } };
}

/**
 * The CID of the blob a stored card record shows, or null for another kind or a malformed picture. Read in the
 * record's JSON form (https://atproto.com/specs/data-model, "Blob Type": `ref` as `{ $link }`), so a record listed
 * through @atproto/api, whose blob is a decoded BlobRef that serialises to that form, reads the same as a plain one.
 */
export function pictureLink(record: unknown): string | null {
  if (!isObject(record) || !isObject(record.content) || record.content.$type !== `${NSID}#image`) return null;
  const image = record.content.image;
  if (!isObject(image) || image.image === undefined) return null;
  const blob: unknown = JSON.parse(JSON.stringify(image.image));
  const link = isObject(blob) && isObject(blob.ref) ? blob.ref.$link : undefined;
  return typeof link === "string" ? link : null;
}

export type CardRecord = { readonly $type: typeof NSID; readonly createdAt: string } & Obj;

/**
 * The record to write over `existing` (the stored value, or null for a new card). Content is replaced; createdAt and
 * any field this version does not know are kept (ADR 0038), inside the content too while its kind stays the same.
 * Missing surface input preserves the stored choice for older editors; explicit filled clears it.
 * Past the lexicon's limits, or a list grown past the editor's, is "too long". The whole record is validated once
 * more before it is returned.
 */
export function toCardRecord(
  content: CardContent,
  width: CardWidth,
  existing: unknown,
  now: string,
  surface?: CardSurface,
): { readonly ok: true; readonly record: CardRecord } | Failed {
  const picture = content.kind === "image" ? pictureToWrite(content, existing) : null;
  if (picture !== null && !picture.ok) return picture;
  const lexicon = toLexicon(content);
  const fresh = picture === null ? lexicon : { ...lexicon, image: picture.value };
  const appearance = surface === undefined || surface === "filled" ? {} : { surface };
  const sized: CardRecord = {
    $type: NSID,
    content: fresh,
    ...(width === "half" ? { width } : {}),
    ...appearance,
    createdAt: now,
  };
  if (!validateRecord(NSID, sized, "write").ok) return fail("card.too_long");
  if (!withinEditLimit(fresh, existing, content.kind)) return fail("card.too_long");
  const stored = isObject(existing) ? existing : {};
  const sameKind = isObject(stored.content) && stored.content.$type === fresh.$type ? stored.content : {};
  const old = Object.fromEntries(Object.entries(sameKind).filter(([k]) => !OWN_FIELDS[content.kind].includes(k)));
  const { $type: _t, content: _c, width: _w, surface: storedSurface, createdAt, ...kept } = stored;
  const record: CardRecord = {
    $type: NSID,
    ...kept,
    ...(surface === undefined && storedSurface !== undefined ? { surface: storedSurface } : appearance),
    ...(width === "half" ? { width } : {}),
    content: { ...old, ...keepElementFields(fresh, sameKind, content.kind) },
    createdAt: typeof createdAt === "string" ? createdAt : now,
  };
  if (!validateRecord(NSID, record, "read").ok) return fail("card.invalid");
  // The fields an edit keeps count too: the index must keep what is written (index-plan.ts, book P3.12v).
  return fitsIndex(record) ? { ok: true, record } : fail("card.too_long");
}

/**
 * A new order for the cards the member has. It must name each existing card exactly once, so a card added or removed
 * in another tab meanwhile is never dropped from the page by a stale reorder; the editor reloads instead.
 */
export function reorderCards(
  requested: unknown,
  existing: readonly CardKey[],
): { readonly ok: true; readonly order: CardKey[] } | Failed {
  if (!Array.isArray(requested) || requested.length !== existing.length) return fail("card.order_invalid");
  const known = new Set<string>(existing);
  const seen = new Set<string>();
  for (const raw of requested) {
    if (typeof raw !== "string" || !known.has(raw) || seen.has(raw)) return fail("card.order_invalid");
    seen.add(raw);
  }
  return { ok: true, order: requested as CardKey[] };
}
