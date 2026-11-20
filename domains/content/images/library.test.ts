import { describe, expect, test } from "vitest";
import {
  admitUpload,
  fitsQuota,
  IMAGE_ALLOWANCE,
  IMAGE_EXPIRY,
  SWEEP_GOVERNOR,
  sweepAllowed,
  uploadsOpen,
} from "./library.ts";

const GIB = 1024 ** 3;
const quiet = { lastHour: 0, lastDay: 0, liveBytes: 0, quotaBytes: null };
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("image library rules (ADR 0070 points 4, 6 and 7)", () => {
  test("library.allowance: the numbers ADR 0070 point 4 sets", () => {
    expect(IMAGE_ALLOWANCE).toEqual({ perHour: 120, perDay: 1000, defaultQuotaBytes: 2 * GIB });
  });

  test("library.normal_use_fits: a photographer's busy day of 60 uploads an hour for eight hours is admitted", () => {
    for (let hour = 0; hour < 8; hour++) {
      for (let n = 0; n < 60; n++) {
        const usage = { lastHour: n, lastDay: hour * 60 + n, liveBytes: (hour * 60 + n) * 2_500_000, quotaBytes: null };
        expect(admitUpload(usage)).toEqual({ ok: true });
      }
    }
  });

  test("library.limits: the 121st upload in an hour, the 1,001st in a day and a full quota are refused", () => {
    expect(admitUpload({ ...quiet, lastHour: 119, lastDay: 119 })).toEqual({ ok: true });
    expect(admitUpload({ ...quiet, lastHour: 120, lastDay: 120 })).toEqual({ ok: false, code: "image.hourly_limit" });
    expect(admitUpload({ ...quiet, lastHour: 0, lastDay: 1000 })).toEqual({ ok: false, code: "image.daily_limit" });
    expect(admitUpload({ ...quiet, liveBytes: 2 * GIB })).toEqual({ ok: false, code: "image.quota" });
    expect(admitUpload({ ...quiet, liveBytes: 99, quotaBytes: 100 })).toEqual({ ok: true });
    expect(admitUpload({ ...quiet, liveBytes: 100, quotaBytes: 100 })).toEqual({ ok: false, code: "image.quota" });
  });

  test("library.quota: stored versions fit when the total stays within the quota", () => {
    expect(fitsQuota(2 * GIB - 10, 10, null)).toBe(true);
    expect(fitsQuota(2 * GIB - 10, 11, null)).toBe(false);
    expect(fitsQuota(0, 5, 4)).toBe(false);
  });

  test("library.expiry: the windows ADR 0070 point 6 sets", () => {
    expect(IMAGE_EXPIRY).toEqual({ neverUsedMs: DAY, unusedCopyMs: 7 * DAY });
  });

  test("library.governor: a run may delete 500, or a tenth of live images when that is more, and no more", () => {
    expect(SWEEP_GOVERNOR).toEqual({ floor: 500, share: 0.1 });
    expect(sweepAllowed(500, 0)).toBe(true);
    expect(sweepAllowed(501, 1000)).toBe(false);
    expect(sweepAllowed(10_000, 100_000)).toBe(true);
    expect(sweepAllowed(10_001, 100_000)).toBe(false);
  });

  test("library.uploads_open: only localhost, *.test and staging accept uploads with no inspection mounted", () => {
    const at = (origin: string, env = "dev", pdsHostname = "staging.unset.ac") =>
      uploadsOpen({ origin, env, pdsHostname });
    expect(at("http://localhost:5173")).toBe(true);
    expect(at("http://127.0.0.1:5173")).toBe(false);
    expect(at("https://unset.test")).toBe(true);
    expect(at("https://app.unset.test")).toBe(true);
    expect(at("https://staging.unset.sh")).toBe(true);
    expect(at("https://unset.sh")).toBe(false);
    expect(at("https://staging.unset.sh.evil.example")).toBe(false);
    expect(at("https://test")).toBe(false);
    expect(at("not a url")).toBe(false);
    expect(at("https://staging.unset.sh", "prod")).toBe(false);
    expect(at("http://localhost:5173", "dev", "unset.ac")).toBe(false);
  });
});
