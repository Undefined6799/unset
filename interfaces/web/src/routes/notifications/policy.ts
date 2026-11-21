import { definePolicy } from "../../lib/server/policy.ts";

// The notifications page and its two forms (P2.27): members only, past the app gate. A POST counts against the
// notifications limit (limits.ts); each form sends a kind, a time or version and a return path, so 1 KB.
export const policy = definePolicy({
  group: "app",
  limit: "default",
  writeLimit: "notifications",
  session: "required",
  maxBody: 1024,
});
