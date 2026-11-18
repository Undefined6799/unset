import { definePolicy } from "../../lib/server/policy.ts";

export const policy = definePolicy({ group: "static", limit: "default", probe: true });
