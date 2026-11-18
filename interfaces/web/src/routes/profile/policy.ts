import { definePolicy } from "../../lib/server/policy.ts";

/** The side column's short fields, percent-encoded at worst three bytes a byte, with room to spare (as Hono's). */
export const PROFILE_BODY_LIMIT_BYTES = 96 * 1024;

export const policy = definePolicy({
  group: "app",
  limit: "profile",
  session: "required",
  maxBody: PROFILE_BODY_LIMIT_BYTES,
  // A signed-out save comes back to the member's own page after sign-in (interfaces/http sent /did, now /me).
  returnTo: "/me",
});
