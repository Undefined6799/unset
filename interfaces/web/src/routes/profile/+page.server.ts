// POST /profile: the profile save as a form action. The gate has checked the method, the form body and its size, the
// session and the member's own save limit (policy.ts), and SvelteKit has refused a cross-site post, before this reads
// anything. It works as a plain form: a save answers 303 to where the member came from; a refusal shows its code.
// The route has no page of its own, so a GET is a 404 as it is under interfaces/http.
import { type Actions, error, redirect, type ServerLoad } from "@sveltejs/kit";
import { ERROR_CODES } from "@unset/shared-errors";
import { saveToPds } from "../../lib/server/profile-save.ts";
import { saveProfileForm } from "./save.server.ts";

export const load: ServerLoad = () => error(404, { message: "http.not_found" });

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
