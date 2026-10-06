import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { MAX_DAYS, trivyIgnoreProblems } from "./trivyignore.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const TODAY = new Date("2026-10-06T00:00:00Z");

describe(".github/trivyignore.yaml", () => {
  test("trivyignore_expiry_enforced", () => {
    const entry = (fields: string) => `vulnerabilities:\n  - id: CVE-2026-0001\n${fields}`;
    const ok = "    statement: no fixed version; not reachable from our code\n    expired_at: 2026-11-01\n";
    expect(trivyIgnoreProblems(entry(ok), TODAY)).toEqual([]);
    expect(trivyIgnoreProblems(entry("    statement: reason\n    expired_at: 2026-10-05\n"), TODAY)).toEqual([
      "vulnerabilities CVE-2026-0001: expired on 2026-10-05",
    ]);
    expect(trivyIgnoreProblems(entry("    expired_at: 2026-11-01\n"), TODAY)).toEqual([
      "vulnerabilities CVE-2026-0001: no statement (the reason)",
    ]);
    expect(trivyIgnoreProblems(entry("    statement: reason\n"), TODAY)).toEqual([
      "vulnerabilities CVE-2026-0001: no expired_at",
    ]);
    expect(trivyIgnoreProblems(entry("    statement: reason\n    expired_at: 2027-02-01\n"), TODAY)).toEqual([
      `vulnerabilities CVE-2026-0001: expired_at 2027-02-01 is more than ${MAX_DAYS} days ahead`,
    ]);
    expect(trivyIgnoreProblems("secrets:\n  - statement: reason\n    expired_at: 2026-11-01\n", TODAY)).toEqual([
      "secrets entry 1: no id",
    ]);
    expect(trivyIgnoreProblems("vulns:\n  - id: X\n", TODAY)).toEqual(["unknown section vulns"]);
  });

  test("trivyignore_file_valid", () => {
    expect(trivyIgnoreProblems(readFileSync(join(ROOT, ".github", "trivyignore.yaml"), "utf8"), new Date())).toEqual(
      [],
    );
  });
});
