import { definePolicy } from "../lib/server/policy.ts";

// Home: anyone may read it; a member's session is read so the header shows them signed in (P1.20k). It runs the client
// (ADR 0116; book P1.22g), so its page is sent the script policy.
export const policy = definePolicy({ group: "public", limit: "default", session: "optional" });
