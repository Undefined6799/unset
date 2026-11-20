import { definePolicy } from "../../lib/server/policy.ts";

/**
 * The image upload's body cap (ADR 0070 point 8): a 30,000,000-byte picture (UPLOAD_LIMITS) as a multipart form, with
 * its alt text, caption and boundaries, inside 31 MiB. The form is read into memory, so ADR 0070 point 4's one upload
 * per member and four site-wide hold the memory this takes. No other route's cap changes.
 */
export const IMAGE_UPLOAD_LIMIT_BYTES = 31 * 1024 * 1024;

// The upload (+server.ts). A write needs a session and counts against the member's own profile limit. Its deadline
// covers a full 64 MiB upload at about 5 Mbit/s (107 s, ADR 0076) and review's 20 s, and stays below the edge's 130 s
// wait for an answer (tests/integration/deployment/edge/timeouts.ts).
export const policy = definePolicy({
  group: "app",
  limit: "default",
  writeLimit: "profile",
  session: "required",
  maxBody: IMAGE_UPLOAD_LIMIT_BYTES,
  deadlineMs: 125_000,
});
