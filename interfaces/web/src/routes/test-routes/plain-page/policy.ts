import { definePolicy } from "../../../lib/server/policy.ts";

export const policy = definePolicy({ group: "public", client: false, limit: "default", testOnly: true });
