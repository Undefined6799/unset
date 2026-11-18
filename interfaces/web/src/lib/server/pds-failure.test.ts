// What a web route does when a call to the member's PDS fails (phase-2.md P2.13 item 7): moved here from
// infrastructure/pds (P1.20k), which knows nothing of the web's pages. The cases are the ones it had there.
import { expect, test } from "vitest";
import { respondToPdsFailure } from "./pds-failure.ts";

test("respondToPdsFailure maps the book's pages", () => {
  expect(respondToPdsFailure("POST", { kind: "transient", code: "pds_unavailable" }, "pds.test")).toEqual({
    action: "notice",
    status: 503,
    text: "pds.test is not answering; your session is kept",
  });
  expect(respondToPdsFailure("GET", { kind: "transient", code: "pds_rate_limited" }, "pds.test")).toMatchObject({
    status: 200,
  });
  expect(respondToPdsFailure("GET", { kind: "scope_missing" }, "pds.test")).toEqual({
    action: "redirect",
    location: "/verify-email?error=login.scope_insufficient",
  });
  expect(respondToPdsFailure("GET", { kind: "auth_dead" }, "pds.test")).toMatchObject({
    action: "redirect",
    location: "/login?error=login.session_ended",
  });
  expect(
    respondToPdsFailure("POST", { kind: "rejected", xrpcError: "InvalidRequest", status: 400 }, "pds.test"),
  ).toEqual({
    action: "rejected",
    xrpcError: "InvalidRequest",
    status: 400,
  });
});
