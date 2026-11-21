import { definePolicy } from "../../../lib/server/policy.ts";

// The Sign-in history tab and its two forms (P2.27c, ADR 0082): members only, past the app gate, counted against the
// notifications limit like the inbox's forms. Delete selected names at most the 50 sign-ins the page lists, about 40
// bytes each, and nothing else, so 4 KB holds the largest form with room.
export const policy = definePolicy({
  group: "app",
  limit: "default",
  writeLimit: "notifications",
  session: "required",
  maxBody: 4096,
});
