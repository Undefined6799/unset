import { definePolicy } from "../../../../lib/server/policy.ts";

export const policy = definePolicy({
  group: "app",
  limit: "default",
  writeLimit: "profile",
  session: "writes",
  maxBody: 1_024,
  testOnly: true,
});
