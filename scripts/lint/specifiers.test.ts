// The raw-specifier allowlist in scripts/lint/specifiers.ts, on throwaway fixtures and on the real tree (P1.28k, P1.28m).
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { cruise, type ICruiseResult } from "dependency-cruiser";
import { afterAll, expect, test } from "vitest";
import VITEST from "../../vitest.config.ts";
import { config, ROOT, removeFixtures, tempDir, write } from "./depcruise-fixture.ts";
import { type Packages, readPackages, refusal, specifierViolations, testFileByGlobs } from "./specifiers.ts";

afterAll(removeFixtures);

/** The Vitest include globs, read from the root vitest.config.ts rather than copied (P1.28m). */
const TEST_GLOBS = (VITEST.test?.projects ?? []).flatMap((project) =>
  typeof project === "object" && "test" in project ? (project.test?.include ?? []) : [],
);

const PACKAGES: Packages = {
  rootName: "unset.sh",
  root: new Set(["vitest", "@types/node"]),
  workspaces: new Map([
    ["shared/http", { name: "@unset/shared-http", declared: new Set(["hono"]) }],
    ["infrastructure/net-guard", { name: "@unset/infrastructure-net-guard", declared: new Set(["undici"]) }],
  ]),
  testFile: testFileByGlobs(TEST_GLOBS),
};
const FROM = "shared/http/a.ts";

test("refused_forms_fail", () => {
  // Amendment 10 item 1 and the record's amendment 1: one red per refused form, each for its own reason.
  const refused: [string, string][] = [
    ["/deployment/preflight/compose-parse.ts", "a root-absolute path"],
    ["//deployment/preflight/compose-parse.ts", "a root-absolute path"],
    ["/proc/self/cwd/deployment/preflight/compose-parse.ts", "a root-absolute path"],
    ["\\deployment\\preflight\\compose-parse.ts", "a backslash"],
    ["./x\\..\\..\\deployment\\preflight\\compose-parse.ts", "a backslash"],
    ["file:///deployment/preflight/compose-parse.ts", "a URL scheme"],
    ["FILE:///deployment/preflight/compose-parse.ts", "a URL scheme"],
    ["data:text/javascript,export default 1", "a URL scheme"],
    ["https://example.com/x.js", "a URL scheme"],
    ["C:/deployment/preflight/compose-parse.ts", "a URL scheme"],
    ["#preflight", "a # subpath import"],
    ["unset.sh", "the root package's own name"],
    ["unset.sh/p", "the root package's own name"],
    ["@unset/not-a-workspace", "an @unset name that is no workspace"],
    ["@unset/shared-http/../../deployment/preflight/compose-parse.ts", "a dot or empty segment"],
    ["hono/../../deployment/preflight/compose-parse.ts", "a dot or empty segment"],
    ["hono//x", "a dot or empty segment"],
    ["undici", "a package neither its workspace nor the root package.json declares"],
    ["left-pad", "a package neither its workspace nor the root package.json declares"],
    ["@scope", "a malformed package name"],
    ["@/x", "a malformed package name"],
    [".foo", "a malformed package name"],
    ["vitest", "a root-only package outside a test file"],
  ];
  for (const [spec, reason] of refused) expect(refusal(PACKAGES, FROM, spec), spec).toBe(reason);
});

test("allowed_forms_pass", () => {
  for (const spec of [
    "./a.ts",
    "../b/c.ts",
    ".",
    "..",
    "@unset/shared-http",
    "@unset/infrastructure-net-guard/x",
    "hono",
    "hono/cookie",
  ]) {
    expect(refusal(PACKAGES, FROM, spec), spec).toBeUndefined();
  }
  // A root-level file draws on the root package.json only.
  expect(refusal(PACKAGES, "scripts/a.ts", "vitest")).toBeUndefined();
  expect(refusal(PACKAGES, "scripts/a.ts", "hono")).toBe("a package the root package.json does not declare");
});

test("root_only_packages_only_in_test_files", () => {
  // P1.28m: a workspace file may use a root-only package only when Vitest would run it as a test.
  expect(TEST_GLOBS).toContain("shared/**/*.test.{ts,tsx,mts,cts}");
  const packages = { ...PACKAGES, root: new Set(["dependency-cruiser"]) };
  for (const file of [
    "shared/http/main.ts",
    "shared/http/test.ts",
    "shared/http/a.tests.ts",
    "shared/http/a.test.js",
  ]) {
    expect(refusal(packages, file, "dependency-cruiser"), file).toBe("a root-only package outside a test file");
  }
  for (const file of ["shared/http/main.test.ts", "shared/http/x/a.test.tsx", "shared/http/a.image.test.mts"]) {
    expect(refusal(packages, file, "dependency-cruiser"), file).toBeUndefined();
  }
  expect(refusal(packages, "scripts/budgets/check.ts", "dependency-cruiser")).toBeUndefined();
});

async function cruiseSpecs(from: string, spellings: (root: string) => string[]): Promise<string[]> {
  const root = tempDir();
  write(root, "package.json", JSON.stringify({ name: "unset.sh", private: true }));
  write(root, "deployment/preflight/compose-parse.ts", "export const x = 1;\n");
  const specs = spellings(root);
  for (const [n, spec] of specs.entries()) {
    write(root, from, `import * as m${n} from ${JSON.stringify(spec)};\nexport { m${n} };\n`);
  }
  const { output } = await cruise(["."], { ...config.options, baseDir: root, outputType: "json" });
  const result: ICruiseResult = JSON.parse(String(output));
  return specifierViolations(result, { ...PACKAGES, root: new Set(), workspaces: new Map() });
}

test("cruise_specifiers_reach_the_check", async () => {
  // dependency-cruiser rewrites `resolved` for a path that resolves, and moves node: to `protocol`; the check must
  // still see the spelling. Absolute paths here resolve in the fixture, so only the specifier can refuse them.
  const from = "deployment/edge/a.test.ts";
  const refused = await cruiseSpecs(from, (root) => [
    "FILE:///deployment/preflight/compose-parse.ts",
    "file:///deployment/preflight/compose-parse.ts",
    "data:text/javascript,export const x = 1;",
    "/proc/self/cwd/deployment/preflight/compose-parse.ts",
    `${root}/deployment/preflight/compose-parse.ts`,
    "fs",
    "node:not-a-builtin",
  ]);
  expect(refused).toHaveLength(7);
  expect(await cruiseSpecs(from, () => ["node:fs", "node:test", "../preflight/compose-parse.ts"])).toEqual([]);
});

test("real_tree_uses_only_allowed_specifiers", async () => {
  const list = (dir: string) =>
    readdirSync(join(ROOT, dir), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${dir}/${entry.name}`);
  const packages = readPackages(ROOT, list, TEST_GLOBS);
  const { output } = await cruise(["."], { ...config.options, baseDir: ROOT, outputType: "json" });
  expect(specifierViolations(JSON.parse(String(output)), packages)).toEqual([]);
});
