// The dependency guard (P0.08): exact pins, workspace-only @unset names, lockfile sources, and the Renovate policy.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { scanAll, scanLockfile, scanManifest, scanNpmrc, workspaceNames } from "./dependencies.ts";
import { report } from "./files.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORKSPACES = new Set(["@unset/core"]);
const LINKED = { packages: { "node_modules/@unset/core": { resolved: "shared/core", link: true } } };
const FROM_REGISTRY = {
  packages: {
    "node_modules/@unset/core": {
      resolved: "https://registry.npmjs.org/@unset/core/-/core-1.0.0.tgz",
      integrity: "sha512-AAAA",
    },
  },
};

const manifest = (deps: Record<string, string>, lock: object = LINKED) =>
  scanManifest("package.json", JSON.stringify({ dependencies: deps }, null, 2), WORKSPACES, lock);
const lockfile = (entry: object) =>
  scanLockfile("package-lock.json", JSON.stringify({ packages: { "": {}, "node_modules/x": entry } }, null, 2));

describe("manifest pins", () => {
  test("pins_reject_ranges", () => {
    const deps = { a: "^1.0.0", b: "~2.0.0", c: "latest", d: "git+https://x", e: "file:../e" };
    expect(manifest(deps)).toHaveLength(5);
  });

  test("pins_accept_exact", () => {
    expect(manifest({ a: "1.2.3", b: "1.0.0-rc.1", "@unset/core": "*" })).toEqual([]);
  });

  test("pins_reject_unknown_internal_star", () => {
    expect(manifest({ "@unset/ghost": "*" })).toHaveLength(1);
  });

  test("pins_reject_unlinked_internal_star", () => {
    expect(manifest({ "@unset/core": "*" }, FROM_REGISTRY)).toHaveLength(1);
  });

  test("pins_reject_workspace_protocol", () => {
    expect(manifest({ "@unset/core": "workspace:*" })).toHaveLength(1);
  });

  test("dev_and_optional_checked_peer_ignored", () => {
    const json = {
      devDependencies: { a: "^1.0.0" },
      optionalDependencies: { b: "~1.0.0" },
      peerDependencies: { c: "^1" },
    };
    expect(scanManifest("package.json", JSON.stringify(json, null, 2), WORKSPACES, LINKED)).toHaveLength(2);
  });

  test("finding_points_at_the_line", () => {
    const [finding] = manifest({ a: "1.0.0", b: "^2.0.0" });
    expect(finding).toMatchObject({ file: "package.json", line: 4, rule: "dependencies" });
  });
});

describe("lockfile sources", () => {
  const integrity = "sha512-AAAA";
  test("lockfile_rejects_foreign_resolved", () => {
    expect(lockfile({ resolved: "https://codeload.github.com/a/b/tar.gz/abc", integrity })).toHaveLength(1);
    expect(lockfile({ resolved: "https://registry.npmjs.org/x/-/x-1.0.0.tgz" })).toHaveLength(1);
    expect(lockfile({ resolved: "http://registry.npmjs.org/x/-/x-1.0.0.tgz", integrity })).toHaveLength(1);
    expect(lockfile({ resolved: "https://registry.npmjs.org/x/-/x-1.0.0.tgz", integrity: "sha1-AAAA" })).toHaveLength(
      1,
    );
  });

  test("lockfile_accepts_registry_and_links", () => {
    expect(lockfile({ resolved: "https://registry.npmjs.org/x/-/x-1.0.0.tgz", integrity })).toEqual([]);
    expect(lockfile({ resolved: "shared/core", link: true })).toEqual([]);
  });
});

describe("npmrc", () => {
  const npmrc = readFileSync(join(ROOT, ".npmrc"), "utf8");
  test("npmrc_blocks_scope", () => {
    expect(scanNpmrc(".npmrc", npmrc)).toEqual([]);
    expect(scanNpmrc(".npmrc", npmrc.replace(/^@unset:registry=.*$/m, ""))).toHaveLength(1);
    expect(scanNpmrc(".npmrc", npmrc.replace(/^ignore-scripts=true$/m, ""))).toHaveLength(1);
  });
});

describe("renovate", () => {
  const renovate = JSON.parse(readFileSync(join(ROOT, "renovate.json"), "utf8"));
  test("renovate_vuln_policy_explicit", () => {
    expect(renovate.vulnerabilityAlerts).toHaveProperty("minimumReleaseAge");
    expect(renovate.vulnerabilityAlerts.rangeStrategy).toBeDefined();
    expect(renovate.vulnerabilityAlerts.rangeStrategy).not.toBe("update-lockfile");
  });

  test("renovate_never_fetches_unset_scope", () => {
    const rule = renovate.packageRules.find((r: { matchPackageNames?: string[] }) =>
      r.matchPackageNames?.includes("@unset/**"),
    );
    expect(rule?.enabled).toBe(false);
  });

  test("dependabot_removed", () => {
    expect(existsSync(join(ROOT, ".github", "dependabot.yml"))).toBe(false);
  });
});

test("repo_clean", () => {
  const findings = scanAll(ROOT);
  expect(findings, report(findings)).toEqual([]);
});

test("workspace_names_from_root_globs", () => {
  expect([...workspaceNames(ROOT).keys()].every((name) => name.startsWith("@unset/"))).toBe(true);
});
