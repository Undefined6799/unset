// GET and POST /login (P2.05, P2.05m, P2.05r): the sign-in box alone, one button to our PDS (only its accounts sign in,
// P1.36v). The POST is the form action; src/lib/server/sign-in.ts does the work.
import { type Actions, redirect, type ServerLoad } from "@sveltejs/kit";
import { ERROR_MESSAGES, readErrorParam } from "@unset/shared-errors";
import { safeReturnPath } from "@unset/shared-http";
import { config } from "../../lib/server/runtime.ts";
import { closeTarget, startSignIn } from "../../lib/server/sign-in.ts";

export const load: ServerLoad = ({ url, locals, request }) => {
  const error = readErrorParam(url.searchParams);
  // A signed-in visitor has nothing to sign in to, unless a failed sign-in brought them back to read why.
  if (locals.did !== undefined && error === null) redirect(303, "/me");
  const next = safeReturnPath(url.searchParams.get("next"));
  // Only a public code has a message; any other shows none.
  const message = error === null ? null : (ERROR_MESSAGES[error as keyof typeof ERROR_MESSAGES] ?? null);
  return { next, message, pdsHost: config.PDS_HOSTNAME, close: closeTarget(request, next) };
};

export const actions: Actions = {
  // P2.05p: the in-place box posts here from public pages too, which cannot vary on the session cookie. A signed-in
  // browser goes to its profile, as on GET, and no authorization starts to replace its session.
  default: async ({ request, cookies, locals }) => {
    if (locals.did !== undefined) redirect(303, "/me");
    return startSignIn(request, cookies, locals.deadline);
  },
};
