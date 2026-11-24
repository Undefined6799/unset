import { definePolicy } from "../../../lib/server/policy.ts";

export const policy = definePolicy({ group: "app", client: false, limit: "default" });
