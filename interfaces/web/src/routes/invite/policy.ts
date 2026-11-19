import { definePolicy } from "../../lib/server/policy.ts";

// The Invite page (book P2.10): members only, past the app gate (onboarded, confirmed email); a POST counts against
// the invite limit (10 an hour per member). The two forms send a UUID and a checkbox.
export const policy = definePolicy({
  group: "app",
  limit: "default",
  writeLimit: "invite",
  session: "required",
  maxBody: 1024,
});
