// P0.13: the licence files agree with ADR 0012, and the compatibility check finds what it must.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { findWorkspaces } from "../workspace/references.ts";
import {
  checkPackage,
  checkRepository,
  flatten,
  indexByPath,
  type LsNode,
  PERMISSIVE,
  productionTree,
  rootDependenciesNotListed,
  satisfies,
} from "./check.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const read = (file: string): string => readFileSync(join(ROOT, file), "utf8");
const manifest = (file: string): { license?: unknown } => JSON.parse(read(file));

describe("licence", () => {
  test("files_consistent", () => {
    // ADR 0012: every package under shared/ is MIT with its own LICENSE; the root and everything else is AGPL.
    expect(read("LICENSE").split("\n")[0]).toBe("GNU AFFERO GENERAL PUBLIC LICENSE");
    expect(read("LICENSE-MIT").startsWith("MIT License\n")).toBe(true);
    expect(manifest("package.json").license).toBe("AGPL-3.0-only");
    const workspaces = findWorkspaces(ROOT);
    expect(workspaces.some((w) => w.dir.startsWith("shared/"))).toBe(true);
    for (const { dir, pkg } of workspaces) {
      if (dir.startsWith("shared/")) {
        expect(pkg.license, dir).toBe("MIT");
        expect(existsSync(join(ROOT, dir, "LICENSE")), `${dir}/LICENSE`).toBe(true);
        expect(read(`${dir}/LICENSE`), `${dir}/LICENSE`).toBe(read("LICENSE-MIT"));
      } else {
        expect(pkg.license, dir).toBe("AGPL-3.0-only");
      }
    }
  });

  test("mit_package_no_agpl_dependency", () => {
    const tree: LsNode = {
      dependencies: { "@unset/infrastructure-net-guard": { version: "0.0.0", license: "AGPL-3.0-only" } },
    };
    expect(checkPackage("@unset/shared-x", "MIT", flatten(tree))).toEqual([
      "@unset/shared-x (MIT): @unset/infrastructure-net-guard@0.0.0 is AGPL-3.0-only",
    ]);
    // The same dependency is fine for an AGPL package.
    expect(checkPackage("@unset/domains-x", "AGPL-3.0-only", flatten(tree))).toEqual([]);
  });

  test("licence_check_logic", () => {
    const one = (license: unknown, missing = false): LsNode => ({
      dependencies: {
        dep: { version: "1.0.0", license, missing, dependencies: { inner: { version: "2.0.0", license: "MIT" } } },
      },
    });
    expect(checkPackage("p", "MIT", flatten(one("GPL-2.0-only")))).toHaveLength(1);
    expect(checkPackage("p", "MIT", flatten(one("MIT OR Apache-2.0")))).toEqual([]);
    expect(checkPackage("p", "MIT", flatten(one(undefined)))).toEqual(["p: dep@1.0.0 has no licence field"]);
    expect(checkPackage("p", "MIT", flatten(one({ type: "MIT" })))).toHaveLength(1);
    expect(checkPackage("p", "MIT", flatten(one("MIT", true)))).toEqual([
      "p: dep@1.0.0 is not installed, so its licence is unknown",
    ]);
    // A nested dependency is checked too, and a package with an unknown licence is itself a conflict.
    expect(flatten(one("MIT")).map((d) => d.name)).toEqual(["dep", "inner"]);
    expect(checkPackage("p", "GPL-3.0-only", [])).toHaveLength(1);
    expect(checkPackage("p", undefined, [])).toHaveLength(1);
  });

  test("spdx_expressions", () => {
    expect(satisfies("(MIT OR GPL-3.0-only)", PERMISSIVE)).toBe(true);
    expect(satisfies("MIT AND GPL-2.0-only", PERMISSIVE)).toBe(false);
    expect(satisfies("MIT AND (BSD-3-Clause OR GPL-2.0-only)", PERMISSIVE)).toBe(true);
    expect(satisfies("Apache-2.0 WITH LLVM-exception", PERMISSIVE)).toBe(true);
    // An exception may restrict the licence: only listed ones pass, and junk after WITH fails.
    for (const bad of ["MIT WITH Commons-Clause", "MIT WITH )", "MIT WITH (", "MIT WITH AND", "MIT WITH"]) {
      expect(satisfies(bad, PERMISSIVE), bad).toBe(false);
    }
    // Unparseable or unknown → not satisfied (fail closed).
    for (const bad of ["", "MIT OR", "(MIT", "MIT)", "SEE LICENSE IN LICENSE.md", "mit"]) {
      expect(satisfies(bad, PERMISSIVE), bad).toBe(false);
    }
  });

  test("deduped_subtree_still_checked", () => {
    // npm prints a deduped copy with its manifest but no children; the full copy's children must still be walked.
    const tree: LsNode = {
      dependencies: {
        a: { version: "1.0.0", license: "MIT", dependencies: { shared: { version: "1.0.0", license: "MIT" } } },
        shared: {
          version: "1.0.0",
          license: "MIT",
          dependencies: { evil: { version: "1.0.0", license: "GPL-3.0-only" } },
        },
      },
    };
    expect(checkPackage("p", "MIT", flatten(tree))).toEqual(["p (MIT): evil@1.0.0 is GPL-3.0-only"]);
    // A cycle ends.
    const loop: LsNode = { version: "1.0.0", license: "MIT" };
    loop.dependencies = { loop };
    expect(flatten({ dependencies: { loop } }).map((d) => d.name)).toEqual(["loop"]);
  });

  test("optional_peer_not_installed_skipped", () => {
    // An optional dependency that is not installed shows as `{}`: nothing ships, so nothing to license.
    expect(flatten({ dependencies: { fsevents: {} } })).toEqual([]);
    // A required one that is missing is still a conflict.
    expect(flatten({ dependencies: { x: { missing: true } } })).toHaveLength(1);
  });

  test("package_without_version_checked", () => {
    // npm prints `version` only when it is set; an installed package without one still ships, and so does its tree.
    const tree: LsNode = {
      dependencies: {
        nover: {
          license: "GPL-3.0-only",
          path: "/n/nover",
          dependencies: { evil: { version: "1.0.0", license: "GPL-3.0-only", path: "/n/evil" } },
        },
      },
    };
    expect(checkPackage("p", "MIT", flatten(tree))).toEqual([
      "p (MIT): nover@? is GPL-3.0-only",
      "p (MIT): evil@1.0.0 is GPL-3.0-only",
    ]);
  });

  test("root_dependency_not_listed_fails", () => {
    // With --workspaces, npm 11.19.1 leaves an uninstalled root dependency out of the JSON entirely (ls.js
    // filterBySelectedWorkspaces), so the manifest is compared with the tree. A missing optional one ships nothing.
    const manifest = { name: "r", dependencies: { gone: "1.0.0", here: "1.0.0" }, optionalDependencies: { opt: "1" } };
    const tree: LsNode = { dependencies: { here: { version: "1.0.0", license: "MIT", path: "/n/here" } } };
    expect(rootDependenciesNotListed(manifest, tree)).toEqual(["r: gone is not installed, so its licence is unknown"]);
  });

  test("nested_copy_different_licence_fails", () => {
    // Two installed copies of one name@version may carry different manifests; each copy's licence is checked.
    const tree: LsNode = {
      dependencies: {
        a: {
          version: "1.0.0",
          license: "MIT",
          dependencies: { x: { version: "1.0.0", license: "MIT", path: "/a/x" } },
        },
        b: {
          version: "1.0.0",
          license: "MIT",
          dependencies: { x: { version: "1.0.0", license: "GPL-3.0-only", path: "/b/x" } },
        },
      },
    };
    expect(checkPackage("p", "MIT", flatten(tree))).toEqual(["p (MIT): x@1.0.0 is GPL-3.0-only"]);
  });

  test("deduped_stub_expanded_by_path", () => {
    // npm 11.19.1 lists a package in full under one workspace and as a childless stub, at the same install path,
    // under the next; the stub's workspace still ships the full copy's dependencies.
    const lib = (dependencies: Record<string, LsNode> = {}): LsNode => ({
      version: "1.0.0",
      license: "MIT",
      path: "/n/lib",
      _dependencies: { evil: "^1.0.0" },
      dependencies,
    });
    const first: LsNode = {
      path: "/ws/first",
      dependencies: { lib: lib({ evil: { version: "1.0.0", license: "GPL-3.0-only", path: "/n/evil" } }) },
    };
    const second: LsNode = { path: "/ws/second", dependencies: { lib: lib() } };
    const index = indexByPath({ dependencies: { first, second } });
    expect(checkPackage("second", "MIT", flatten(second, index))).toEqual(["second (MIT): evil@1.0.0 is GPL-3.0-only"]);
  });

  test("missing_expansion_fails", () => {
    // A childless copy that declares dependencies but has no full copy anywhere fails closed.
    const stub = (fields: LsNode): LsNode => ({ dependencies: { s: { version: "1.0.0", license: "MIT", ...fields } } });
    const unlisted = ["p: s@1.0.0 has children not listed by npm ls"];
    expect(checkPackage("p", "MIT", flatten(stub({ path: "/s", _dependencies: { x: "*" } })))).toEqual(unlisted);
    expect(checkPackage("p", "MIT", flatten(stub({ path: "/s", peerDependencies: { x: "*" } })))).toEqual(unlisted);
    // An optional peer need not be installed, and a package that declares nothing has nothing to list.
    const optional = { path: "/s", peerDependencies: { x: "*" }, peerDependenciesMeta: { x: { optional: true } } };
    expect(checkPackage("p", "MIT", flatten(stub(optional)))).toEqual([]);
    expect(checkPackage("p", "MIT", flatten(stub({ path: "/s", _dependencies: {} })))).toEqual([]);
  });

  test("one_npm_ls_call", () => {
    // Every workspace is split out of one listed tree; a stub under the last workspace expands through the first.
    const root = manifest("package.json") as { name: string };
    const names = findWorkspaces(ROOT).map(({ pkg }) => String(pkg.name));
    const bad = { evil: { version: "1.0.0", license: "GPL-3.0-only", path: "/n/evil" } };
    const lib = { version: "1.0.0", license: "MIT", path: "/n/lib", _dependencies: { evil: "*" } };
    const workspace = (name: string, i: number): LsNode => ({
      version: "0.0.0",
      path: `/ws/${name}`,
      dependencies: i === 0 ? { lib: { ...lib, dependencies: bad } } : i === names.length - 1 ? { lib } : {},
    });
    let calls = 0;
    const list = () => {
      calls++;
      return { name: root.name, dependencies: Object.fromEntries(names.map((n, i) => [n, workspace(n, i)])) };
    };
    const conflicts = checkRepository(list);
    expect(calls).toBe(1);
    expect(conflicts.filter((c) => c.includes("evil@1.0.0")).map((c) => c.split(" ")[0])).toEqual([
      names[0],
      names[names.length - 1],
    ]);
  });

  // The bound is about 3x the measured run (0.44 s on npm 11.19.1, down from 2.4 s with one npm ls per workspace).
  test("repository_has_no_conflicts", { timeout: 1_500 }, () => {
    // The real tree through `npm ls`, as `node scripts/licence/check.ts` runs it.
    let calls = 0;
    expect(
      checkRepository(() => {
        calls++;
        return productionTree();
      }),
    ).toEqual([]);
    expect(calls).toBe(1);
  });
});
