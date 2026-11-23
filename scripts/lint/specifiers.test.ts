// The raw-specifier allowlist in scripts/lint/specifiers.ts, on throwaway fixtures and on the real tree (P1.28k, P1.28m).
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { cruise, type ICruiseResult } from "dependency-cruiser";
import { afterAll, expect, test } from "vitest";
import { config, ROOT, removeFixtures, tempDir, write } from "./depcruise-fixture.ts";
import { isTestFile, type Packages, readPackages, refusal, specifierViolations } from "./specifiers.ts";
import { TEST_GLOBS } from "./tooling.ts";

afterAll(removeFixtures);

const PACKAGES: Packages = {
  rootName: "unset.sh",
  root: new Set(["vitest", "@types/node"]),
  workspaces: new Map([
    ["shared/http", { name: "@unset/shared-http", declared: new Set(["hono"]) }],
    ["infrastructure/net-guard", { name: "@unset/infrastructure-net-guard", declared: new Set(["undici"]) }],
  ]),
  testFile: isTestFile,
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

test("web_server_takes_only_its_two_build_subpaths", () => {
  // P1.20k: interfaces/web/server.ts loads its own build through #kit/handler and #kit/manifest (package "imports");
  // no other file and no other # specifier passes.
  const server = "interfaces/web/server.ts";
  expect(refusal(PACKAGES, server, "#kit/handler")).toBeUndefined();
  expect(refusal(PACKAGES, server, "#kit/manifest")).toBeUndefined();
  for (const spec of ["#kit/other", "#kit/handler/x", "#kit", "#preflight"])
    expect(refusal(PACKAGES, server, spec), spec).toBe("a # subpath import");
  expect(refusal(PACKAGES, "interfaces/web/src/hooks.server.ts", "#kit/handler")).toBe("a # subpath import");
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
    // The rest of the tooling set does not widen the fallback (#558 verification): fixtures and vectors still declare.
    "shared/http/fixtures/x.ts",
    "shared/http/a.fixture.ts",
    "shared/http/a.image.test.js",
    "shared/http/vectors.vector.json",
  ]) {
    expect(refusal(packages, file, "dependency-cruiser"), file).toBe("a root-only package outside a test file");
  }
  for (const file of ["shared/http/main.test.ts", "shared/http/x/a.test.tsx", "shared/http/a.image.test.mts"]) {
    expect(refusal(packages, file, "dependency-cruiser"), file).toBeUndefined();
  }
  expect(refusal(packages, "scripts/budgets/check.ts", "dependency-cruiser")).toBeUndefined();
});

test("workspace_peer_dependencies_count_as_declared", () => {
  // A library workspace that runs inside its host's copy (shared/islands and react) declares it as a peer.
  const root = tempDir();
  write(
    root,
    "package.json",
    JSON.stringify({ name: "unset.sh", workspaces: ["shared/*"], peerDependencies: { a: "1" } }),
  );
  write(
    root,
    "shared/islands/package.json",
    JSON.stringify({ name: "@unset/shared-islands", peerDependencies: { react: "^19.3.0" } }),
  );
  const packages = readPackages(root, (dir) => readdirSync(join(root, dir)).map((name) => `${dir}/${name}`));
  expect(refusal(packages, "shared/islands/slot.ts", "react")).toBeUndefined();
  expect(refusal(packages, "shared/islands/slot.ts", "react-dom")).toBe(
    "a package neither its workspace nor the root package.json declares",
  );
  // The root lists no product code, so its peers declare nothing.
  expect(refusal(packages, "scripts/a.ts", "a")).toBe("a package the root package.json does not declare");
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
  // A path spelling has a target in the fixture, so the cruise must keep its edge: one dropped for any reason (an
  // exclude, the process cwd, a resolver change) fails here by name, not as a short count below.
  const kept = result.modules.find((module) => module.source === from)?.dependencies ?? [];
  for (const spec of specs.filter((spec) => /^[./]/.test(spec))) {
    expect(
      kept.some((dependency) => dependency.module === spec && !dependency.couldNotResolve),
      spec,
    ).toBe(true);
  }
  return specifierViolations(result, { ...PACKAGES, root: new Set(), workspaces: new Map() });
}

test("cruise_specifiers_reach_the_check", async () => {
  // dependency-cruiser rewrites `resolved` for a path that resolves, and moves node: to `protocol`; the check must
  // still see the spelling. Absolute paths here resolve in the fixture, so only the specifier can refuse them. The
  // /proc spelling goes through /proc/self/root, which is `/` for this process, so it reaches the fixture whatever the
  // cwd is; through /proc/self/cwd it reached the checkout instead, and under .worktrees/ the exclude dropped it.
  const from = "deployment/edge/a.test.ts";
  const refused = await cruiseSpecs(from, (root) => [
    "FILE:///deployment/preflight/compose-parse.ts",
    "file:///deployment/preflight/compose-parse.ts",
    "data:text/javascript,export const x = 1;",
    `/proc/self/root${root}/deployment/preflight/compose-parse.ts`,
    `${root}/deployment/preflight/compose-parse.ts`,
    "fs",
    "node:not-a-builtin",
  ]);
  expect(refused).toHaveLength(7);
  expect(await cruiseSpecs(from, () => ["node:fs", "node:test", "../preflight/compose-parse.ts"])).toEqual([]);
});

// Cruising the whole tree took 2.8 s to 4.9 s on CI's runners (ci code job, 2026-11-23) and grows with the tree, so
// Vitest's 5 s default failed it on a slow runner (#1999 at 06d16ea, job 137748060547). It gets the budget the
// other whole-tree cruise has (image-rules.test.ts, image_builds_only_in_image_tests).
test("real_tree_uses_only_allowed_specifiers", { timeout: 30_000 }, async () => {
  const list = (dir: string) =>
    readdirSync(join(ROOT, dir), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${dir}/${entry.name}`);
  const packages = readPackages(ROOT, list);
  // The real tree is clean, so the cruise below cannot show that readPackages wires in the test-file definition.
  expect(packages.testFile("shared/http/via.ts")).toBe(false);
  expect(packages.testFile("shared/http/main.test.ts")).toBe(true);
  const { output } = await cruise(["."], { ...config.options, baseDir: ROOT, outputType: "json" });
  expect(specifierViolations(JSON.parse(String(output)), packages)).toEqual([]);
});

test("sveltekit_modules_only_in_the_web_process", () => {
  // ADR 0054: SvelteKit's $app modules are allowed in interfaces/web, by name, and nowhere else.
  expect(refusal(PACKAGES, "interfaces/web/src/hooks.server.ts", "$app/env")).toBeUndefined();
  expect(refusal(PACKAGES, "interfaces/web/src/routes/a/+page.svelte", "$app/forms")).toBeUndefined();
  expect(refusal(PACKAGES, "interfaces/http/a.ts", "$app/env")).toBe("a SvelteKit module outside the web process");
  expect(refusal(PACKAGES, "interfaces/web/a.ts", "$app/other")).toBe("a malformed package name");
  expect(refusal(PACKAGES, "interfaces/web/a.ts", "$env/static/private")).toBe("a malformed package name");
});
