import { definePolicy } from "../../lib/server/policy.ts";

// The public profile (P3.12s): anyone may read it. The session is read when a cookie is sent and never required
// (ADR 0078), so a page shown to signed-in members only, or to its member only, can tell who is looking; a page
// rendered for a member is private and never stored, and every answer varies on Cookie (hooks.server.ts). Read only.
export const policy = definePolicy({ group: "public", limit: "default", session: "optional" });
