import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { APP_IGNOREFILE } from "./list-dockerfiles.ts";
import { PDS_MAX_DAYS, trivyIgnoreProblems } from "./trivyignore.ts";

const APP_FILE = join(import.meta.dirname, "..", "..", APP_IGNOREFILE);

// P1.29v follow-up: Alex's card 2026-10-28T01:40:52Z accepts only the zod 3.25.76 finding in our app images, for at
// most 30 days. Any other entry, or a wider scope, is a new loosening and fails here.
describe(".github/trivyignore.app.yaml", () => {
  test("app_trivyignore_valid_within_30_days", () => {
    expect(trivyIgnoreProblems(readFileSync(APP_FILE, "utf8"), new Date(), PDS_MAX_DAYS)).toEqual([]);
  });

  test("app_trivyignore_accepts_only_zod_3_25_76", () => {
    const file = parse(readFileSync(APP_FILE, "utf8")) as Record<string, Array<Record<string, unknown>>>;
    expect(Object.keys(file)).toEqual(["vulnerabilities"]);
    expect(file.vulnerabilities?.map(({ id, paths, purls }) => ({ id, paths, purls }))).toEqual([
      {
        id: "CVE-2023-54404",
        paths: ["app/node_modules/zod/package.json"],
        purls: ["pkg:npm/zod@3.25.76"],
      },
    ]);
  });
});
