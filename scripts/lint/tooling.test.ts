// The tooling set in scripts/lint/tooling.ts: its glob reading against node:path matchesGlob, and its members (P1.28p).
import { matchesGlob } from "node:path";
import { expect, test } from "vitest";
import { globSource, TEST_FILE, TEST_GLOBS } from "./tooling.ts";

const PATHS = [
  "shared/http/main.test.ts",
  "shared/http/x/y/a.test.tsx",
  "shared/http/a.test.mts",
  "shared/http/a.test.cts",
  "shared/a.test.ts",
  "shared/http/main.ts",
  "shared/http/test.ts",
  "shared/http/a.tests.ts",
  "shared/http/a.test.js",
  "shared/http/.test.ts",
  "shared/http/.a.test.ts",
  "shared/.h/a.test.ts",
  ".a.image.test.ts",
  "shared/http/.h/leak.test.ts",
  "shared/.h/x/leak.test.ts",
  "shared/http/x.y/a.test.ts",
  "sharedx/a.test.ts",
  "tests/integration/a.test.ts",
  "tests/support/a.ts",
  "a.image.test.ts",
  "deployment/x/a.image.test.mts",
  ".h/a.image.test.ts",
  "scripts/ui/a.test.ts",
];

test("glob_source_reads_globs_as_matchesGlob_does", () => {
  // Node v26.10.0 doc/api/path.md, "path.matchesGlob": the reference this reading must agree with.
  expect(TEST_GLOBS).toContain("shared/**/*.test.{ts,tsx,mts,cts}");
  expect(TEST_GLOBS).toContain("**/*.image.test.{ts,tsx,mts,cts}");
  // Globs without a leading double star too, so each wildcard is held to matchesGlob on its own.
  for (const glob of [...TEST_GLOBS, "shared/http/*.test.ts", "*.image.test.ts", "shared/*/a.test.ts"]) {
    const re = new RegExp(globSource(glob));
    for (const path of PATHS) expect(re.test(path), `${glob} ${path}`).toBe(matchesGlob(path, glob));
  }
  for (const path of PATHS) {
    const any = TEST_GLOBS.some((glob) => matchesGlob(path, glob));
    expect(new RegExp(TEST_FILE).test(path), path).toBe(any);
  }
});

test("glob_source_refuses_forms_it_does_not_read", () => {
  for (const glob of ["a/?.ts", "a/[ab].ts", "!a.ts", "a/{b.ts", "a/@(b).ts", "a/**", "a/**.ts"])
    expect(() => globSource(glob)).toThrow();
});
