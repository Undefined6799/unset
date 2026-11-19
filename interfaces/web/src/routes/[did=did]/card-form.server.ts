// Ported unchanged from interfaces/http/card-form.ts (P1.20i); that copy went with P1.20k.
// A card editor's plain form (ADR 0037 point 7, ADR 0051), read into the object a JSON editor would send, so both
// reach the same parser in domains/profile. This only translates the form's shape: indexed fields such as
// `items.2.uri` become rows of a list, and a row the member left blank is an unused slot. What each field may hold,
// and how many rows a card may have, is the domain's to decide.

import { AppError } from "@unset/shared-errors";
import { LIMITS } from "@unset/shared-lexicons";

type Shape = {
  /** Fields beside `kind` and `width`. */
  readonly fields: readonly string[];
  /** The list the rows go in, with the fields a row holds and how many rows the lexicon allows. */
  readonly list?: { readonly name: string; readonly row: readonly string[]; readonly max: number };
  /** Row fields a form always fills (a select), so they alone never make a row used. */
  readonly preset?: readonly string[];
  /** Row fields that count only on a row of that `kind`: the editor hides the other kind's fields, which still post. */
  readonly byKind?: Readonly<Record<string, readonly string[]>>;
};

const SHAPES: Readonly<Record<string, Shape>> = {
  readme: { fields: ["text"] },
  links: {
    fields: ["title", "layout"],
    list: { name: "items", row: ["uri", "label", "description"], max: LIMITS.section.linksMax },
  },
  collection: {
    fields: ["title", "layout"],
    list: { name: "items", row: ["title", "tag", "description", "uri"], max: LIMITS.section.entriesMax },
  },
  buttons: {
    fields: ["heading", "text"],
    list: { name: "buttons", row: ["kind", "address", "preset", "uri", "label"], max: LIMITS.section.buttonsMax },
    preset: ["kind", "preset"],
    byKind: { email: ["address"], link: ["uri", "label"] },
  },
};

/** The most fields any card form holds: kind, width, two more, and the largest list full (a collection's 100x4). */
export const CARD_FORM_MAX_FIELDS = Math.max(
  ...Object.values(SHAPES).map((s) => 2 + s.fields.length + (s.list ? s.list.max * s.list.row.length : 0)),
);

const INDEX = /^(0|[1-9][0-9]*)$/;
const invalid = () => new AppError("card.invalid");

/** `list.N.field` as the row's index and field, or card.invalid when the name is not one this shape holds. */
function rowField(name: string, list: NonNullable<Shape["list"]>): { readonly index: number; readonly field: string } {
  const parts = name.split(".");
  if (parts.length !== 3 || parts[0] !== list.name) throw invalid();
  const [, index = "", field = ""] = parts;
  if (!INDEX.test(index) || Number(index) >= list.max || !list.row.includes(field)) throw invalid();
  return { index: Number(index), field };
}

/** The rows in index order, without the blank ones, each with its index in the form. */
function rows(byIndex: Map<number, Record<string, string>>, shape: Shape): [number, Record<string, string>][] {
  const used = (row: Record<string, string>) => {
    // A row of an unknown kind (an inherited name such as toString too) keeps every field, so the domain refuses it
    // rather than this dropping it.
    const kind = row.kind;
    const counted =
      kind === undefined || shape.byKind === undefined || !Object.hasOwn(shape.byKind, kind)
        ? undefined
        : shape.byKind[kind];
    return Object.entries(row).some(
      ([field, value]) =>
        !shape.preset?.includes(field) && (counted === undefined || counted.includes(field)) && value.trim() !== "",
    );
  };
  return [...byIndex.entries()].sort(([a], [b]) => a - b).filter(([, row]) => used(row));
}

/**
 * The form as one card object and `fieldName`, which turns a field path the domain names in that object
 * ("items.1.uri", the second row it read) back into the form's own field ("items.4.uri", blank rows counted), so a
 * refusal can be shown beside the field the member typed in. A path it does not know is undefined.
 * The checks run in order: the number of fields, then each field once, then each name against the shape of the
 * form's kind. A form without a known kind is card.kind_unknown.
 */
export function readCardForm(form: URLSearchParams): {
  readonly body: Readonly<Record<string, unknown>>;
  readonly fieldName: (path: string) => string | undefined;
} {
  let count = 0;
  for (const _ of form) if (++count > CARD_FORM_MAX_FIELDS) throw invalid();
  const names = [...form.keys()];
  if (new Set(names).size !== names.length) throw invalid();
  const kind = form.get("kind");
  const shape = kind !== null && Object.hasOwn(SHAPES, kind) ? SHAPES[kind] : undefined;
  if (shape === undefined) throw new AppError("card.kind_unknown");
  const body: Record<string, unknown> = {};
  const byIndex = new Map<number, Record<string, string>>();
  for (const [name, value] of form) {
    if (name === "kind" || name === "width" || shape.fields.includes(name)) {
      body[name] = value;
      continue;
    }
    if (shape.list === undefined) throw invalid();
    const { index, field } = rowField(name, shape.list);
    const row = byIndex.get(index) ?? {};
    row[field] = value;
    byIndex.set(index, row);
  }
  const rowList = shape.list;
  const used = rowList === undefined ? [] : rows(byIndex, shape);
  if (rowList !== undefined) body[rowList.name] = used.map(([, row]) => row);
  const fieldName = (path: string) => {
    if (shape.fields.includes(path)) return path;
    const [list, index, field] = path.split(".");
    const at = index === undefined || !INDEX.test(index) ? undefined : used[Number(index)]?.[0];
    if (
      rowList === undefined ||
      list !== rowList.name ||
      at === undefined ||
      field === undefined ||
      !rowList.row.includes(field)
    ) {
      return undefined;
    }
    return `${list}.${at}.${field}`;
  };
  return { body, fieldName };
}
