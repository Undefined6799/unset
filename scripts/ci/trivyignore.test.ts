import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import {
  MAX_DAYS,
  NEWT_MAX_DAYS,
  PDS_MAX_DAYS,
  PYTHON_MAX_DAYS,
  SEAWEEDFS_MAX_DAYS,
  trivyIgnoreProblems,
} from "./trivyignore.ts";

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

  test("trivyignore_shape_check_leaves_expiry_to_the_scan", () => {
    const entry = (fields: string) => `vulnerabilities:\n  - id: CVE-2026-0001\n${fields}`;
    const shape = (fields: string) => trivyIgnoreProblems(entry(fields), TODAY, MAX_DAYS, "shape");
    expect(shape("    statement: reason\n    expired_at: 2026-10-05\n")).toEqual([]);
    expect(shape("    expired_at: 2026-10-05\n")).toEqual(["vulnerabilities CVE-2026-0001: no statement (the reason)"]);
    expect(shape("    statement: reason\n    expired_at: 2027-02-01\n")).toEqual([
      `vulnerabilities CVE-2026-0001: expired_at 2027-02-01 is more than ${MAX_DAYS} days ahead`,
    ]);
  });

  test("trivyignore_file_valid", () => {
    // "shape": a date that has passed is the scan's and the daily waivers job's to report, not this required check's.
    const text = readFileSync(join(ROOT, ".github", "trivyignore.yaml"), "utf8");
    expect(trivyIgnoreProblems(text, new Date(), MAX_DAYS, "shape")).toEqual([]);
  });
});

const PDS_FILE = join(ROOT, ".github", "trivyignore.pds.yaml");
const SHARED_FILE = join(ROOT, ".github", "trivyignore.yaml");
/** P1.38k: the 0.4.5049 re-pin (P1.38h, digest cca85fd0), scanned by #1371's pins job (run 40622622906). Four ids
 * re-stated from the 0.4.5037 list for 0.4.5049's packages, four new; each scoped to one path and one PURL. P1.38l: the
 * 0.4.5037 (3a8feb34) entries ended with the re-pin, so these and KEPT_ENTRIES are the whole file. */
/** P1.38l: the five 0.4.5037 nodemailer 6.10.1 entries that 0.4.5049 still needs, kept unchanged by Alex's line of
 * 2026-10-28T22:38:42Z, to 2026-11-27 by P1.38n (no upstream fix on 2026-11-14), and with REPIN_ENTRIES to
 * 2026-12-11 by P1.38u (no PDS image newer than 0.4.5051 on 2026-11-21). */
const KEPT_STATEMENT = [
  "sha256:3a8feb3415e319dbcc13372293b7ef1fb05a318a6ff1d55968cf99ba6633c5d4:",
  "newest upstream release, staging and local stacks; every address it sees is an account email the PDS validated",
  "(254 characters at most); accepted by Alex 2026-10-14T20:34:16Z,",
  "removed on re-pin or before P1.34",
].join(" ");
/** P1.38u: the two nodemailer ids outside the address parser (the message `raw` option and the OAuth2 token fetch).
 * @atproto/pds 0.5.51 dist/mailer/index.js sendTemplate and moderation.js send pass only to, subject, from and html;
 * dist/context.js builds the transport from the SMTP URL, which carries a password. */
const KEPT_TEMPLATE_STATEMENT = [
  "sha256:3a8feb3415e319dbcc13372293b7ef1fb05a318a6ff1d55968cf99ba6633c5d4:",
  "newest upstream release, staging and local stacks; the PDS sends only its own templates (to, subject, html;",
  "never raw) over SMTP with a password, never OAuth2; accepted by Alex 2026-10-14T20:34:16Z,",
  "removed on re-pin or before P1.34",
].join(" ");
const TEMPLATE_ONLY_IDS = new Set(["CVE-2026-82659", "CVE-2026-82662"]);
const KEPT_ENTRIES = [
  "CVE-2025-14874",
  "CVE-2026-82659",
  "CVE-2026-82662",
  "GHSA-2x7j-588g-ccc2",
  "GHSA-v53p-9fqp-m79j",
].map((id) => ({
  id,
  paths: ["app/node_modules/.pnpm/nodemailer@6.10.1/node_modules/nodemailer/package.json"],
  purls: ["pkg:npm/nodemailer@6.10.1"],
  statement: TEMPLATE_ONLY_IDS.has(id) ? KEPT_TEMPLATE_STATEMENT : KEPT_STATEMENT,
  expired_at: "2026-12-11",
}));
/** P1.38u: each statement names why the finding is not a live risk on staging and local stacks. */
const repinStatement = (why: string) =>
  [
    "sha256:cca85fd07701ea3370ff5a3a0f38a4c108d45d49aa75944e38f45c186d9528cf:",
    `0.4.5049 re-pin, staging and local stacks; ${why}; accepted by Alex 2026-10-28T03:36:24Z,`,
    "removed on the next re-pin or before P1.34",
  ].join(" ");
/** The npm CLI's bundled undici and brace-expansion: the image starts node, never npm. */
const NPM_NEVER_RUNS = "npm never runs";
const NPM = "usr/local/lib/node_modules/npm/node_modules";
const REPIN_ENTRIES = [
  {
    id: "CVE-2026-59892",
    paths: [
      "app/node_modules/.pnpm/@opentelemetry+propagator-jaeger@2.8.0_@opentelemetry+api@1.10.0/node_modules/@opentelemetry/propagator-jaeger/package.json",
    ],
    purls: ["pkg:npm/%40opentelemetry/propagator-jaeger@2.8.0"],
    why: "OTel is not loaded",
  },
  { id: "CVE-2026-102276", paths: [`${NPM}/brace-expansion/package.json`], purls: ["pkg:npm/brace-expansion@5.0.9"] },
  { id: "CVE-2026-102278", paths: [`${NPM}/brace-expansion/package.json`], purls: ["pkg:npm/brace-expansion@5.0.9"] },
  { id: "CVE-2026-19534", paths: [`${NPM}/undici/package.json`], purls: ["pkg:npm/undici@6.28.0"] },
  { id: "CVE-2026-109383", paths: [`${NPM}/undici/package.json`], purls: ["pkg:npm/undici@6.28.0"] },
  { id: "CVE-2026-109869", paths: [`${NPM}/undici/package.json`], purls: ["pkg:npm/undici@6.28.0"] },
  { id: "CVE-2026-87018", paths: [`${NPM}/undici/package.json`], purls: ["pkg:npm/undici@6.28.0"] },
  {
    id: "CVE-2023-54404",
    paths: ["app/node_modules/.pnpm/zod@3.25.76/node_modules/zod/package.json"],
    purls: ["pkg:npm/zod@3.25.76"],
    why: "bounded by the PDS's body limits",
  },
].map(({ why = NPM_NEVER_RUNS, ...entry }: { why?: string; id: string; paths: string[]; purls: string[] }) => ({
  ...entry,
  statement: repinStatement(why),
  expired_at: "2026-12-11",
}));
/** P1.38q: goat v0.2.7 in 0.4.5051 (8e58b797) is built with Go 1.27.3; Trivy reported CVE-2026-97054 on 2026-11-19.
 * Alex's line 2026-11-19T02:00:23Z: "Waive CVE-2026-97054 for goat in the PDS image until 2026-12-19". */
const GOAT_ENTRIES = [
  {
    id: "CVE-2026-97054",
    paths: ["usr/local/bin/goat"],
    purls: ["pkg:golang/stdlib@v1.27.3"],
    statement: [
      "sha256:8e58b79746da8a0e85698aa7ba9b53e508b94db2021d963653b6d1bfc14889c6:",
      "0.4.5051's goat v0.2.7 is built with Go 1.27.3; the PDS never runs goat and goat has no HTTP server;",
      "accepted by Alex 2026-11-19T02:00:23Z, removed on the next re-pin",
    ].join(" "),
    expired_at: "2026-12-19",
  },
];

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
    expect(trivyIgnoreProblems(readFileSync(PDS_FILE, "utf8"), new Date(), PDS_MAX_DAYS, "shape")).toEqual([]);
    const entries = pdsEntries();
    expect(entries.map((item) => ({ ...item, expired_at: dayOf(item.expired_at) }))).toEqual([
      ...KEPT_ENTRIES,
      ...REPIN_ENTRIES,
      ...GOAT_ENTRIES,
    ]);
    for (const item of entries) {
      // Exact names only: a glob would also cover images nobody reviewed.
      for (const path of item.paths ?? []) expect(path, item.id).not.toMatch(/[*?[{\\]/);
    }
  });

  test("shared_ignorefile_never_names_pds", () => {
    const shared = readFileSync(SHARED_FILE, "utf8");
    const sharedDoc = parse(shared) as { vulnerabilities?: IgnoreEntry[] };
    expect(pdsOverlaps(sharedDoc.vulnerabilities ?? [], pdsEntries())).toEqual([]);
    expect(shared).not.toContain("ghcr.io/bluesky-social/pds");
    expect(shared).not.toContain("cca85fd0");
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

const SEAWEEDFS_FILE = join(ROOT, ".github", "trivyignore.seaweedfs.yaml");
/** P2.18s: Trivy v0.76.1's one finding in SeaweedFS 4.53 (ccad23e1), Alex's "yes waiver" 2026-11-15T23:08:12Z. */
const SEAWEEDFS_ENTRIES = [
  {
    id: "CVE-2026-78661",
    paths: ["usr/bin/weed"],
    purls: ["pkg:golang/golang.org/x/net@v0.61.0"],
    statement: [
      "sha256:ccad23e18639c8b98cee17e7100b95830a06077b56d8e5b006d6dcf8ec5e94a0:",
      "SeaweedFS 4.53, newest upstream release, no fixed build yet;",
      "removed on the re-pin to a release with x/net v0.62.0 or later",
    ].join(" "),
    expired_at: "2026-12-15",
  },
];

describe(".github/trivyignore.seaweedfs.yaml", () => {
  test("seaweedfs_ignorefile_is_the_one_reviewed_entry", () => {
    expect(SEAWEEDFS_MAX_DAYS).toBe(30);
    const text = readFileSync(SEAWEEDFS_FILE, "utf8");
    expect(trivyIgnoreProblems(text, new Date(), SEAWEEDFS_MAX_DAYS, "shape")).toEqual([]);
    const doc = parse(text) as { vulnerabilities?: IgnoreEntry[] };
    expect(Object.keys(doc)).toEqual(["vulnerabilities"]);
    const entries = (doc.vulnerabilities ?? []).map((item) => ({ ...item, expired_at: dayOf(item.expired_at) }));
    expect(entries).toEqual(SEAWEEDFS_ENTRIES);
  });

  test("seaweedfs_waiver_names_no_other_image", () => {
    // Its entry is scoped to weed alone, and neither the shared nor the PDS file names SeaweedFS or its id.
    for (const file of [SHARED_FILE, PDS_FILE]) {
      const other = readFileSync(file, "utf8");
      expect(other, file).not.toContain("CVE-2026-78661");
      expect(other, file).not.toContain("seaweedfs");
    }
  });
});

const NEWT_FILE = join(ROOT, ".github", "trivyignore.newt.yaml");
/** P1.37m: Trivy v0.76.1's one finding in Newt 1.20.0 (2170e673), the newest release; x/net/html is not linked. */
const NEWT_ENTRIES = [
  {
    id: "CVE-2026-78661",
    paths: ["usr/local/bin/newt"],
    purls: ["pkg:golang/golang.org/x/net@v0.60.0"],
    statement: [
      "sha256:2170e673c4c72d905764fa22e83d0ae0aa3239fb1ab3b9fcaefb2b00fffb2d6e:",
      "Newt 1.20.0, newest upstream release, no fixed build yet; the finding is in golang.org/x/net/html,",
      "which the newt binary does not link; removed on the re-pin to a release with x/net v0.62.0 or later",
    ].join(" "),
    expired_at: "2026-12-15",
  },
];

describe(".github/trivyignore.newt.yaml", () => {
  test("newt_ignorefile_is_the_one_reviewed_entry", () => {
    expect(NEWT_MAX_DAYS).toBe(30);
    const text = readFileSync(NEWT_FILE, "utf8");
    expect(trivyIgnoreProblems(text, new Date(), NEWT_MAX_DAYS, "shape")).toEqual([]);
    const doc = parse(text) as { vulnerabilities?: IgnoreEntry[] };
    expect(Object.keys(doc)).toEqual(["vulnerabilities"]);
    const entries = (doc.vulnerabilities ?? []).map((item) => ({ ...item, expired_at: dayOf(item.expired_at) }));
    expect(entries).toEqual(NEWT_ENTRIES);
  });

  test("newt_waiver_names_no_other_image", () => {
    // Its entry is scoped to the newt binary alone; the shared and PDS files name neither Newt nor its id.
    for (const file of [SHARED_FILE, PDS_FILE]) {
      const other = readFileSync(file, "utf8");
      expect(other, file).not.toContain("CVE-2026-78661");
      expect(other, file).not.toContain("usr/local/bin/newt");
    }
  });
});

const PYTHON_FILE = join(ROOT, ".github", "trivyignore.python.yaml");
/**
 * P6.02: Trivy v0.76.1's one OS finding in the python:3.13-slim-trixie base (e48f59cd), zlib1g, which Debian has fixed
 * and the Synapse image built on it will upgrade under the zlib exception (ZLIB_UPGRADE in
 * deployment/images/images.test.ts), so only the scans of the base itself read this file. It expires with that
 * exception.
 */
const PYTHON_ENTRIES = [
  {
    id: "CVE-2026-85091",
    statement: [
      "sha256:e48f59cdba69a3cbd9ed2cf0f348d90d45a8d350d98134cf1070bc106ee9ed90:",
      "python:3.13-slim-trixie ships zlib1g 1:1.3.dfsg+really1.3.1-1+b1, fixed in 1:1.3.dfsg+really1.3.1-1+deb13u1;",
      "the Synapse image built on it upgrades zlib1g to the fixed version in its final stage (the zlib exception);",
      "removed on the re-pin to a base that ships the fix, or with the zlib exception",
    ].join(" "),
    expired_at: "2026-11-30",
  },
];

describe(".github/trivyignore.python.yaml", () => {
  test("python_ignorefile_is_the_one_reviewed_entry", () => {
    expect(PYTHON_MAX_DAYS).toBe(30);
    const text = readFileSync(PYTHON_FILE, "utf8");
    expect(trivyIgnoreProblems(text, new Date(), PYTHON_MAX_DAYS, "shape")).toEqual([]);
    const doc = parse(text) as { vulnerabilities?: IgnoreEntry[] };
    expect(Object.keys(doc)).toEqual(["vulnerabilities"]);
    const entries = (doc.vulnerabilities ?? []).map((item) => ({ ...item, expired_at: dayOf(item.expired_at) }));
    expect(entries).toEqual(PYTHON_ENTRIES);
  });

  test("python_waiver_names_no_other_image", () => {
    for (const file of [SHARED_FILE, PDS_FILE, SEAWEEDFS_FILE, NEWT_FILE]) {
      expect(readFileSync(file, "utf8"), file).not.toContain("CVE-2026-85091");
    }
  });
});
