// POST /profile: the profile save as a form action. The gate has checked the method, the form body and its size, the
// session and the member's own save limit (policy.ts), and SvelteKit has refused a cross-site post, before this reads
// anything. It works as a plain form: a save answers 303 to where the member came from; a refusal shows its code.
// The route has no page of its own, so a GET is a 404 as it is under interfaces/http.
import { type Actions, error, redirect, type ServerLoad } from "@sveltejs/kit";
import { toProfileRecord } from "@unset/domains-profile";
import { saveProfileRecord } from "@unset/infrastructure-pds";
import { ERROR_CODES } from "@unset/shared-errors";
import { services } from "../../lib/server/compose.ts";
import { pdsSignInRedirect } from "../../lib/server/pds-failure.ts";
import { type SaveProfile, saveProfileForm } from "./save.server.ts";

export const load: ServerLoad = () => error(404, { message: "http.not_found" });

/** The record built over the stored one, written with a compare-and-swap; a dead grant sends the member to sign in. */
const saveToPds =
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

export const actions: Actions = {
  default: async ({ request, locals, setHeaders }) => {
    const did = locals.did;
    if (did === undefined) error(500, { message: "internal.error" }); // the gate let no session through: never guess one
    const result = await saveProfileForm(await request.formData(), did, saveToPds(locals.deadline, locals.deadlineAt));
    setHeaders({ "cache-control": "no-store" });
    if ("location" in result) redirect(303, result.location);
    const blame = "field" in result && result.field !== undefined ? { field: result.field } : {};
    error(ERROR_CODES[result.code].status, { message: result.code, ...blame });
  },
};
