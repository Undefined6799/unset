// GET /me (P2.13, P1.20g): the signed-in member's own page lives at /<DID>; this sends them there. The gate has already
// sent a visitor to sign in. The DID is the session store's, which keeps only DIDs the sign-in callback parsed.
import type { RequestHandler } from "@sveltejs/kit";

export const GET: RequestHandler = ({ locals }) => {
  if (locals.did === undefined) return new Response("auth.required\n", { status: 401 }); // the gate already refused this
  return new Response(null, {
    status: 303,
    headers: { location: `/${locals.did}`, "cache-control": "private, no-store", vary: "Cookie" },
  });
};
