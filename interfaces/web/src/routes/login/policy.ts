import { definePolicy } from "../../lib/server/policy.ts";

// The sign-in form: reads at the page limit, the POST at the sign-in limit (interfaces/http limits.ts `login`).
export const policy = definePolicy({
  group: "app",
  client: false,
  limit: "default",
  writeLimit: "login",
  maxBody: 2048,
});
