import { definePolicy } from "../../../../lib/server/policy.ts";

export const policy = definePolicy({
  group: "app",
  limit: "default",
  writeLimit: "profile",
  session: "writes",
  returnTo: "/test-routes/members",
  maxBody: 1_024,
  testOnly: true,
});
