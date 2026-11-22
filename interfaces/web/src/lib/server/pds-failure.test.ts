// What a web route does when a call to the member's PDS fails (phase-2.md P2.13 item 7): moved here from
// infrastructure/pds (P1.20k), which knows nothing of the web's pages. P1.21c kept only the answer its callers use.
import { expect, test } from "vitest";
import { pdsSignInRedirect } from "./pds-failure.ts";

test("pdsSignInRedirect sends only an ended grant or a missing scope to sign in", () => {
  expect(pdsSignInRedirect({ kind: "scope_missing" })).toBe("/allow");
  expect(pdsSignInRedirect({ kind: "auth_dead" })).toBe("/login?error=login.session_ended");
  expect(pdsSignInRedirect({ kind: "transient", code: "pds_unavailable" })).toBeNull();
  expect(pdsSignInRedirect({ kind: "transient", code: "pds_rate_limited" })).toBeNull();
  expect(pdsSignInRedirect({ kind: "rejected", xrpcError: "InvalidRequest", status: 400 })).toBeNull();
});
