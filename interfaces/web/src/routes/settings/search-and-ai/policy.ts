import { definePolicy } from "../../../lib/server/policy.ts";

/** Two switches and two short fields, percent-encoded at worst three bytes a byte, with room to spare. */
export const SEARCH_AND_AI_BODY_LIMIT_BYTES = 8 * 1024;

// The Search and AI save (ADR 0062): a signed-in member's own choices, counted against the profile save's limit. A
// signed-out save returns to Settings › Profile after sign-in.
export const policy = definePolicy({
  group: "app",
  limit: "profile",
  session: "required",
  maxBody: SEARCH_AND_AI_BODY_LIMIT_BYTES,
  returnTo: "/settings/profile",
});
