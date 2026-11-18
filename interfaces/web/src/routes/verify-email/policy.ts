import { definePolicy } from "../../lib/server/policy.ts";

export const policy = definePolicy({
  group: "app",
  limit: "default",
  writeLimit: "login",
  session: "onboarding",
  maxBody: 1024,
});
