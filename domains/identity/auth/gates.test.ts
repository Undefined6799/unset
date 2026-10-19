// P2.11 (auth/gates.ts): the confirmed-email decision, with no database and no PDS.
import { describe, expect, test } from "vitest";
import { emailGate, requireOnboarded, verifiedAfterRefresh } from "./gates.ts";

const NOW = Date.parse("2026-10-16T12:00:00Z");
const RECHECK_S = 900;

describe("email gate", () => {
  test("gate.requireVerified_fresh_true", () => {
    const checkedAt = new Date(NOW - 60_000);
    expect(emailGate({ confirmed: true, checkedAt }, NOW, RECHECK_S)).toBe("pass");
  });

  test("gate.requireVerified_stale_true_pds_down", () => {
    const checkedAt = new Date(NOW - 20 * 60_000);
    expect(emailGate({ confirmed: true, checkedAt }, NOW, RECHECK_S)).toBe("refresh");
    expect(verifiedAfterRefresh("transient")).toBe("pass");
  });

  test("gate.requireVerified_ended_grant", () => {
    // P2.11a: a revoked grant is a sign-out, never a request to confirm the email again.
    expect(verifiedAfterRefresh("ended")).toBe("ended");
    expect(verifiedAfterRefresh("unconfirmed")).toBe("verify");
    expect(verifiedAfterRefresh("confirmed")).toBe("pass");
  });

  test("gate.requireVerified_false", () => {
    expect(emailGate({ confirmed: false, checkedAt: new Date(NOW) }, NOW, RECHECK_S)).toBe("verify");
    expect(emailGate({ confirmed: null, checkedAt: null }, NOW, RECHECK_S)).toBe("verify");
  });
});

const VERSIONS = { terms: "2026-10-17", privacy: "2026-10-17" };

describe("onboarding gate", () => {
  test("onboarded.missing_is_welcome", () => {
    expect(requireOnboarded(null, VERSIONS)).toEqual({ outcome: "welcome" });
  });

  test("onboarded.done_passes", () => {
    const account = { onboarding: "done" as const, termsVersion: VERSIONS.terms, privacyVersion: VERSIONS.privacy };
    expect(requireOnboarded(account, VERSIONS)).toEqual({ outcome: "pass", privacyNotice: false });
  });

  test("terms.version_bump", () => {
    const account = { onboarding: "done" as const, termsVersion: "2020-01-01", privacyVersion: VERSIONS.privacy };
    expect(requireOnboarded(account, VERSIONS)).toEqual({ outcome: "terms" });
  });

  test("terms.privacy_bump_notice_only", () => {
    const account = { onboarding: "done" as const, termsVersion: VERSIONS.terms, privacyVersion: "2020-01-01" };
    expect(requireOnboarded(account, VERSIONS)).toEqual({ outcome: "pass", privacyNotice: true });
  });

  test("blocked.signin_again", () => {
    const account = { onboarding: "blocked_underage" as const, termsVersion: null, privacyVersion: null };
    expect(requireOnboarded(account, VERSIONS)).toEqual({ outcome: "blocked" });
  });
});
