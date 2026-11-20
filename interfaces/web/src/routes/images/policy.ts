import { definePolicy } from "../../lib/server/policy.ts";

/**
 * The image upload's body cap (ADR 0070 point 8, raised by ADR 0076): a 64 MiB picture (UPLOAD_LIMITS) as a multipart
 * form, with its alt text, caption and boundaries, inside 65 MiB. The form is read into memory, so ADR 0070 point 4's one upload
 * per member and four site-wide hold the memory this takes. No other route's cap changes.
 */
export const IMAGE_UPLOAD_LIMIT_BYTES = 65 * 1024 * 1024;

// The upload (+server.ts). A write needs a session and counts against the member's own profile limit. The body may
// take the edge's whole read window (120 s, limits.json EDGE_READ_BODY_S): a 64 MiB picture at about 5 Mbit/s takes
// 107 s (ADR 0076). Once it is read, the route has 100 s for review and the store, below the 130 s the edge waits for
// an answer after it has sent the body on (snippets/upstream.caddy response_header_timeout, which Go starts "after
// fully writing the request (including its body)": go1.24.7 net/http/transport.go:226-230, roundTrip :2835).
export const policy = definePolicy({
  group: "app",
  limit: "default",
  writeLimit: "profile",
  session: "required",
  maxBody: IMAGE_UPLOAD_LIMIT_BYTES,
  bodyWindowMs: 120_000,
  deadlineMs: 100_000,
});
