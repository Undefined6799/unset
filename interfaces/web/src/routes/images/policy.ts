import { definePolicy } from "../../lib/server/policy.ts";

/**
 * The image upload's body cap (ADR 0070 point 8): a 30,000,000-byte picture (UPLOAD_LIMITS) as a multipart form, with
 * its alt text, caption and boundaries, inside 31 MiB. The form is read into memory, so ADR 0070 point 4's one upload
 * per member and four site-wide hold the memory this takes. No other route's cap changes.
 */
export const IMAGE_UPLOAD_LIMIT_BYTES = 31 * 1024 * 1024;

// The upload itself arrives in P2.21b. A write needs a session and counts against the member's own profile limit.
export const policy = definePolicy({
  group: "app",
  limit: "default",
  writeLimit: "profile",
  session: "required",
  maxBody: IMAGE_UPLOAD_LIMIT_BYTES,
});
