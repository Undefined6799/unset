import { definePolicy } from "../../lib/server/policy.ts";

// robots.txt (ADR 0062): anyone may read it; no session is read, so it never depends on a cookie.
export const policy = definePolicy({ group: "static", limit: "default" });
