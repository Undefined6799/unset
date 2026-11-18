import { describe, expect, test } from "vitest";
import { accountQuota, globalQuota, utcMidnight } from "../../../interfaces/pds-admin/quota.ts";

const HOUR = 3_600_000;
const WINDOW = 24 * HOUR;
const NOW = Date.UTC(2026, 10, 18, 12);

describe("accountQuota", () => {
  test("issue.quota_window: four in the window leaves one, five refuses until the oldest leaves", () => {
    const four = [1, 2, 3, 4].map((h) => NOW - h * HOUR);
    expect(accountQuota(four, NOW, WINDOW, 5)).toEqual({
      ok: true,
      remaining: 0,
      availableAt: NOW - 4 * HOUR + WINDOW,
    });
    const five = [...four, NOW - 5 * HOUR];
    expect(accountQuota(five, NOW, WINDOW, 5)).toEqual({ ok: false, availableAt: NOW - 5 * HOUR + WINDOW });
  });

  test("issue.quota_clock_skew: codes dated after now (PDS clock ahead) still count", () => {
    const ahead = [1, 2, 3, 4, 5].map((s) => NOW + s * 1000);
    expect(accountQuota(ahead, NOW, WINDOW, 5)).toEqual({ ok: false, availableAt: NOW + WINDOW });
  });

  test("codes older than the window do not count", () => {
    const old = [1, 2, 3, 4, 5].map((h) => NOW - WINDOW - h * HOUR);
    expect(accountQuota(old, NOW, WINDOW, 5)).toEqual({ ok: true, remaining: 4, availableAt: null });
  });
});

describe("globalQuota", () => {
  test("issue.quota_global: the daily cap refuses until the next UTC midnight", () => {
    expect(globalQuota(99, NOW, 100)).toEqual({ ok: true, remaining: 0, availableAt: null });
    expect(globalQuota(100, NOW, 100)).toEqual({ ok: false, availableAt: utcMidnight(NOW) + 24 * HOUR });
    expect(utcMidnight(NOW)).toBe(Date.UTC(2026, 10, 18));
  });
});
