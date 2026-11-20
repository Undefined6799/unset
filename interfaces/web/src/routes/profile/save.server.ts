// The profile save (Alex 2026-10-23: the owner edits their profile in place and saves it to their PDS), as
// interfaces/http/routes/profile.ts decides it. The profile written is always the session's own: the DID comes from
// the session, never the form (SE-2). The fields are read once by domains/profile (DM-1); the record is built over the
// stored one and written with a compare-and-swap (infrastructure/pds/profile-record.ts).
import type { Did } from "@unset/domains-identity";
import {
  PROFILE_FIELDS,
  type ProfileEdit,
  type ProfileError,
  type ProfileInputField,
  parseProfileFields,
} from "@unset/domains-profile";
import type { ErrorCode } from "@unset/shared-errors";

export type ProfileSave =
  | { readonly kind: "saved" }
  | { readonly kind: "conflict" }
  | { readonly kind: "refused"; readonly code: ProfileError }
  | { readonly kind: "unavailable" }
  /** The PDS grant is gone or lacks a scope; the sign-in pages take over. */
  | { readonly kind: "redirect"; readonly location: string };

export type SaveProfile = (did: Did, fields: ProfileEdit) => Promise<ProfileSave>;

/**
 * Where the browser goes next (a 303), or the code of the failure the page shows, with the field to blame when one
 * is (the form marks it, as the card editors do: staging walkthrough 2026-11-18 round two, finding 5).
 */
export type SaveResult =
  | { readonly location: string }
  | { readonly code: ErrorCode; readonly field?: ProfileInputField };

/** The form's `next` when it came from Settings › Profile. */
const SETTINGS_PROFILE = "/settings/profile";
/**
 * Where a save from Settings › Profile returns: the page with `saved`, so a plain form with no script is told it
 * saved, as /invite?left= tells an invite's (P1.20p). A save from the member's own page returns there.
 */
export const SETTINGS_PROFILE_SAVED = "/settings/profile?saved";

/** The form fields a save reads: the text fields and the page layout (ADR 0072). */
const FORM_FIELDS = [...PROFILE_FIELDS, "layout"] as const;

/**
 * Each field's one value; a field left out is not sent, so it keeps what the record holds. A repeated field is
 * refused like a malformed one.
 */
function formFields(form: FormData): Record<string, unknown> | null {
  const input: Record<string, unknown> = {};
  for (const field of FORM_FIELDS) {
    const values = form.getAll(field);
    if (values.length > 1) return null;
    const [value] = values;
    if (value === undefined) continue;
    if (typeof value !== "string") return null; // a file where text belongs
    input[field] = value;
  }
  return input;
}

export async function saveProfileForm(form: FormData, did: Did, save: SaveProfile): Promise<SaveResult> {
  const input = formFields(form);
  if (input === null) return { code: "profile.invalid" };
  const parsed = parseProfileFields(input);
  if (!parsed.ok) return { code: parsed.code, field: parsed.field };
  const saved = await save(did, parsed.fields);
  if (saved.kind === "saved")
    return { location: form.get("next") === SETTINGS_PROFILE ? SETTINGS_PROFILE_SAVED : `/${did}` };
  if (saved.kind === "redirect") return { location: saved.location };
  if (saved.kind === "conflict") return { code: "profile.conflict" };
  if (saved.kind === "refused") return { code: saved.code };
  return { code: "profile.pds_unavailable" };
}
