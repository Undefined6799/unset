import { definePolicy } from "../../lib/server/policy.ts";

/**
 * The card save body cap, the same for the gate and the form (Alex, 2026-11-18). The form check stays for a body whose
 * declared length passed: past it the member is told to shorten the card (card.form_too_large).
 */
export const CARD_FORM_LIMIT_BYTES = 2 * 1024 * 1024;

// The member's own page and its card writes (P2.13, ADR 0051, P1.20g, P1.20i). A GET runs for anyone so a path that is
// no DID stays a 404 and anyone but the owner is sent to the public page by the load; a write needs a session and counts against the
// member's own limit; a signed-out request returns to /me after sign-in. 2 MiB (Alex, 2026-11-18 02:17:13Z): the
// largest collection card the lexicon allows is about 1.36 MB as a form, 1.76 MB with a uri the form percent-encodes.
export const policy = definePolicy({
  group: "app",
  limit: "default",
  writeLimit: "profile",
  session: "writes",
  returnTo: "/me",
  maxBody: CARD_FORM_LIMIT_BYTES,
});
