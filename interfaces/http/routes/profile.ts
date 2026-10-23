// POST /profile (Alex 2026-10-23: the owner edits their profile in place and saves it to their PDS). The kit has
// already checked the method, the media type, the body limit and the CSRF gate before this handler reads anything.
// The profile written is always the session's own (the DID comes from the session, never the request). The fields
// are read once by domains/profile (DM-1); the record is built over the stored one and written with a
// compare-and-swap (infrastructure/pds/profile-record.ts). It works as a plain form; the editing island posts the
// same form in the background and reads the 303 as saved.
import type { Did } from "@unset/domains-identity";
import { PROFILE_FIELDS, type ProfileEdit, type ProfileError, parseProfileFields } from "@unset/domains-profile";
import { AppError } from "@unset/shared-errors";
import { defineRoute, type Route } from "@unset/shared-http";
import type { OpenedApp } from "../app-gate.ts";

const FORM = "application/x-www-form-urlencoded";
/**
 * The readme's 100,000-byte lexicon bound and the links' 12 × 2,000 bytes, percent-encoded at worst three bytes a
 * byte, plus the short fields.
 */
export const PROFILE_BODY_LIMIT_BYTES = 400 * 1024;

export type ProfileSave =
  | { readonly kind: "saved" }
  | { readonly kind: "conflict" }
  | { readonly kind: "refused"; readonly code: ProfileError }
  | { readonly kind: "unavailable" }
  /** The PDS grant is gone or lacks a scope; the sign-in pages take over. */
  | { readonly kind: "redirect"; readonly location: string };

export type ProfileDeps = {
  open: (request: Request, deadline: AbortSignal, next: string) => Promise<Response | OpenedApp>;
  saveProfile: (did: Did, fields: ProfileEdit, deadline: AbortSignal) => Promise<ProfileSave>;
};

/**
 * Each field's one value; a field left out is not sent, so it keeps what the record holds (Settings › Profile edits the
 * side column, the profile page the README). A repeated field is refused like a malformed one.
 */
function formFields(form: URLSearchParams): Record<string, unknown> | null {
  const input: Record<string, unknown> = {};
  for (const field of PROFILE_FIELDS) {
    const values = form.getAll(field);
    if (values.length > 1) return null;
    if (values.length === 1) input[field] = values[0];
  }
  return input;
}

/** Where a saved form returns: Settings › Profile when it came from there, else the member's own page. */
const SETTINGS_PROFILE = "/settings/profile";

const seeOther = (location: string) =>
  new Response(null, { status: 303, headers: { location, "cache-control": "no-store" } });

export const profileRoutes = (deps: ProfileDeps): Route[] => [
  defineRoute({
    method: "POST",
    path: "/profile",
    group: "app",
    accepts: [FORM],
    bodyLimit: PROFILE_BODY_LIMIT_BYTES,
    rateLimit: "default",
    mutates: true,
    session: "none",
    handler: async ({ request, deadline }) => {
      const opened = await deps.open(request, deadline, "/did");
      if (opened instanceof Response) return opened;
      const form = new URLSearchParams(await request.text());
      const input = formFields(form);
      if (input === null) throw new AppError("profile.invalid");
      const parsed = parseProfileFields(input);
      if (!parsed.ok) throw new AppError(parsed.code);
      const did = opened.session.did;
      const saved = await deps.saveProfile(did, parsed.fields, deadline);
      if (saved.kind === "saved") return seeOther(form.get("next") === SETTINGS_PROFILE ? SETTINGS_PROFILE : `/${did}`);
      if (saved.kind === "redirect") return seeOther(saved.location);
      if (saved.kind === "conflict") throw new AppError("profile.conflict");
      if (saved.kind === "refused") throw new AppError(saved.code);
      throw new AppError("profile.pds_unavailable");
    },
  }),
];
