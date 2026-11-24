// GET and POST /join?invite=<code> (book P2.10): the page an invite link opens. It shows the code, says what happens
// next and offers one button that starts a sign-up at our PDS, whose form takes the code. The code is never checked
// against the PDS here (that needs admin power) and opening the page never uses it up, so a chat app's link preview
// is harmless. The URL holds a credential: the request log records the route only (server.ts), the edge logs no
// query (deployment/edge/Caddyfile), the page sends no Referer and is never stored.
import { type Actions, redirect, type ServerLoad } from "@sveltejs/kit";
import { joinCode } from "@unset/domains-identity";
import { config } from "../../lib/server/runtime.ts";
import { startSignUp } from "../../lib/server/sign-in.ts";

export const load: ServerLoad = ({ url, locals, setHeaders }) => {
  setHeaders({ "referrer-policy": "no-referrer", "cache-control": "no-store", "x-robots-tag": "noindex" });
  const raw = url.searchParams.get("invite");
  const code = joinCode(raw);
  // The page runs the client (book P1.22l), so SvelteKit writes this result into the start-up script it hashes. Of
  // the query it holds the invite only as a code (letters, digits and dashes, rule DM-1) or as a flag.
  return {
    code,
    // A value that is not a code is never echoed; the page says the link looks broken.
    malformed: raw !== null && code === null,
    signedIn: locals.did !== undefined,
    pdsHost: config.PDS_HOSTNAME,
    countryRule: config.INVITE_COUNTRY_RULE === "on",
  };
};

export const actions: Actions = {
  // A signed-in browser has an account already: no sign-up replaces its session.
  default: async ({ cookies, locals }) => {
    if (locals.did !== undefined) redirect(303, "/me");
    return startSignUp(cookies, locals.deadline, "/join");
  },
};
