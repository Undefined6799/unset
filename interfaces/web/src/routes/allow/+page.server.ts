// GET /allow and its reconsent action. A write the member's grant does not cover (the PDS's 403 ScopeMissingError,
// infrastructure/pds pds-errors.ts) comes here (pds-failure.ts): their sign-in predates a permission the app now asks
// for, so the app explains it and, on the member's press, starts a new authorization with prompt=consent for the same
// account, as verify-email's reconsent does. Nothing is lost on the way: the page keeps unsaved words in this device's
// drafts and offers them back on return (/me sends the member to their page).
import { type Actions, error, redirect, type ServerLoad } from "@sveltejs/kit";
import { withErrorParam } from "@unset/shared-errors";
import { safeReturnPath } from "@unset/shared-http";
import { startAuthorization } from "../../lib/server/sign-in.ts";
import { encodeTarget, putCookie } from "../../lib/server/sign-in-state.ts";

const SHELL = { kind: "core", noindex: true } as const;

export const load: ServerLoad = ({ setHeaders }) => {
  setHeaders({ "x-robots-tag": "noindex", "cache-control": "no-store" });
  return { shell: SHELL };
};

export const actions: Actions = {
  reconsent: async ({ locals, cookies }) => {
    const did = locals.did;
    if (did === undefined) error(500, { message: "internal.error" }); // the gate let no session through: never guess one
    const sent = await startAuthorization({
      input: did,
      expectedDid: did,
      next: safeReturnPath("/me"),
      prompt: "consent",
      deadline: locals.deadline,
    });
    if (!sent.ok) redirect(303, withErrorParam("/allow", sent.code));
    putCookie(cookies, "nonce", sent.nonce);
    putCookie(cookies, "target", encodeTarget(sent.target));
    redirect(303, "/login/continue");
  },
};
