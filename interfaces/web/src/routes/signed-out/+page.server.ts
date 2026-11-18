// GET and POST /signed-out (P2.08, P2.08b, P2.08s, P2.05s). Signing out of unset.sh does not end the session on the
// sign-in server, so the page points there, at the issuer recorded at sign-in (carried in a single-use Strict cookie
// that only our own POST /logout writes, re-checked here), or at our PDS. "No thanks" posts: it clears the signed-out
// marker, so the next sign-in no longer asks for the password.
import { type Actions, redirect, type ServerLoad } from "@sveltejs/kit";
import { safeHref } from "@unset/shared-safe-href";
import { services } from "../../lib/server/compose.ts";
import { cookieSent, dropCookie, issuerFromCookies } from "../../lib/server/sign-in-state.ts";

/** The account link: the issuer's /account page for ours, its root for another; null unless it is https. */
function accountLink(issuer: string, ours: boolean) {
  const url = new URL(ours ? "/account" : "/", issuer);
  const href = safeHref(url.href, ["https:"]);
  return href === null ? null : { href: href as string, host: url.host, ours };
}

export const load: ServerLoad = ({ request, cookies, locals }) => {
  const header = request.headers.get("cookie");
  // Single use: a reload links our PDS. Another tab that signed in first must not keep the previous account's issuer.
  if (cookieSent(header, "issuer")) dropCookie(cookies, "issuer");
  // A browser signed in again (Back after a new sign-in, a typed URL) is not told it is signed out.
  if (locals.did !== undefined) redirect(303, "/me");
  const { pdsIssuer } = services();
  // "Ours" is string equality with our issuer, never a suffix match (architecture 04:15Z item 4).
  const issuer = issuerFromCookies(header) ?? pdsIssuer;
  return { link: accountLink(issuer, issuer === pdsIssuer), shell: { kind: "site" } as const };
};

export const actions: Actions = {
  default: ({ cookies }) => {
    dropCookie(cookies, "signedOut");
    redirect(303, "/");
  },
};
