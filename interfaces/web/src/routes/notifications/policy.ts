import { definePolicy } from "../../lib/server/policy.ts";

// The notifications page and its two forms (P2.27, ADR 0081): members only, past the app gate. A POST counts against
// the notifications limit (limits.ts). Dismiss selected names at most the 50 entries the page lists, about 40 bytes
// each, and a return path, so 4 KB holds the largest form with room.
export const policy = definePolicy({
  group: "app",
  limit: "default",
  writeLimit: "notifications",
  session: "required",
  maxBody: 4096,
});
