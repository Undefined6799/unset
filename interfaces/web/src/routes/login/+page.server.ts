// GET and POST /login (P2.05, P2.05m, P2.05r): the sign-in box alone, one button to our PDS (only its accounts sign in,
// P1.36v). The POST is the form action; src/lib/server/sign-in.ts does the work.
import { type Actions, redirect, type ServerLoad } from "@sveltejs/kit";
import { readErrorParam } from "@unset/shared-errors";
import { safeReturnPath } from "@unset/shared-http";
import { config } from "../../lib/server/runtime.ts";
import { closeTarget, startSignIn } from "../../lib/server/sign-in.ts";
import type { ShellData } from "../../lib/shell.ts";

export const load: ServerLoad = ({ url, locals, request }) => {
  const error = readErrorParam(url.searchParams);
  // A signed-in visitor has nothing to sign in to, unless a failed sign-in brought them back to read why.
  if (locals.did !== undefined && error === null) redirect(303, "/me");
  // The page runs the client (book P1.22l), so SvelteKit writes this result into the start-up script it hashes. The
  // two values a request can choose, `next` (the query) and `close` (the Referer), are each a `safeReturnPath` or
  // nothing (rule DM-1): a path of ours as the URL parser writes it, percent-encoded, with no quote or angle bracket.
  const next = safeReturnPath(url.searchParams.get("next"));
  // The box alone, with no header or footer, as Hono rendered it (interfaces/http/routes/login.ts passed no shell).
  const shell: ShellData = { kind: "bare" };
  return { next, pdsHost: config.PDS_HOSTNAME, close: closeTarget(request), shell };
};

export const actions: Actions = {
  // P2.05p: the in-place box posts here from public pages too, which cannot vary on the session cookie. A signed-in
  // browser goes to its profile, as on GET, and no authorization starts to replace its session.
  default: async ({ request, cookies, locals }) => {
    if (locals.did !== undefined) redirect(303, "/me");
    return startSignIn(request, cookies, locals.deadline);
  },
};
