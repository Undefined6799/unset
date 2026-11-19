import { definePolicy } from "../../lib/server/policy.ts";

// The public profile (P3.12s): anyone may read it, and no session is read, so its bytes never depend on a cookie and
// every visitor, the owner included, gets the same page (D7). The public group runs no script. Read only.
export const policy = definePolicy({ group: "public", limit: "default" });
