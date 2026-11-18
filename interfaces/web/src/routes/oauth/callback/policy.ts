import { definePolicy } from "../../../lib/server/policy.ts";

// A GET that changes state, bound by the state and nonce, not the Origin check; at the sign-in limit.
export const policy = definePolicy({ group: "app", limit: "login" });
