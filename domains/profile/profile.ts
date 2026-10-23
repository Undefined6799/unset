// The profile (Alex, 2026-10-23 02:59Z: its own module; identity keeps the atproto session). What a member may write
// on their page, read once from untrusted input into checked fields (DM-1), and the sh.unset.profile record built
// from them. Limits come from the lexicon (shared/lexicons LIMITS, P1.31); graphemes are counted the way the
// lexicon counts them (Intl.Segmenter, https://atproto.com/specs/lexicon#string-formats "maxGraphemes").
import { LIMITS, validateRecord } from "@unset/shared-lexicons";

export const PROFILE_FIELDS = ["displayName", "headline", "location", "website", "readme"] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];
/** Checked fields. An empty string means the field is not set. */
export type ProfileFields = { readonly [K in ProfileField]: string };

export const EMPTY_PROFILE: ProfileFields = { displayName: "", headline: "", location: "", website: "", readme: "" };

export type ProfileError = "profile.invalid" | "profile.too_long" | "profile.url_invalid" | "profile.name_required";
export type ParsedProfile =
  | { readonly ok: true; readonly fields: ProfileFields }
  | { readonly ok: false; readonly field: ProfileField; readonly code: ProfileError };

const GRAPHEMES: Record<ProfileField, number> = {
  displayName: LIMITS.profile.displayName,
  headline: LIMITS.profile.headline,
  location: LIMITS.profile.location,
  website: LIMITS.profile.websiteBytes,
  readme: LIMITS.profile.readme,
};
const MULTILINE: ReadonlySet<ProfileField> = new Set(["readme"]);

const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
function graphemes(text: string, stopAfter: number): number {
  let count = 0;
  for (const _ of segmenter.segment(text)) if (++count > stopAfter) break;
  return count;
}

/** A plain http or https URL with a host and no credentials, as the lexicon's website field expects. */
function isWebsite(text: string): boolean {
  if (!/^https?:\/\//i.test(text)) return false;
  try {
    const url = new URL(text);
    return url.hostname !== "" && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

function checkField(
  field: ProfileField,
  raw: unknown,
): { ok: true; value: string } | { ok: false; code: ProfileError } {
  if (raw === undefined || raw === null) return { ok: true, value: "" };
  if (typeof raw !== "string") return { ok: false, code: "profile.invalid" };
  const value = MULTILINE.has(field) ? raw.replaceAll("\r\n", "\n") : raw.trim();
  if (!MULTILINE.has(field) && /[\r\n]/.test(value)) return { ok: false, code: "profile.invalid" };
  const tooLong =
    field === "website"
      ? new TextEncoder().encode(value).length > GRAPHEMES.website
      : graphemes(value, GRAPHEMES[field]) > GRAPHEMES[field];
  if (tooLong) return { ok: false, code: "profile.too_long" };
  if (field === "website" && value !== "" && !isWebsite(value)) return { ok: false, code: "profile.url_invalid" };
  return { ok: true, value };
}

/** Reads untrusted input (a form or a JSON body) into checked fields; the first bad field is the answer. */
export function parseProfileFields(input: Readonly<Record<string, unknown>>): ParsedProfile {
  const fields: Record<string, string> = {};
  for (const field of PROFILE_FIELDS) {
    const checked = checkField(field, input[field]);
    if (!checked.ok) return { ok: false, field, code: checked.code };
    fields[field] = checked.value;
  }
  return { ok: true, fields: fields as ProfileFields };
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
    const checked = checkField(field, stored[field]);
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
 * The record to write over `existing` (the stored value, or null for a first profile). The fields this page edits
 * are replaced, an emptied one removed; every other field (bio, avatar, listed, ...) is kept as it was, createdAt too.
 * The result passes the lexicon's strict validator or is refused, so a record another client broke is never written
 * back. The lexicon requires a display name, so a profile without one cannot be published.
 */
export function toProfileRecord(
  fields: ProfileFields,
  existing: unknown,
  now: string,
): { readonly ok: true; readonly record: ProfileRecord } | { readonly ok: false; readonly code: ProfileError } {
  if (fields.displayName === "") return { ok: false, code: "profile.name_required" };
  const stored = storedObject(existing);
  const kept = Object.fromEntries(
    Object.entries(stored).filter(([key]) => !(PROFILE_FIELDS as readonly string[]).includes(key) && key !== "$type"),
  );
  const set = Object.fromEntries(PROFILE_FIELDS.filter((field) => fields[field] !== "").map((f) => [f, fields[f]]));
  const createdAt = typeof stored.createdAt === "string" ? stored.createdAt : now;
  const record: ProfileRecord = { $type: "sh.unset.profile", ...kept, ...set, createdAt, updatedAt: now };
  if (!validateRecord("sh.unset.profile", record, "write").ok) return { ok: false, code: "profile.invalid" };
  return { ok: true, record };
}
