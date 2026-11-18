import { definePolicy } from "../../../../lib/server/policy.ts";

export const policy = definePolicy({
  group: "app",
  limit: "default",
  session: "required",
  returnTo: "/test-routes/members",
  testOnly: true,
});
