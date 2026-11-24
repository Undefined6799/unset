import { definePolicy } from "../lib/server/policy.ts";

// Home: anyone may read it; a member's session is read so the header shows them signed in (P1.20k).
export const policy = definePolicy({ group: "public", client: false, limit: "default", session: "optional" });
