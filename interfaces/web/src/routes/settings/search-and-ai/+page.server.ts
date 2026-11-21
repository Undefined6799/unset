// POST /settings/search-and-ai: Settings › Privacy's one save (P1.21y; ADR 0078, P1.22a), for the session's own DID,
// never one from the form (SE-2). The gate has checked the session, the CSRF origin, the body and the limit.
// Who sees the page (`visibility`, sent when the page shows the choice) is written to the member's profile record on
// their PDS first, as POST /profile writes it; then the Search and AI choices (ADR 0062) are saved in Postgres, but
// only while the page is public: a page shown to fewer than everyone is never listed, and its stored choices are kept
// for when it is public again (the form posts them hidden). A save answers 303 back to Settings › Privacy; a refusal
// shows its code and the field to blame. A new visibility waits a few seconds at most for the index the public page
// reads (index-catch-up.ts). The route has no page of its own, so a GET is a 404, as /profile's is.
import { type Actions, error, redirect, type ServerLoad } from "@sveltejs/kit";
import { type ProfileVisibility, parseDiscoverabilityForm, parseProfileVisibility } from "@unset/domains-profile";
import { ERROR_CODES, type ErrorCode } from "@unset/shared-errors";
import { services } from "../../../lib/server/compose.ts";
import { publicPageShows, sleep } from "../../../lib/server/index-catch-up.ts";
import { saveToPds } from "../../../lib/server/profile-save.ts";

export const load: ServerLoad = () => error(404, { message: "http.not_found" });

function refuse(code: ErrorCode, field?: string): never {
  error(ERROR_CODES[code].status, { message: code, ...(field === undefined ? {} : { field }) });
}

/** The form's one `visibility`, or undefined when the page did not offer the choice (no profile, or none read). */
function readVisibility(form: URLSearchParams): ProfileVisibility | undefined {
  const sent = form.getAll("visibility");
  form.delete("visibility");
  if (sent.length === 0) return undefined;
  const visibility = sent.length === 1 ? parseProfileVisibility(sent[0]) : null;
  return visibility ?? refuse("profile.invalid", "visibility");
}

export const actions: Actions = {
  default: async ({ request, locals, setHeaders }) => {
    const did = locals.did;
    if (did === undefined) error(500, { message: "internal.error" }); // the gate let no session through: never guess one
    setHeaders({ "cache-control": "no-store" });
    const form = new URLSearchParams();
    for (const [name, value] of await request.formData()) {
      if (typeof value !== "string") refuse("profile.invalid");
      form.append(name, value);
    }
    const visibility = readVisibility(form);
    // The Search and AI fields count only while the page is public; otherwise they are hidden and not saved, so a
    // value there never blocks restricting who sees the page.
    const listed = visibility === undefined || visibility === "public";
    const parsed = listed ? parseDiscoverabilityForm(form) : null;
    if (parsed !== null && !parsed.ok) refuse(parsed.code, "field" in parsed ? parsed.field : undefined);
    if (visibility !== undefined) {
      const saved = await saveToPds(locals.deadline, locals.deadlineAt)(did, { visibility });
      if (saved.kind === "redirect") redirect(303, saved.location);
      if (saved.kind === "conflict") refuse("profile.conflict");
      if (saved.kind === "refused") refuse(saved.code);
      if (saved.kind === "unavailable") refuse("profile.pds_unavailable");
    }
    if (parsed?.ok) await services().discoverability.save(did, parsed.value, locals.deadline);
    // The public page reads the index, a second or two behind the PDS: "saved" only once it shows the choice, else
    // "pending", so the member is never told a page is hidden while a visitor can still load it (index-catch-up.ts).
    const caughtUp =
      visibility === undefined ||
      (await publicPageShows(visibility, {
        read: async (signal) => (await services().publicProfiles.find({ did }, signal))?.record ?? null,
        now: Date.now,
        sleep,
        signal: locals.deadline,
      }));
    redirect(303, `/settings/privacy?saved${caughtUp ? "" : "=pending"}#privacy`);
  },
};
