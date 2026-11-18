import { definePolicy } from "../../lib/server/policy.ts";

// The redirect reads no session (interfaces/http routes/settings.ts, session "none"): it only names the first page.
export const policy = definePolicy({ group: "app", limit: "default" });
