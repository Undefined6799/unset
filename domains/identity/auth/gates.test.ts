// P2.11 (auth/gates.ts): the confirmed-email decision, with no database and no PDS.
import { describe, expect, test } from "vitest";
import {
  CACHED_RECHECK_CAP_MULTIPLE,
  cachedRecheckCapS,
  emailGate,
  requireOnboarded,
  verifiedAfterRefresh,
} from "./gates.ts";

const NOW = Date.parse("2026-10-16T12:00:00Z");
const RECHECK_S = 900;
const cacheAt = (ageMs: number) => ({ confirmed: true as const, checkedAt: new Date(NOW - ageMs) });

describe("email gate", () => {
  test("gate.requireVerified_fresh_true", () => {
    const checkedAt = new Date(NOW - 60_000);
    expect(emailGate({ confirmed: true, checkedAt }, NOW, RECHECK_S)).toBe("pass");
  });

  test("gate.requireVerified_stale_true_pds_down", () => {
    const checkedAt = new Date(NOW - 20 * 60_000);
    expect(emailGate({ confirmed: true, checkedAt }, NOW, RECHECK_S)).toBe("refresh");
    // 20 minutes is inside 4 × 900 s, so a transient recheck still serves the cache.
    expect(verifiedAfterRefresh("transient", { confirmed: true, checkedAt }, NOW, RECHECK_S)).toBe("pass");
  });

  test("gate.requireVerified_transient_past_cap_is_unavailable", () => {
    // The cap is the configured interval times 4, so 60 s caps at 240 s and 900 s caps at 3,600 s.
    expect(CACHED_RECHECK_CAP_MULTIPLE).toBe(4);
    expect(cachedRecheckCapS(900)).toBe(3_600);
    expect(cachedRecheckCapS(60)).toBe(240);
    const capMs = cachedRecheckCapS(RECHECK_S) * 1000;
    expect(verifiedAfterRefresh("transient", cacheAt(capMs), NOW, RECHECK_S)).toBe("pass");
    expect(verifiedAfterRefresh("transient", cacheAt(capMs + 1), NOW, RECHECK_S)).toBe("unavailable");
    expect(verifiedAfterRefresh("transient", cacheAt(241_000), NOW, 60)).toBe("unavailable");
    expect(verifiedAfterRefresh("transient", cacheAt(240_000), NOW, 60)).toBe("pass");
    // No timestamp: the age is unknown, so the cache is not served.
    expect(verifiedAfterRefresh("transient", { confirmed: true, checkedAt: null }, NOW, RECHECK_S)).toBe("unavailable");
  });

  test("gate.requireVerified_past_cap_keeps_auth_dead_and_unconfirmed", () => {
    const past = cacheAt(cachedRecheckCapS(RECHECK_S) * 1000 + 1);
    // P2.11a: a revoked grant is a sign-out, never a request to confirm the email again, and the cap does not
    // turn it into the unavailable page.
    expect(verifiedAfterRefresh("ended", past, NOW, RECHECK_S)).toBe("ended");
    expect(verifiedAfterRefresh("unconfirmed", past, NOW, RECHECK_S)).toBe("verify");
    expect(verifiedAfterRefresh("confirmed", past, NOW, RECHECK_S)).toBe("pass");
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
