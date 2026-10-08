// The package.json and tsconfig routes pinned beside the check job (P1.28k; scripts/ci/package-routes.ts).
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, expect, test } from "vitest";
import { escapingTargets, reroutingProblems } from "./package-routes.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/** A fixture repository: each entry is a file and its JSON (or text) content. */
function repo(files: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), "package-routes-"));
  temps.push(root);
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), typeof content === "string" ? content : JSON.stringify(content));
  }
  return root;
}
const problems = (files: Record<string, unknown>) => reroutingProblems(repo(files), Object.keys(files));
const ROOT_PACKAGE = { name: "unset.sh", private: true, workspaces: ["shared/*"] };

test("root_package_routes_fail", () => {
  for (const field of ["exports", "imports", "main", "module", "browser"]) {
    expect(
      problems({ "package.json": { ...ROOT_PACKAGE, [field]: "./deployment/preflight/compose-parse.ts" } }),
    ).toEqual([`package.json has ${field}`]);
  }
  expect(problems({ "package.json": ROOT_PACKAGE })).toEqual([]);
});

test("workspace_targets_stay_inside", () => {
  const workspace = (manifest: object) => ({ "package.json": ROOT_PACKAGE, "shared/x/package.json": manifest });
  for (const manifest of [
    { exports: { "./p": "../../deployment/preflight/compose-parse.ts" } },
    { exports: { ".": { types: "./index.ts", default: "../../deployment/preflight/index.js" } } },
    { exports: ["./index.ts", "../y/index.ts"] },
    { imports: { "#p": "../../deployment/preflight/compose-parse.ts" } },
    { imports: { "#p": "some-package" } },
    { main: "../../deployment/preflight/index.ts" },
    { module: "/deployment/preflight/index.ts" },
    { browser: { "./a.js": "../../deployment/preflight/a.js" } },
    { exports: { "./*": "./../../deployment/*" } },
  ]) {
    expect(problems(workspace(manifest)), JSON.stringify(manifest)).toHaveLength(1);
  }
  const fine = { exports: { ".": "./index.ts", "./server": { default: "./dist/server.js" }, "./x/*": "./x/*.ts" } };
  expect(problems(workspace({ ...fine, browser: { "./a.js": false } }))).toEqual([]);
});

test("symlinked_target_outside_fails", () => {
  const root = repo({ "package.json": ROOT_PACKAGE, "deployment/preflight/index.ts": "export {};\n" });
  mkdirSync(join(root, "shared/x"), { recursive: true });
  symlinkSync(join(root, "deployment/preflight"), join(root, "shared/x/inner"));
  expect(escapingTargets(root, "shared/x", { exports: { ".": "./inner/index.ts" } })).toHaveLength(1);
  expect(escapingTargets(root, "shared/x", { exports: { ".": "./index.ts" } })).toEqual([]);
});

test("tsconfig_aliases_and_skipped_folders_fail", () => {
  const files = {
    "package.json": ROOT_PACKAGE,
    "shared/x/tsconfig.json": { compilerOptions: { paths: { "@unset/x": ["../../deployment/preflight"] } } },
    "tsconfig.build.json": { compilerOptions: { baseUrl: "." } },
    "deployment/preflight/dist/b.ts": "export const b = 1;\n",
    "shared/x/coverage/c.ts": "export {};\n",
    "graphify-out/g.ts": "export {};\n",
    ".worktrees/w/a.ts": "export {};\n",
  };
  expect(problems(files)).toHaveLength(6);
  expect(problems({ "package.json": ROOT_PACKAGE, "tsconfig.json": { compilerOptions: { strict: true } } })).toEqual(
    [],
  );
});

test("real_tree_has_no_rerouting", () => {
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" }).split("\0").filter(Boolean);
  expect(files.length).toBeGreaterThan(100);
  expect(reroutingProblems(ROOT, files)).toEqual([]);
});
