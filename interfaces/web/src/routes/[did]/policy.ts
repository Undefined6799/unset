import { definePolicy } from "../../lib/server/policy.ts";

// The member's own page and its card writes (P2.13, ADR 0051, P1.20g, P1.20i). A GET runs for anyone so a path that is
// no DID stays a 404 and a visitor is sent to sign in by the load; a write needs a session and counts against the
// member's own limit; a signed-out request returns to /me after sign-in. 1 MiB as the Hono card routes allowed; a form past 320 KB is refused as card.form_too_large.
export const policy = definePolicy({
  group: "app",
  limit: "default",
  writeLimit: "profile",
  session: "writes",
  returnTo: "/me",
  maxBody: 1024 * 1024,
});
