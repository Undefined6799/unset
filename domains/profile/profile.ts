// The profile (Alex, 2026-10-23 02:59Z: its own module; identity keeps the atproto session). What a member may write
// on their page, read once from untrusted input into checked fields (DM-1), and the sh.unset.profile record built
// from them. Limits come from the lexicon (shared/lexicons LIMITS, P1.31); graphemes are counted the way the
// lexicon counts them (Intl.Segmenter, https://atproto.com/specs/lexicon#string-formats "maxGraphemes").
import { LIMITS, validateRecord } from "@unset/shared-lexicons";
import { fitsIndex } from "./index-plan.ts";
import { isPlainName, isPlainText } from "./member-text.ts";
import { isWebAddress, withScheme } from "./web-address.ts";

export const PROFILE_FIELDS = ["displayName", "headline", "location", "website"] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];
/** Checked fields. An empty string means the field is not set. Links live on Links cards (ADR 0051). */
export type ProfileFields = { readonly [K in ProfileField]: string };

export const EMPTY_PROFILE: ProfileFields = {
  displayName: "",
  headline: "",
  location: "",
  website: "",
};

export type ProfileError = "profile.invalid" | "profile.too_long" | "profile.url_invalid" | "profile.name_required";
/** The fields one save sends; a field left out keeps what the record holds (Settings › Profile). */
export type ProfileEdit = Partial<ProfileFields>;
export type ParsedProfile =
  | { readonly ok: true; readonly fields: ProfileEdit }
  | { readonly ok: false; readonly field: ProfileField; readonly code: ProfileError };

/**
 * What the editor accepts. The lexicon's limits are permanent once published, so they sit above these, which the
 * product may change (ADR 0051): the headline is one line of 120 under a schema limit of 200.
 */
type FieldLimits = Readonly<Record<Exclude<ProfileField, "website">, number>>;
export const APP_LIMITS = {
  displayName: LIMITS.profile.displayName,
  headline: 120,
  location: LIMITS.profile.location,
} as const satisfies FieldLimits;

const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
function graphemes(text: string, stopAfter: number): number {
  let count = 0;
  for (const _ of segmenter.segment(text)) if (++count > stopAfter) break;
  return count;
}

type Checked = { ok: true; value: string } | { ok: false; code: ProfileError };

const bytes = (text: string) => new TextEncoder().encode(text).length;

/** What a stored record may hold: the lexicon's limits, so a field another client wrote validly still shows. */
const READ_LIMITS = {
  displayName: LIMITS.profile.displayName,
  headline: LIMITS.profile.headline,
  location: LIMITS.profile.location,
} as const satisfies FieldLimits;

/** `limits` is APP_LIMITS for an edit and READ_LIMITS for a stored record. */
function checkField(field: ProfileField, raw: unknown, limits: FieldLimits = APP_LIMITS): Checked {
  if (raw === undefined || raw === null) return { ok: true, value: "" };
  if (typeof raw !== "string") return { ok: false, code: "profile.invalid" };
  const trimmed = raw.trim();
  const value = field === "website" && trimmed !== "" ? withScheme(trimmed) : trimmed;
  // One line of printable text; the name also has no bidi control or invisible character (member-text.ts).
  if (!(field === "displayName" ? isPlainName(value) : isPlainText(value, false))) {
    return { ok: false, code: "profile.invalid" };
  }
  const tooLong =
    field === "website" ? bytes(value) > LIMITS.profile.websiteBytes : graphemes(value, limits[field]) > limits[field];
  if (tooLong) return { ok: false, code: "profile.too_long" };
  if (field === "website" && value !== "" && !isWebAddress(value)) return { ok: false, code: "profile.url_invalid" };
  return { ok: true, value };
}

/** Reads untrusted input (a form or a JSON body) into checked fields; the first bad field is the answer. */
export function parseProfileFields(input: Readonly<Record<string, unknown>>): ParsedProfile {
  const fields: Record<string, string> = {};
  for (const field of PROFILE_FIELDS) {
    if (input[field] === undefined) continue;
    const checked = checkField(field, input[field]);
    if (!checked.ok) return { ok: false, field, code: checked.code };
    fields[field] = checked.value;
  }
  return { ok: true, fields };
}

/**
 * The fields of a record read back from a member's PDS. Another client may have written it, so each field is
 * checked on its own and a bad one reads as unset: the page still shows the rest.
 */
export function readProfileRecord(value: unknown): ProfileFields {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return EMPTY_PROFILE;
  const stored = value as Readonly<Record<string, unknown>>;
  const fields: Record<string, string> = {};
  for (const field of PROFILE_FIELDS) {
    const checked = checkField(field, stored[field], READ_LIMITS);
    fields[field] = checked.ok ? checked.value : "";
  }
  return fields as ProfileFields;
}

export type ProfileRecord = { readonly $type: "sh.unset.profile"; readonly createdAt: string } & Readonly<
  Record<string, unknown>
>;

function storedObject(existing: unknown): Readonly<Record<string, unknown>> {
  return typeof existing === "object" && existing !== null && !Array.isArray(existing)
    ? (existing as Readonly<Record<string, unknown>>)
    : {};
}

/**
 * The record to write over `existing` (the stored value, or null for a first profile). The fields sent are replaced, an
 * emptied one removed; every other field (one not sent, avatar, listed,
 * ...) is kept as it was, createdAt too.
 * A stored field the lexicon does not define (another client's, or a newer release's) is kept too: unexpected fields
 * are ignored and kept, never a reason to refuse (atproto.com/specs/lexicon, "Authority and Control"; ADR 0038).
 * Every field the lexicon defines must still be valid, so a record another client broke is never written back. The
 * fields we set come from parseProfileFields, so they are never unknown. The lexicon requires a display name, so a
 * profile without one cannot be published.
 */
export function toProfileRecord(
  fields: ProfileEdit,
  existing: unknown,
  now: string,
): { readonly ok: true; readonly record: ProfileRecord } | { readonly ok: false; readonly code: ProfileError } {
  const stored = storedObject(existing);
  const sent: readonly string[] = PROFILE_FIELDS.filter((field) => fields[field] !== undefined);
  const kept = Object.fromEntries(Object.entries(stored).filter(([key]) => !sent.includes(key) && key !== "$type"));
  const set: Record<string, string> = {};
  for (const field of PROFILE_FIELDS) {
    const value = fields[field];
    if (value !== undefined && value !== "") set[field] = value;
  }
  const merged: Record<string, unknown> = { ...kept, ...set };
  if (typeof merged.displayName !== "string" || merged.displayName === "") {
    return { ok: false, code: "profile.name_required" };
  }
  const createdAt = typeof stored.createdAt === "string" ? stored.createdAt : now;
  const record: ProfileRecord = { $type: "sh.unset.profile", ...merged, createdAt };
  if (!validateRecord("sh.unset.profile", record, "read").ok) return { ok: false, code: "profile.invalid" };
  // The index must keep what is written, or the public page would go missing (index-plan.ts, book P3.12v).
  if (!fitsIndex(record)) return { ok: false, code: "profile.too_long" };
  return { ok: true, record };
}

/** How the avatar is cropped (ADR 0051; the lexicon's avatarShape known values). */
export type AvatarShape = "round" | "roundedSquare";
const AVATAR_SHAPES: readonly AvatarShape[] = ["round", "roundedSquare"];
/** Each shape as the record stores it: the lexicon's kebab-case known values (ADR 0086). */
const AVATAR_SHAPE_VALUES: Readonly<Record<AvatarShape, string>> = { round: "round", roundedSquare: "rounded-square" };

/** A form's shape, or null when it is not one we know (DM-1). */
export function parseAvatarShape(input: unknown): AvatarShape | null {
  return AVATAR_SHAPES.find((shape) => shape === input) ?? null;
}

/** The stored shape: absent or unknown means round (the lexicon's description). */
export function readAvatarShape(value: unknown): AvatarShape {
  const stored = storedObject(value).avatarShape;
  return AVATAR_SHAPES.find((shape) => AVATAR_SHAPE_VALUES[shape] === stored) ?? "round";
}

/** The profile record with its avatar shape set; every other field is kept, as toProfileRecord keeps it. */
export function withAvatarShape(
  shape: AvatarShape,
  existing: unknown,
  now: string,
): { readonly ok: true; readonly record: ProfileRecord } | { readonly ok: false; readonly code: ProfileError } {
  const built = toProfileRecord({}, existing, now);
  if (!built.ok) return built;
  const record: ProfileRecord = { ...built.record, avatarShape: AVATAR_SHAPE_VALUES[shape] };
  if (!validateRecord("sh.unset.profile", record, "read").ok) return { ok: false, code: "profile.invalid" };
  return { ok: true, record };
}
