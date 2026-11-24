import { definePolicy } from "../../../lib/server/policy.ts";

// No session needed: the block has already ended every session of the account (welcome.ts blockUnderage).
export const policy = definePolicy({ group: "app", limit: "default" });
