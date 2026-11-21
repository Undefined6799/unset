// The profile save to the member's own PDS (ADR 0038), shared by POST /profile and the Privacy save (ADR 0078): the
// record built over the stored one by domains/profile and written with a compare-and-swap
// (infrastructure/pds/profile-record.ts); a dead grant sends the member to sign in.
import { toProfileRecord } from "@unset/domains-profile";
import { saveProfileRecord } from "@unset/infrastructure-pds";
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
