import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { MAX_DAYS, PDS_MAX_DAYS, trivyIgnoreProblems } from "./trivyignore.ts";

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

const PDS_FILE = join(ROOT, ".github", "trivyignore.pds.yaml");
const SHARED_FILE = join(ROOT, ".github", "trivyignore.yaml");
const STATEMENT = [
  "sha256:3a8feb3415e319dbcc13372293b7ef1fb05a318a6ff1d55968cf99ba6633c5d4:",
  "newest upstream release, local stack only, accepted by Alex 2026-10-14T20:34:16Z,",
  "removed on re-pin or before P1.34",
].join(" ");
/** Ids mirror run 38952734875 reported for the pinned PDS image. Nothing else. */
const PDS_IDS = [
  "CVE-2025-14874",
  "CVE-2025-47913",
  "CVE-2026-102276",
  "CVE-2026-102278",
  "CVE-2026-106445",
  "CVE-2026-106446",
  "CVE-2026-12151",
  "CVE-2026-13149",
  "CVE-2026-14257",
  "CVE-2026-14456",
  "CVE-2026-19534",
  "CVE-2026-27145",
  "CVE-2026-33818",
  "CVE-2026-39821",
  "CVE-2026-39822",
  "CVE-2026-39828",
  "CVE-2026-39829",
  "CVE-2026-39830",
  "CVE-2026-39831",
  "CVE-2026-39832",
  "CVE-2026-39835",
  "CVE-2026-42504",
  "CVE-2026-42508",
  "CVE-2026-46595",
  "CVE-2026-46597",
  "CVE-2026-56853",
  "CVE-2026-56854",
  "CVE-2026-56858",
  "CVE-2026-56859",
  "CVE-2026-56860",
  "CVE-2026-56862",
  "CVE-2026-59873",
  "CVE-2026-59874",
  "CVE-2026-59892",
  "CVE-2026-69152",
  "CVE-2026-69192",
  "CVE-2026-73566",
  "CVE-2026-78667",
  "CVE-2026-78669",
  "CVE-2026-82659",
  "CVE-2026-82662",
  "CVE-2026-97031",
  "GHSA-2x7j-588g-ccc2",
  "GHSA-v53p-9fqp-m79j",
] as const;

type IgnoreEntry = { id?: string; statement?: string; expired_at?: unknown; paths?: string[]; purls?: string[] };

function pdsEntries(): IgnoreEntry[] {
  const doc = parse(readFileSync(PDS_FILE, "utf8")) as { vulnerabilities?: IgnoreEntry[] };
  return doc.vulnerabilities ?? [];
}

function dayOf(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

describe(".github/trivyignore.pds.yaml", () => {
  test("pds_ignorefile_max_30_days", () => {
    const today = new Date("2026-10-16T12:00:00Z");
    const entry = (day: string) =>
      `vulnerabilities:\n  - id: CVE-2026-0001\n    statement: reason\n    expired_at: ${day}\n`;
    // 30 days from 2026-10-16 is 2026-11-15, which still passes. The next day does not.
    expect(trivyIgnoreProblems(entry("2026-11-15"), today, PDS_MAX_DAYS)).toEqual([]);
    expect(trivyIgnoreProblems(entry("2026-11-16"), today, PDS_MAX_DAYS)).toEqual([
      `vulnerabilities CVE-2026-0001: expired_at 2026-11-16 is more than ${PDS_MAX_DAYS} days ahead`,
    ]);
    expect(PDS_MAX_DAYS).toBeLessThan(MAX_DAYS);
    expect(trivyIgnoreProblems(readFileSync(PDS_FILE, "utf8"), new Date(), PDS_MAX_DAYS)).toEqual([]);
    const entries = pdsEntries();
    expect(entries.map((item) => item.id)).toEqual([...PDS_IDS]);
    for (const item of entries) {
      expect(dayOf(item.expired_at), item.id).toBe("2026-11-13");
      expect(item.statement, item.id).toBe(STATEMENT);
      expect((item.paths?.length ?? 0) + (item.purls?.length ?? 0), item.id).toBeGreaterThan(0);
    }
    // The Caddy Alpine binary's HIGH ids are accepted only on the PDS goat binary.
    for (const id of ["CVE-2026-78667", "CVE-2026-78669", "CVE-2026-97031"]) {
      const item = entries.find((candidate) => candidate.id === id);
      expect(item?.paths, id).toEqual(["usr/local/bin/goat"]);
      expect(item?.purls, id).toEqual(["pkg:golang/stdlib@v1.25.10"]);
    }
  });

  test("shared_ignorefile_never_names_pds", () => {
    const shared = readFileSync(SHARED_FILE, "utf8");
    const sharedDoc = parse(shared) as { vulnerabilities?: IgnoreEntry[] };
    const sharedIds = (sharedDoc.vulnerabilities ?? []).map((item) => item.id);
    const pdsIds = new Set(pdsEntries().map((item) => item.id));
    expect(sharedIds.filter((id) => pdsIds.has(id))).toEqual([]);
    expect(shared).not.toContain("ghcr.io/bluesky-social/pds");
    expect(shared).not.toContain("3a8feb34");
    expect(shared).not.toContain("trivyignore.pds.yaml");
  });
});
