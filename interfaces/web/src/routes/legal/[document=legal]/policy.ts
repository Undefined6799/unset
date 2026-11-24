import { definePolicy } from "../../../lib/server/policy.ts";

// Anyone may read the legal pages; a member's session is read so the header shows them signed in (P1.20k). No app
// gate: a member reads the terms while onboarding. They run the client (ADR 0116; book P1.22g).
export const policy = definePolicy({ group: "public", limit: "default", session: "optional" });
