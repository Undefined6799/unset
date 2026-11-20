// POST /settings/search-and-ai: the member's Search and AI choices (ADR 0062) as a form action, saved in Postgres for
// the session's own DID, never one from the form (SE-2). The gate has checked the session, the CSRF origin, the body
// and the limit. A save answers 303 back to Settings › Privacy (P1.21y); a refusal shows its code and the field to blame. The
// route has no page of its own, so a GET is a 404, as /profile's is.
import { type Actions, error, redirect, type ServerLoad } from "@sveltejs/kit";
import { parseDiscoverabilityForm } from "@unset/domains-profile";
import { ERROR_CODES } from "@unset/shared-errors";
import { services } from "../../../lib/server/compose.ts";

export const load: ServerLoad = () => error(404, { message: "http.not_found" });

export const actions: Actions = {
  default: async ({ request, locals, setHeaders }) => {
    const did = locals.did;
    if (did === undefined) error(500, { message: "internal.error" }); // the gate let no session through: never guess one
    const form = new URLSearchParams();
    for (const [name, value] of await request.formData()) {
      if (typeof value !== "string") error(400, { message: "profile.invalid" });
      form.append(name, value);
    }
    const parsed = parseDiscoverabilityForm(form);
    setHeaders({ "cache-control": "no-store" });
    if (!parsed.ok) {
      const blame = "field" in parsed ? { field: parsed.field } : {};
      error(ERROR_CODES[parsed.code].status, { message: parsed.code, ...blame });
    }
    await services().discoverability.save(did, parsed.value, locals.deadline);
    redirect(303, "/settings/privacy?saved#search-and-ai");
  },
};
