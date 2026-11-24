import { definePolicy } from "../../lib/server/policy.ts";

// Asking for an invite while sign-up is invite only (book P2.10r; ADR 0080): anyone may read it, and it runs no script.
// The session is read only to send a member to their own Invite page. A POST counts against the invite-request limit
// (3 an hour per address, 20 a day for the site) and gets 20 s, inside which the owner's mail must go.
export const policy = definePolicy({
  group: "public",
  client: false,
  limit: "default",
  writeLimit: "inviteRequest",
  session: "optional",
  maxBody: 1024,
  deadlineMs: 20_000,
});
