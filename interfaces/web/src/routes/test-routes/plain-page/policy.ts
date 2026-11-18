import { definePolicy } from "../../../lib/server/policy.ts";

export const policy = definePolicy({ group: "public", limit: "default", testOnly: true });
