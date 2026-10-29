// The one record validator (P1.31): the generated @atproto/lex-schema validators, plus a refusal of unknown fields
// when we write our own records. Lexicon objects are open, so the generated validators accept unknown fields
// (@atproto/lex-schema 0.2.8, dist/schema/object.js); reading keeps that rule for forward compatibility.
import { jsonToLex } from "@atproto/lex-json";
import { app, sh } from "../generated/index.generated.ts";
import follow from "../schemas/sh.unset.follow.json" with { type: "json" };
import profile from "../schemas/sh.unset.profile.json" with { type: "json" };
import section from "../schemas/sh.unset.section.json" with { type: "json" };
import actorProfile from "../vendor/app.bsky.actor.profile.json" with { type: "json" };

/** "write" refuses fields the schema does not define; "read" accepts and ignores them. */
export type Mode = "write" | "read";
export type ValidationResult = { ok: true; value: Record<string, unknown> } | { ok: false; errors: string[] };
export type RecordNsid = keyof typeof RECORDS;

type Validator = { $safeValidate(value: unknown): { success: true } | { success: false; reason: Error } };
type Field = { type: string; ref?: string; refs?: string[] };
type Props = Record<string, Field & { items?: Field }>;
type Defs = Record<string, { type: string; record?: { properties: Props }; properties?: Props }>;

const RECORDS = {
  "sh.unset.profile": { validator: sh.unset.profile.main, defs: profile.defs, strict: true },
  "sh.unset.section": { validator: sh.unset.section.main, defs: section.defs, strict: true },
  "sh.unset.follow": { validator: sh.unset.follow.main, defs: follow.defs, strict: true },
  "app.bsky.actor.profile": { validator: app.bsky.actor.profile.main, defs: actorProfile.defs, strict: false },
} satisfies Record<string, { validator: Validator; defs: object; strict: boolean }>;

/**
 * Validates a record in its JSON form (blob refs as `{ $type: "blob", ref: { $link } }`) against its schema. On write
 * our own records may carry only fields the schema defines; the vendored Bluesky profile follows the plain rule.
 */
export function validateRecord(nsid: RecordNsid, value: unknown, mode: Mode): ValidationResult {
  const entry = RECORDS[nsid];
  if (!isObject(value)) return { ok: false, errors: ["$: expected an object"] };
  if (value.$type !== nsid) return { ok: false, errors: [`$.$type: expected "${nsid}"`] };
  const checked = (entry.validator as Validator).$safeValidate(toLex(value));
  if (!checked.success) return { ok: false, errors: [checked.reason.message] };
  const unknown = mode === "write" && entry.strict ? unknownFields(nsid, entry.defs as Defs, "main", value, "$") : [];
  return unknown.length > 0 ? { ok: false, errors: unknown } : { ok: true, value };
}

function toLex(value: Record<string, unknown>): unknown {
  try {
    return jsonToLex(value as Parameters<typeof jsonToLex>[0]);
  } catch {
    return value; // Malformed special objects ($link, $bytes) then fail the schema check with its own message.
  }
}

/**
 * Fields of `value` that the def does not define, following local `#refs` into nested objects and array items. A
 * nested object may name its own def in `$type` (atproto.com/specs/lexicon, "$type"); the root's was checked already.
 * A union member is followed through the local ref its `$type` names; the generated validator has already refused a
 * member a closed union does not list. Properties are looked up as own keys only, so a field named `constructor` is
 * unknown like any other.
 */
function unknownFields(nsid: string, defs: Defs, name: string, value: Record<string, unknown>, path: string): string[] {
  const def = defs[name];
  const props = def?.record?.properties ?? def?.properties ?? {};
  return Object.entries(value).flatMap(([key, child]) => {
    if (key === "$type" && (path === "$" || child === `${nsid}#${name}`)) return [];
    const prop = Object.hasOwn(props, key) ? props[key] : undefined;
    if (!prop) return [`${path}.${key}: unknown field`];
    const field = prop.type === "array" ? prop.items : prop;
    const items = prop.type === "array" && Array.isArray(child) ? child : [child];
    return items.flatMap((item, i) => {
      const ref = isObject(item) && field !== undefined ? localRef(nsid, field, item) : undefined;
      if (ref === undefined || !isObject(item)) return [];
      return unknownFields(nsid, defs, ref, item, prop.type === "array" ? `${path}.${key}[${i}]` : `${path}.${key}`);
    });
  });
}

/** The local def an object at `field` follows: its ref, or the union member its `$type` names; undefined for none. */
function localRef(nsid: string, field: Field, item: Record<string, unknown>): string | undefined {
  if (field.type === "ref") return field.ref?.startsWith("#") ? field.ref.slice(1) : undefined;
  if (field.type !== "union" || typeof item.$type !== "string") return undefined;
  const member = item.$type.startsWith(`${nsid}#`) ? item.$type.slice(nsid.length) : undefined;
  return member !== undefined && field.refs?.includes(member) ? member.slice(1) : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
