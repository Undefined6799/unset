import { definePolicy } from "../../../lib/server/policy.ts";

export const policy = definePolicy({
  group: "app",
  limit: "profile",
  session: "required",
  maxBody: 1_024,
  testOnly: true,
});
