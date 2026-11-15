import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { expiringWaivers, WAIVER_FILES, WARN_DAYS } from "./waiver-expiry.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const TODAY = new Date("2026-11-15T09:30:00Z");
const trivy = (day: string) =>
  `vulnerabilities:\n  - id: CVE-2026-0001\n    statement: reason\n    expired_at: ${day}\n`;

describe("waiver expiry", () => {
  test("waiver_expiry_reports_passed_and_near_dates", () => {
    expect(expiringWaivers(trivy("2026-11-15"), TODAY)).toEqual([
      "vulnerabilities CVE-2026-0001: expired on 2026-11-15",
    ]);
    expect(expiringWaivers(trivy("2026-11-13"), TODAY)).toEqual([
      "vulnerabilities CVE-2026-0001: expired on 2026-11-13",
    ]);
    expect(expiringWaivers(trivy("2026-11-22"), TODAY)).toEqual([
      `vulnerabilities CVE-2026-0001: expires on 2026-11-22, in ${WARN_DAYS} day(s)`,
    ]);
    expect(expiringWaivers(trivy("2026-11-23"), TODAY)).toEqual([]);
  });

  test("waiver_expiry_reads_npm_audit_entries_and_fails_closed", () => {
    const npm = "advisories:\n  - id: GHSA-aaaa-bbbb-cccc\n    package: zod\n    expired_at: 2026-11-16\n";
    expect(expiringWaivers(npm, TODAY)).toEqual(["advisories GHSA-aaaa-bbbb-cccc: expires on 2026-11-16, in 1 day(s)"]);
    expect(expiringWaivers("vulnerabilities:\n  - id: CVE-2026-0002\n", TODAY)).toEqual([
      "vulnerabilities CVE-2026-0002: no readable expired_at",
    ]);
    expect(expiringWaivers("vulnerabilities:\n  - expired_at: soon\n", TODAY)).toEqual([
      "vulnerabilities entry 1: no readable expired_at",
    ]);
    expect(expiringWaivers("", TODAY)).toEqual([]);
  });

  test("waiver_expiry_covers_every_waiver_file", () => {
    // A new ignore file under .github must join the daily look, or its dates are watched by nothing.
    const found = readdirSync(join(ROOT, ".github"))
      .filter((name) => /ignore.*\.yaml$/.test(name))
      .map((name) => `.github/${name}`)
      .sort();
    expect([...WAIVER_FILES].sort()).toEqual(found);
    for (const file of WAIVER_FILES) expect(existsSync(join(ROOT, file)), file).toBe(true);
  });
});
