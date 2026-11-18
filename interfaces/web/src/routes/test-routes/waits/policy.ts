import { definePolicy } from "../../../lib/server/policy.ts";

export const policy = definePolicy({ group: "static", limit: "default", deadlineMs: 1_000, testOnly: true });
