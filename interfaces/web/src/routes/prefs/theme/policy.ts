import { definePolicy } from "../../../lib/server/policy.ts";

// A plain form with no session (P1.22): the theme is chosen on any page, signed in or not. 2 KB as today.
export const policy = definePolicy({ group: "app", client: false, limit: "default", maxBody: 2_048 });
