// P0.13: the licence files agree with ADR 0012, and the compatibility check finds what it must.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { findWorkspaces } from "../workspace/references.ts";
import { checkPackage, checkRepository, flatten, type LsNode, PERMISSIVE, satisfies } from "./check.ts";

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

  test("repository_has_no_conflicts", () => {
    // The real tree through `npm ls`, as `node scripts/licence/check.ts` runs it.
    expect(checkRepository()).toEqual([]);
  });
});
