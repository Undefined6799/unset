// POST /profile and POST /profile/readme (Alex 2026-10-23: the owner edits their profile and saves it to their PDS;
// the README with BlockNote, 21:08Z). The kit has
// already checked the method, the media type, the body limit and the CSRF gate before this handler reads anything.
// The profile written is always the session's own (the DID comes from the session, never the request). The fields
// are read once by domains/profile (DM-1); the record is built over the stored one and written with a
// compare-and-swap (infrastructure/pds/profile-record.ts). It works as a plain form; the editing island posts the
// same form in the background and reads the 303 as saved.
import type { Did } from "@unset/domains-identity";
import {
  PROFILE_FIELDS,
  type ProfileEdit,
  type ProfileError,
  parseProfileFields,
  parseReadme,
  README_BYTES,
} from "@unset/domains-profile";
import { AppError } from "@unset/shared-errors";
import { defineRoute, type Route } from "@unset/shared-http";
import type { OpenedApp } from "../app-gate.ts";

const FORM = "application/x-www-form-urlencoded";
/** The links' 12 × 2,000 bytes, percent-encoded at worst three bytes a byte, plus the short fields. */
export const PROFILE_BODY_LIMIT_BYTES = 96 * 1024;
/** The README's bytes, percent-encoded at worst three bytes a byte, plus the field name. */
export const README_BODY_LIMIT_BYTES = README_BYTES * 3 + 1024;

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
 * side column). A repeated field is refused like a malformed one.
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

/** Saves the session's own profile and answers as the forms expect: 303 to `saved`, or the failure as an error. */
async function save(deps: ProfileDeps, did: Did, fields: ProfileEdit, deadline: AbortSignal, saved: string) {
  const result = await deps.saveProfile(did, fields, deadline);
  if (result.kind === "saved") return seeOther(saved);
  if (result.kind === "redirect") return seeOther(result.location);
  if (result.kind === "conflict") throw new AppError("profile.conflict");
  if (result.kind === "refused") throw new AppError(result.code);
  throw new AppError("profile.pds_unavailable");
}

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
      const back = form.get("next") === SETTINGS_PROFILE ? SETTINGS_PROFILE : `/${did}`;
      return save(deps, did, parsed.fields, deadline, back);
    },
  }),
  defineRoute({
    method: "POST",
    path: "/profile/readme",
    group: "app",
    accepts: [FORM],
    bodyLimit: README_BODY_LIMIT_BYTES,
    rateLimit: "default",
    mutates: true,
    session: "none",
    handler: async ({ request, deadline }) => {
      const opened = await deps.open(request, deadline, "/did");
      if (opened instanceof Response) return opened;
      // One field: the editor's document as BlockNote JSON, read into the lexicon's blocks by domains/profile.
      const posted = new URLSearchParams(await request.text()).getAll("readme");
      if (posted.length !== 1) throw new AppError("profile.invalid");
      const parsed = parseReadme(posted[0] ?? "");
      if (!parsed.ok) throw new AppError(parsed.code);
      const did = opened.session.did;
      return save(deps, did, { readme: parsed.readme }, deadline, `/${did}`);
    },
  }),
];
