import { definePolicy } from "../../lib/server/policy.ts";

// A member whose sign-in predates a permission the app now asks for; the button starts a new consent, which counts
// against the sign-in limit as verify-email's does.
export const policy = definePolicy({
  group: "app",
  limit: "default",
  writeLimit: "login",
  session: "required",
  maxBody: 1024,
});
