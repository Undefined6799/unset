// The profile (Alex, 2026-10-23 02:59Z: its own module; identity keeps the atproto session). What a member may write
// on their page, read once from untrusted input into checked fields (DM-1), and the sh.unset.profile record built
// from them. Limits come from the lexicon (shared/lexicons LIMITS, P1.31); graphemes are counted the way the
// lexicon counts them (Intl.Segmenter, https://atproto.com/specs/lexicon#string-formats "maxGraphemes").
import { LIMITS, validateRecord } from "@unset/shared-lexicons";
import { type Readme, readStoredReadme } from "./readme.ts";
import { isWebsite, withScheme } from "./web-address.ts";

export const PROFILE_FIELDS = ["displayName", "headline", "location", "website", "links"] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];
/**
 * Checked fields. An empty string means the field is not set. `links` holds one URL a line, the way a form sends
 * them; the record stores them as the lexicon's link objects (Alex 2026-10-23 04:06Z: members add their own links).
 */
export type ProfileFields = { readonly [K in ProfileField]: string };

export const EMPTY_PROFILE: ProfileFields = {
  displayName: "",
  headline: "",
  location: "",
  website: "",
  links: "",
};

export type ProfileError = "profile.invalid" | "profile.too_long" | "profile.url_invalid" | "profile.name_required";
/**
 * The fields one save sends; a field left out keeps what the record holds (Settings › Profile, the README editor). The
 * README comes from parseReadme; an empty one is removed.
 */
export type ProfileEdit = Partial<ProfileFields> & { readonly readme?: Readme };
export type ParsedProfile =
  | { readonly ok: true; readonly fields: ProfileEdit }
  | { readonly ok: false; readonly field: ProfileField; readonly code: ProfileError };

const GRAPHEMES: Record<Exclude<ProfileField, "links" | "website">, number> = {
  displayName: LIMITS.profile.displayName,
  headline: LIMITS.profile.headline,
  location: LIMITS.profile.location,
};
const MULTILINE: ReadonlySet<ProfileField> = new Set(["links"]);

const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
function graphemes(text: string, stopAfter: number): number {
  let count = 0;
  for (const _ of segmenter.segment(text)) if (++count > stopAfter) break;
  return count;
}

type Checked = { ok: true; value: string } | { ok: false; code: ProfileError };

const bytes = (text: string) => new TextEncoder().encode(text).length;

/** One URL a line: blank lines dropped, at most linksMax, each a plain http(s) URL within its byte bound. */
function checkLinks(raw: string): Checked {
  const links = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map(withScheme);
  if (links.length > LIMITS.profile.linksMax) return { ok: false, code: "profile.too_long" };
  if (links.some((link) => bytes(link) > LIMITS.profile.linkUriBytes)) return { ok: false, code: "profile.too_long" };
  if (!links.every(isWebsite)) return { ok: false, code: "profile.url_invalid" };
  return { ok: true, value: links.join("\n") };
}

function checkField(field: ProfileField, raw: unknown): Checked {
  if (raw === undefined || raw === null) return { ok: true, value: "" };
  if (typeof raw !== "string") return { ok: false, code: "profile.invalid" };
  if (field === "links") return checkLinks(raw);
  const trimmed = MULTILINE.has(field) ? raw.replaceAll("\r\n", "\n") : raw.trim();
  const value = field === "website" && trimmed !== "" ? withScheme(trimmed) : trimmed;
  if (!MULTILINE.has(field) && /[\r\n]/.test(value)) return { ok: false, code: "profile.invalid" };
  const tooLong =
    field === "website"
      ? bytes(value) > LIMITS.profile.websiteBytes
      : graphemes(value, GRAPHEMES[field]) > GRAPHEMES[field];
  if (tooLong) return { ok: false, code: "profile.too_long" };
  if (field === "website" && value !== "" && !isWebsite(value)) return { ok: false, code: "profile.url_invalid" };
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

/** The stored link objects as one URL a line; anything else reads as a bad value, so as no links. */
function storedLinks(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return 0;
  const uris = value.map((link: unknown) =>
    typeof link === "object" && link !== null ? (link as { uri?: unknown }).uri : undefined,
  );
  return uris.every((uri) => typeof uri === "string" && !/[\r\n]/.test(uri)) ? uris.join("\n") : 0;
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
    const checked = checkField(field, field === "links" ? storedLinks(stored.links) : stored[field]);
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
 * emptied one removed; every other field (one not sent, bio, avatar, listed, ...) is kept as it was, createdAt too.
 * The result passes the lexicon's strict validator or is refused, so a record another client broke is never written
 * back. The lexicon requires a display name, so a profile without one cannot be published.
 */
export function toProfileRecord(
  fields: ProfileEdit,
  existing: unknown,
  now: string,
): { readonly ok: true; readonly record: ProfileRecord } | { readonly ok: false; readonly code: ProfileError } {
  const stored = storedObject(existing);
  const sentFields = PROFILE_FIELDS.filter((field) => fields[field] !== undefined);
  // A README the staging preview stored as markdown is rewritten as blocks, or the record would not validate.
  const nextReadme = fields.readme ?? (typeof stored.readme === "string" ? readStoredReadme(stored.readme) : undefined);
  const sent: readonly string[] = nextReadme === undefined ? sentFields : [...sentFields, "readme"];
  const kept = Object.fromEntries(Object.entries(stored).filter(([key]) => !sent.includes(key) && key !== "$type"));
  const set = Object.fromEntries(
    sentFields
      .filter((field) => fields[field] !== "")
      .map((f) => (f === "links" ? [f, (fields.links ?? "").split("\n").map((uri) => ({ uri }))] : [f, fields[f]])),
  );
  const readme = nextReadme !== undefined && nextReadme.blocks.length > 0 ? { readme: nextReadme } : {};
  const merged: Record<string, unknown> = { ...kept, ...set, ...readme };
  if (typeof merged.displayName !== "string" || merged.displayName === "") {
    return { ok: false, code: "profile.name_required" };
  }
  const createdAt = typeof stored.createdAt === "string" ? stored.createdAt : now;
  const record: ProfileRecord = { $type: "sh.unset.profile", ...merged, createdAt, updatedAt: now };
  if (!validateRecord("sh.unset.profile", record, "write").ok) return { ok: false, code: "profile.invalid" };
  return { ok: true, record };
}
