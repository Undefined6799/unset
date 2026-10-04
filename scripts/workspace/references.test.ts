// The workspace convention (P1.01), shown on throwaway fixture trees and on the real repository.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { closureProblems, untypecheckedFiles, WORKSPACE_TOPS, workspaceProblems } from "./references.ts";

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
    const root = tree({ "apps/web": { dependencies: { "@unset/apps-admin": "*" } }, "apps/admin": {} });
    expect(workspaceProblems(root)).toContain("apps/web: may not reference apps/admin (MATRIX)");
  });

  test("domain_has_no_npm_dependencies", () => {
    const root = tree({ "domains/identity": { dependencies: { zod: "4.0.0" } } });
    expect(workspaceProblems(root)).toEqual(["domains/identity: a domain has no npm dependencies (AB-1)"]);
  });

  test("pds_admin_no_deps", () => {
    for (const service of ["interfaces/pds-admin", "interfaces/chat-admin"]) {
      const root = tree({ [service]: { dependencies: { undici: "1.0.0" } } });
      expect(workspaceProblems(root)).toEqual([`${service}: zero-dependency workspace depends on undici (plan §5.2)`]);
    }
  });

  test("pds_admin_may_depend_on_the_allowlist", () => {
    const source = 'import { x } from "@unset/shared-admin-envelope";\nexport const y = x;\n';
    const envelope = { "@unset/shared-admin-envelope": "*" };
    const root = tree({
      "interfaces/pds-admin": { source, references: ["shared/admin-envelope"], dependencies: envelope },
      "shared/admin-envelope": {},
    });
    expect(workspaceProblems(root)).toEqual([]);
    const notAllowlisted = tree({
      "interfaces/pds-admin": { references: ["shared/errors"], dependencies: { "@unset/shared-errors": "*" } },
      "shared/errors": {},
    });
    expect(workspaceProblems(notAllowlisted)).toEqual([
      "interfaces/pds-admin: may not reference shared/errors (MATRIX)",
      "interfaces/pds-admin: zero-dependency workspace depends on @unset/shared-errors (plan §5.2)",
    ]);
  });

  test("pds_admin_installed_closure_has_no_third_party", () => {
    const root = tree({
      "interfaces/pds-admin": { dependencies: { "@unset/shared-admin-envelope": "*" } },
      "shared/admin-envelope": { dependencies: { undici: "1.0.0" } },
    });
    // Install the tree by hand, the way npm links workspaces, so npm ls reads it offline.
    const put = (file: string, body: string): void => {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), body);
    };
    put("package.json", JSON.stringify({ name: "fixture", private: true, workspaces: ["interfaces/*", "shared/*"] }));
    put("node_modules/undici/package.json", JSON.stringify({ name: "undici", version: "1.0.0" }));
    for (const dir of ["interfaces/pds-admin", "shared/admin-envelope"]) {
      const [top, name] = dir.split("/");
      mkdirSync(join(root, "node_modules/@unset"), { recursive: true });
      symlinkSync(join(root, dir), join(root, `node_modules/@unset/${top}-${name}`), "dir");
    }
    expect(closureProblems(root)).toEqual([
      "interfaces/pds-admin: third-party package undici in the installed closure (plan §5.2)",
    ]);
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
      "shared/config": { source, references: ["shared/errors"], dependencies: { "@unset/shared-errors": "*" } },
      "shared/errors": {},
    });
    expect(workspaceProblems(declared)).toEqual([]);
  });

  test("references_are_resolved_paths", () => {
    const root = tree({ "domains/identity": {}, "infrastructure/pds": {}, "shared/errors": {} });
    const sneaky = {
      extends: "../../tsconfig.base.json",
      compilerOptions: { composite: true, rootDir: ".", outDir: "dist" },
    };
    const write = (references: string[]) =>
      writeFileSync(
        join(root, "domains/identity/tsconfig.json"),
        JSON.stringify({ ...sneaky, references: references.map((path) => ({ path })) }),
      );
    write(["../../shared/errors/../../infrastructure/pds"]);
    expect(workspaceProblems(root)).toEqual(["domains/identity: may not reference infrastructure/pds (MATRIX)"]);
    write(["../../shared/errors/"]);
    expect(workspaceProblems(root)).toEqual([]);
  });

  test("every_dependency_field_is_read", () => {
    const fields = ["devDependencies", "optionalDependencies", "peerDependencies"];
    for (const field of fields) {
      const domain = tree({ "domains/identity": {} });
      const pkg = { ...manifest("domains/identity"), [field]: { zod: "4.0.0" } };
      writeFileSync(join(domain, "domains/identity/package.json"), JSON.stringify(pkg));
      expect(workspaceProblems(domain), field).toEqual(["domains/identity: a domain has no npm dependencies (AB-1)"]);
      const service = tree({ "interfaces/pds-admin": {} });
      const servicePkg = { ...manifest("interfaces/pds-admin"), [field]: { pg: "8.0.0" } };
      writeFileSync(join(service, "interfaces/pds-admin/package.json"), JSON.stringify(servicePkg));
      expect(workspaceProblems(service), field).toEqual([
        "interfaces/pds-admin: zero-dependency workspace depends on pg (plan §5.2)",
      ]);
    }
  });

  test("side_effect_and_require_imports_are_seen", () => {
    for (const source of [
      'import "@unset/shared-errors";\n',
      'const e = require("@unset/shared-errors");\nexport { e };\n',
    ]) {
      const root = tree({ "shared/config": { source }, "shared/errors": {} });
      expect(workspaceProblems(root), source).toContain(
        "shared/config: imports @unset/shared-errors without it in tsconfig references",
      );
    }
  });

  test("workspace_tops_match_package_json", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { workspaces: string[] };
    expect(pkg.workspaces).toEqual(WORKSPACE_TOPS.map((top) => `${top}/*`));
  });

  test("matrix_targets_have_no_path_not", () => {
    // mayReference reads only `to.path`; a `to.pathNot` would need the same handling there first.
    const matrix = createRequire(import.meta.url)(join(ROOT, ".dependency-cruiser.cjs")).MATRIX as {
      to: object[];
    }[];
    expect(matrix.flatMap((row) => row.to).filter((to) => "pathNot" in to)).toEqual([]);
  });

  test("every_ts_file_is_typechecked", () => {
    expect(untypecheckedFiles(ROOT)).toEqual([]);
    const root = tree({});
    symlinkSync(join(ROOT, "node_modules"), join(root, "node_modules"), "dir");
    for (const file of ["tsconfig.base.json", "scripts/tsconfig.json"]) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), readFileSync(join(ROOT, file), "utf8"));
    }
    for (const file of ["scripts/a.ts", "vitest.config.ts", "tests/integration/x.test.ts", "domains/stray/d.ts"]) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), "export {};\n");
    }
    expect(untypecheckedFiles(root)).toEqual(["domains/stray/d.ts", "tests/integration/x.test.ts"]);
  });

  test("no_workspace_yet_passes", () => {
    expect(workspaceProblems(tree({}))).toEqual([]);
  });

  test("real_tree_conforms", () => {
    expect(workspaceProblems(ROOT)).toEqual([]);
    expect(closureProblems(ROOT)).toEqual([]);
  });

  test("typecheck_build_mode", () => {
    const tsc = spawnSync(join(ROOT, "node_modules", ".bin", "tsc"), ["-b"], { cwd: ROOT, encoding: "utf8" });
    expect(tsc.status, tsc.stdout).toBe(0);
  });
});
