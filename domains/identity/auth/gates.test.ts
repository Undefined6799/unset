// P2.11 (auth/gates.ts): the confirmed-email decision, with no database and no PDS.
import { describe, expect, test } from "vitest";
import { emailGate, verifiedAfterRefresh } from "./gates.ts";

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

  test("gate.requireVerified_false", () => {
    expect(emailGate({ confirmed: false, checkedAt: new Date(NOW) }, NOW, RECHECK_S)).toBe("verify");
    expect(emailGate({ confirmed: null, checkedAt: null }, NOW, RECHECK_S)).toBe("verify");
  });
});
