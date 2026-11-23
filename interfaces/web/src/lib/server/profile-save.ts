// The saves to the member's own PDS (ADR 0038): the profile, for POST /profile, and who sees the main page, for the
// Privacy save (ADR 0078; on the page since ADR 0091). Each record is built over the stored one by domains/profile and
// written with a compare-and-swap (infrastructure/pds repo-record.ts saveRecord); a dead grant sends the member to
// sign in.
import type { Did } from "@unset/domains-identity";
import { type PageError, type PageVisibility, toProfileRecord, withVisibility } from "@unset/domains-profile";
import { savePageRecord, saveProfileRecord } from "@unset/infrastructure-pds";
import type { SaveProfile } from "../../routes/profile/save.server.ts";
import { services } from "./compose.ts";
import { pdsSignInRedirect } from "./pds-failure.ts";

export const saveToPds =
  (deadline: AbortSignal, deadlineAt: number): SaveProfile =>
  async (did, fields) => {
    const ctx = { memo: new Map(), deadline, deadlineAt };
    const now = new Date().toISOString();
    const result = await saveProfileRecord(services().pds.pdsCall, ctx, did, (existing) =>
      toProfileRecord(fields, existing, now),
    );
    if (result.kind === "ok") return result.value;
    const location = pdsSignInRedirect(result);
    return location === null ? { kind: "unavailable" } : { kind: "redirect", location };
  };

export type PageSave =
  | { readonly kind: "saved" }
  | { readonly kind: "conflict" }
  | { readonly kind: "refused"; readonly code: PageError }
  | { readonly kind: "unavailable" }
  | { readonly kind: "redirect"; readonly location: string };

/** Who sees the member's main page, written to its record; a first choice creates the page with no cards. */
export const savePageVisibility =
  (deadline: AbortSignal, deadlineAt: number) =>
  async (did: Did, visibility: PageVisibility): Promise<PageSave> => {
    const ctx = { memo: new Map(), deadline, deadlineAt };
    const now = new Date().toISOString();
    const result = await savePageRecord(services().pds.pdsCall, ctx, did, (existing) =>
      withVisibility(visibility, existing, now),
    );
    if (result.kind === "ok") return result.value;
    const location = pdsSignInRedirect(result);
    return location === null ? { kind: "unavailable" } : { kind: "redirect", location };
  };
