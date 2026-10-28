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
/** Ids Alex accepted after that run, each with its own statement. */
const LATER_STATEMENTS: Readonly<Record<string, string>> = {
  "CVE-2026-111943": [
    "sha256:3a8feb3415e319dbcc13372293b7ef1fb05a318a6ff1d55968cf99ba6633c5d4:",
    "newest upstream release, goat CLI only, never run by the PDS server, accepted by Alex 2026-10-22T12:25:20Z,",
    "removed on re-pin or before P1.34",
  ].join(" "),
};
/** Ids mirror run 38952734875 reported for the pinned PDS image, plus LATER_STATEMENTS. Nothing else. */
const PDS_IDS = [
  "CVE-2025-14874",
  "CVE-2025-47913",
  "CVE-2026-102276",
  "CVE-2026-102278",
  "CVE-2026-106445",
  "CVE-2026-106446",
  "CVE-2026-111943",
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
      expect(item.statement, item.id).toBe(LATER_STATEMENTS[item.id ?? ""] ?? STATEMENT);
      expect((item.paths?.length ?? 0) + (item.purls?.length ?? 0), item.id).toBeGreaterThan(0);
      // Exact names only: a glob would also cover images nobody reviewed.
      for (const path of item.paths ?? []) expect(path, item.id).not.toMatch(/[*?[{\\]/);
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
    expect(pdsOverlaps(sharedDoc.vulnerabilities ?? [], pdsEntries())).toEqual([]);
    expect(shared).not.toContain("ghcr.io/bluesky-social/pds");
    expect(shared).not.toContain("3a8feb34");
    expect(shared).not.toContain("trivyignore.pds.yaml");
  });

  test("pds_overlap_needs_literal_paths_and_versioned_purls", () => {
    // verify-1153 F1: Trivy matches paths as globs and a PURL without a version as any version, so a glob path or a
    // bare PURL could reach goat's target while naming none of its strings. Each such entry is refused on its own.
    const goat = { id: "CVE-1", paths: ["usr/local/bin/goat"], purls: ["pkg:golang/stdlib@v1.25.10"] };
    const newt = { id: "CVE-1", paths: ["usr/local/bin/newt"], purls: ["pkg:golang/stdlib@v1.26.8"] };
    expect(pdsOverlaps([newt], [goat])).toEqual([]);
    for (const entry of [
      { ...newt, paths: [] },
      { ...newt, purls: [] },
      { id: "CVE-1", purls: newt.purls },
      { ...newt, paths: goat.paths },
      { ...newt, purls: goat.purls },
      { ...newt, paths: ["**"], purls: ["pkg:golang/stdlib"] },
      { ...newt, paths: ["usr/local/bin/[g]oat"] },
      { ...newt, paths: ["usr/local/bin/go?t"] },
      { ...newt, paths: ["usr/local/bin/{goat,newt}"] },
      { ...newt, paths: ["usr/local/bin/go\\at"] },
      { ...newt, paths: [""] },
      { ...newt, purls: ["pkg:golang/stdlib"] },
      { ...newt, purls: ["pkg:golang/stdlib@"] },
      { ...newt, purls: ["pkg:golang/stdlib?x=@v1"] },
    ]) {
      expect(pdsOverlaps([entry], [goat]), JSON.stringify(entry)).toEqual(["CVE-1"]);
    }
    // Trivy applies every entry with an id, so a shared entry is checked against each PDS entry that names it, not
    // only the last one (Codex on #1206).
    const other = { id: "CVE-1", paths: ["usr/local/bin/other"], purls: ["pkg:golang/stdlib@v1.24.0"] };
    expect(pdsOverlaps([{ ...newt, paths: goat.paths }], [goat, other])).toEqual(["CVE-1"]);
    expect(pdsOverlaps([newt], [goat, other])).toEqual([]);
  });
});

/**
 * The ids the shared file names that the PDS file also names, where the shared entry could reach any PDS entry's target
 * (P1.37x, verify-1153 F1). An id both files name is accepted in the shared file only for another binary: literal
 * paths (Trivy reads paths as globs), PURLs with a non-empty version (an empty one matches any, Trivy v0.75.0
 * pkg/purl/purl.go:281), and no path or PURL string the PDS entry uses.
 */
function pdsOverlaps(shared: readonly IgnoreEntry[], pds: readonly IgnoreEntry[]): string[] {
  return shared
    .filter((item) => {
      const twins = pds.filter((candidate) => candidate.id === item.id);
      if (twins.length === 0) return false;
      const paths = item.paths ?? [];
      const purls = item.purls ?? [];
      const twinScope = new Set(twins.flatMap((twin) => [...(twin.paths ?? []), ...(twin.purls ?? [])]));
      return (
        paths.length === 0 ||
        purls.length === 0 ||
        paths.some((path) => path === "" || /[*?[\]{}\\]/.test(path)) ||
        purls.some((purl) => !/^[^?#]*@[^@?#]+(?:[?#].*)?$/.test(purl)) ||
        [...paths, ...purls].some((scope) => twinScope.has(scope))
      );
    })
    .map((item) => item.id ?? "");
}

/** P1.37q: the P1.37x Newt 1.18.1 waivers ended with Newt 1.19.0 (P1.37z). The shared file accepts nothing; a new
 * entry needs Alex's typed line and its own test. */
describe(".github/trivyignore.yaml holds no waiver", () => {
  test("shared_ignore_file_is_empty", () => {
    const doc = parse(readFileSync(SHARED_FILE, "utf8")) as { vulnerabilities?: IgnoreEntry[] };
    expect(doc.vulnerabilities).toEqual([]);
  });
});
