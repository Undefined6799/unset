import { definePolicy } from "../../lib/server/policy.ts";

// Asking for an invite while sign-up is invite only (book P2.10r; ADR 0080): anyone may read it. It runs the client
// (ADR 0116; book P1.22g), and the form posts plainly, with script or without.
// The session is read only to send a member to their own Invite page. A POST counts against the invite-request limit
// (3 an hour per address, 20 a day for the site) and gets 20 s, inside which the owner's mail must go.
export const policy = definePolicy({
  group: "public",
  limit: "default",
  writeLimit: "inviteRequest",
  session: "optional",
  maxBody: 1024,
  deadlineMs: 20_000,
});
