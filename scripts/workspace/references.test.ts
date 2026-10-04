// The workspace convention (P1.01), shown on throwaway fixture trees and on the real repository.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { workspaceProblems } from "./references.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

type Spec = { references?: string[]; dependencies?: Record<string, string>; test?: boolean; source?: string };

const manifest = (dir: string, dependencies: Record<string, string> = {}) => {
  const [top, name] = dir.split("/");
  const license = top === "shared" ? "MIT" : "AGPL-3.0-only";
  return { name: `@unset/${top}-${name}`, private: true, type: "module", version: "0.0.0", license, dependencies };
};

/** A tree of conforming workspaces; each spec can add references, dependencies or code, or drop the test. */
function tree(workspaces: Record<string, Spec>): string {
  const root = mkdtempSync(join(tmpdir(), "workspaces-"));
  temps.push(root);
  const put = (file: string, body: unknown): void => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), typeof body === "string" ? body : JSON.stringify(body));
  };
  for (const [dir, spec] of Object.entries(workspaces)) {
    put(`${dir}/package.json`, manifest(dir, spec.dependencies));
    put(`${dir}/tsconfig.json`, {
      extends: "../../tsconfig.base.json",
      compilerOptions: { composite: true, rootDir: ".", outDir: "dist" },
      references: (spec.references ?? []).map((ref) => ({ path: `../../${ref}` })),
    });
    put(`${dir}/index.ts`, spec.source ?? "export const x = 1;\n");
    if (spec.test !== false) put(`${dir}/index.test.ts`, "");
  }
  const references = ["scripts", ...Object.keys(workspaces)].map((path) => ({ path }));
  put("tsconfig.json", { files: [], references });
  return root;
}

/** A tree where `from` references `to` (and `to` exists), checked. */
const reference = (from: string, to: string): string[] =>
  workspaceProblems(tree({ [from]: { references: [to] }, [to]: {} }));

describe("workspace references", () => {
  test("references_match_allowed", () => {
    const allowed: [string, string][] = [
      ["interfaces/api", "shared/ui"],
      ["interfaces/pds-admin", "shared/admin-envelope"],
      ["domains/identity", "shared/errors"],
      ["domains/identity", "shared/config"],
      ["domains/identity", "shared/lexicons"],
      ["interfaces/http", "domains/identity"],
      ["infrastructure/pds", "infrastructure/net-guard"],
    ];
    for (const [from, to] of allowed) expect(reference(from, to), `${from} → ${to}`).toEqual([]);
    const refused: [string, string][] = [
      ["apps/web", "infrastructure/postgres"],
      ["domains/identity", "infrastructure/pds"],
      ["apps/web", "apps/admin"],
      ["shared/config", "domains/identity"],
      ["interfaces/api", "interfaces/http"],
      ["interfaces/pds-admin", "shared/config"],
      ["domains/identity", "shared/http"],
      ["domains/identity", "shared/log"],
    ];
    for (const [from, to] of refused) {
      expect(reference(from, to), `${from} → ${to}`).toEqual([`${from}: may not reference ${to} (MATRIX)`]);
    }
  });

  test("references_read_package_dependencies_too", () => {
    const root = tree({ "apps/web": { dependencies: { "@unset/apps-admin": "0.0.0" } }, "apps/admin": {} });
    expect(workspaceProblems(root)).toContain("apps/web: may not reference apps/admin (MATRIX)");
  });

  test("domain_has_no_npm_dependencies", () => {
    const root = tree({ "domains/identity": { dependencies: { zod: "4.0.0" } } });
    expect(workspaceProblems(root)).toEqual(["domains/identity: a domain has no npm dependencies (AB-1)"]);
  });

  test("pds_admin_no_deps", () => {
    for (const service of ["interfaces/pds-admin", "interfaces/chat-admin"]) {
      const root = tree({ [service]: { dependencies: { undici: "1.0.0" } } });
      expect(workspaceProblems(root)).toEqual([`${service}: zero-dependency workspace has dependencies (plan §5.2)`]);
    }
  });

  test("allowlisted_workspace_has_no_references", () => {
    const root = tree({ "shared/admin-envelope": { references: ["shared/errors"] }, "shared/errors": {} });
    expect(workspaceProblems(root)).toContain(
      "shared/admin-envelope: zero-dependency allowlist workspace has references",
    );
  });

  test("unknown_top_level_folder", () => {
    expect(workspaceProblems(tree({ "packages/core": {} }))).toEqual([
      "packages/: folder not allowed (decisions 25 and 34)",
      "packages/core: workspace outside the decision-34 folders",
    ]);
    expect(workspaceProblems(tree({ "lib/core": {} }))).toEqual([
      "lib/core: workspace outside the decision-34 folders",
    ]);
  });

  test("every_workspace_has_a_test", () => {
    expect(workspaceProblems(tree({ "shared/errors": { test: false } }))).toEqual(["shared/errors: has no *.test.ts"]);
  });

  test("root_tsconfig_references_every_workspace", () => {
    const root = tree({ "shared/errors": {} });
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ files: [], references: [] }));
    expect(workspaceProblems(root)).toEqual([
      "tsconfig.json: references no scripts project",
      "tsconfig.json: references no shared/errors",
    ]);
  });

  test("manifest_follows_the_convention", () => {
    const root = tree({ "shared/errors": {} });
    writeFileSync(
      join(root, "shared/errors/package.json"),
      JSON.stringify({ ...manifest("domains/x"), name: "errors" }),
    );
    expect(workspaceProblems(root)).toEqual([
      'shared/errors: package.json license is "AGPL-3.0-only", expected "MIT"',
      'shared/errors: package.json name is "errors", expected "@unset/shared-errors"',
    ]);
  });

  test("import_needs_dependency_and_reference", () => {
    const source = 'import { x } from "@unset/shared-errors";\nexport const y = x;\n';
    const root = tree({ "shared/config": { source }, "shared/errors": {} });
    expect(workspaceProblems(root)).toEqual([
      "shared/config: imports @unset/shared-errors without it in package.json dependencies",
      "shared/config: imports @unset/shared-errors without it in tsconfig references",
    ]);
    const declared = tree({
      "shared/config": { source, references: ["shared/errors"], dependencies: { "@unset/shared-errors": "0.0.0" } },
      "shared/errors": {},
    });
    expect(workspaceProblems(declared)).toEqual([]);
  });

  test("no_workspace_yet_passes", () => {
    expect(workspaceProblems(tree({}))).toEqual([]);
  });

  test("real_tree_conforms", () => {
    expect(workspaceProblems(ROOT)).toEqual([]);
  });

  test("typecheck_build_mode", () => {
    const tsc = spawnSync(join(ROOT, "node_modules", ".bin", "tsc"), ["-b"], { cwd: ROOT, encoding: "utf8" });
    expect(tsc.status, tsc.stdout).toBe(0);
  });
});
