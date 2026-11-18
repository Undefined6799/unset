import { definePolicy } from "../../lib/server/policy.ts";

// The shortcut to the member's own page (P2.13, P1.20g): signed-in only, so a visitor goes to sign in.
export const policy = definePolicy({ group: "app", limit: "default", session: "required" });
