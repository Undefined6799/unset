// The boundary rules in scripts/lint/.dependency-cruiser.cjs, checked edge by edge on throwaway fixture trees (P0.05).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { cruise, type ICruiseResult } from "dependency-cruiser";
import { afterAll, describe, expect, test } from "vitest";
import { sourceFiles } from "../guards/files.ts";
import {
  CONFIG_PATH,
  check,
  config,
  cruiseFixture,
  cruiseResult,
  DEPCRUISE,
  type Edge,
  edge,
  fixture,
  outcome,
  ROOT,
  RULES,
  removeFixtures,
  target,
  tempDir,
  write,
} from "./depcruise-fixture.ts";

afterAll(removeFixtures);

async function expectPass(...edges: Edge[]): Promise<void> {
  for (const e of edges) expect(await check([e]), `${e.from} → ${e.spec}`).toEqual({ exitCode: 0, rules: [] });
}

async function expectFail(rule: string | null, ...edges: Edge[]): Promise<void> {
  for (const e of edges) {
    const { exitCode, rules } = await check([e]);
    expect(exitCode, `${e.from} → ${e.spec}`).not.toBe(0);
    if (rule) expect(rules, `${e.from} → ${e.spec}`).toContain(rule);
  }
}

/** Where the fixture's edge must resolve: its target file, the core module, the stub package, or itself if unresolved. */
function resolvedPath(e: Edge): string {
  if (e.unresolved) return e.spec;
  if (e.spec.startsWith("node:")) return e.spec.slice("node:".length);
  return target(e) ?? `node_modules/${e.spec}/index.js`;
}

/** The cruise holds the edge as written: same spelling, resolved path and import kind (P1.30f). */
function cruised(result: ICruiseResult, e: Edge): boolean {
  const deps = result.modules.find((m) => m.source === e.from)?.dependencies ?? [];
  return deps.some(
    (d) =>
      (d.protocol ?? "") + d.module === e.spec &&
      d.resolved === resolvedPath(e) &&
      d.couldNotResolve === (e.unresolved ?? false) &&
      d.dynamic === (e.kind === "dynamic") &&
      d.dependencyTypes.includes("type-only") === (e.kind === "type"),
  );
}

/**
 * `from → spec` pairs that occur more than once across rows, with the rows they occur in. One cruise keeps only the
 * first import of a specifier per file, so a second (say dynamic beside static) would never be checked.
 */
function duplicatePairs(rows: Record<string, Edge[]>): string[] {
  const seen = new Map<string, string[]>();
  for (const [row, edges] of Object.entries(rows)) {
    for (const e of edges) {
      const key = `${e.from} → ${e.spec}`;
      seen.set(key, [...(seen.get(key) ?? []), row]);
    }
  }
  return [...seen].filter(([, where]) => where.length > 1).map(([key, where]) => `${key}: ${where.join(", ")}`);
}

/**
 * Cruises `from` importing each specifier, beside two stub packages shaped like real ones. `exp-only` has an `exports`
 * map and no `main`: `.` (into its dist/), `./public` and a conditional `./conditional` are exported, and private.js
 * ships but is not. `main-dist` has only `main: dist/index.js`. apps/web/dist/server.js stands for our own build output.
 */
async function packageCruise(from: string, specs: string[]): Promise<ICruiseResult> {
  const root = tempDir();
  write(root, from, specs.map((spec, n) => `import * as m${n} from "${spec}";\nexport { m${n} };\n`).join(""));
  const exportsMap = {
    ".": "./dist/index.js",
    "./public": "./public.js",
    "./conditional": { import: "./esm.js", require: "./cjs.js", default: "./cjs.js" },
  };
  write(root, "node_modules/exp-only/package.json", JSON.stringify({ name: "exp-only", exports: exportsMap }));
  for (const file of ["dist/index.js", "public.js", "esm.js", "cjs.js", "private.js"]) {
    write(root, `node_modules/exp-only/${file}`, "module.exports = {};\n");
  }
  write(root, "node_modules/main-dist/package.json", JSON.stringify({ name: "main-dist", main: "dist/index.js" }));
  write(root, "node_modules/main-dist/dist/index.js", "module.exports = {};\n");
  write(root, "apps/web/dist/server.js", "export const x = 1;\n");
  const dependencies = { "exp-only": "1.0.0", "main-dist": "1.0.0" };
  write(root, "package.json", JSON.stringify({ name: "fixture", private: true, dependencies }));
  const { output } = await cruise(["."], {
    ...config.options,
    baseDir: root,
    validate: true,
    ruleSet: REAL_RULES,
    outputType: "json",
  });
  return JSON.parse(String(output));
}

/** Where `from`'s import of `spec` resolved in a packageCruise; undefined when the cruise dropped the edge. */
function resolved(
  result: ICruiseResult,
  from: string,
  spec: string,
): { resolved: string; couldNotResolve: boolean } | undefined {
  const dep = result.modules.find((m) => m.source === from)?.dependencies.find((d) => d.module === spec);
  return dep && { resolved: dep.resolved, couldNotResolve: dep.couldNotResolve };
}

const FAKE = "infrastructure/arachnid/fingerprint-check.fake.ts";

/** At least one passing edge per MATRIX row (AB-1: one fixture per matrix row). */
const ROW_FIXTURES: Record<string, Edge[]> = {
  "pds-presentation": [edge("apps/pds/src/view.tsx", "./other.tsx"), edge("apps/pds/src/view.tsx", "react")],
  app: [
    edge("apps/web/a.ts", "./b.ts"),
    edge("apps/web/a.ts", "../../shared/ui/index.ts"),
    edge("apps/chat/matrix/a.ts", "matrix-js-sdk"),
  ],
  interface: [
    edge("interfaces/http/a.ts", "./routes/b.ts"),
    edge("interfaces/http/a.ts", "../../domains/identity/b.ts"),
    edge("interfaces/http/a.ts", "../../infrastructure/pds/index.ts"),
    edge("interfaces/http/a.ts", "node:http"),
    edge("interfaces/admin/a.ts", "../../shared/http/index.ts"),
    edge("interfaces/http/compose.ts", `../../${FAKE}`, "dynamic"),
  ],
  "interface-http-render": [edge("interfaces/http/a.ts", `../../${config.RENDER_ENTRIES.http}`)],
  "interface-http-render-build": [
    {
      from: config.RENDER_BUILD_IMPORT.from,
      spec: config.RENDER_BUILD_IMPORT.module,
      kind: "dynamic",
      unresolved: true,
    },
  ],
  "interface-admin-render": [edge("interfaces/admin/a.ts", `../../${config.RENDER_ENTRIES.admin}`)],
  "admin-service": [
    edge("interfaces/pds-admin/a.ts", "../../shared/admin-envelope/index.ts"),
    edge("interfaces/chat-admin/a.ts", "../../shared/admin-envelope/index.ts"),
    edge("interfaces/pds-admin/a.ts", "./b.ts"),
    edge("interfaces/pds-admin/a.ts", "node:crypto"),
  ],
  domain: [
    edge("domains/identity/a.ts", "./sessions/b.ts"),
    edge("domains/identity/a.ts", "../../shared/errors/index.ts"),
    edge("domains/identity/a.ts", "../../shared/lexicons/index.ts"),
    edge("domains/identity/a.ts", "../content/index.ts"),
    edge("domains/identity/a.ts", "node:crypto"),
    edge("domains/identity/a.ts", "../../shared/config/index.ts", "type"),
    edge("domains/content/a.ts", "../identity/index.ts"),
  ],
  infrastructure: [
    edge("infrastructure/pds/a.ts", "../../domains/identity/contract.ts"),
    edge("infrastructure/postgres/a.ts", "pg"),
    edge("infrastructure/postgres/a.ts", "./b.ts"),
    edge("infrastructure/pds/a.ts", "../net-guard/index.ts"),
    edge("infrastructure/storage/a.ts", "../seal/index.ts"),
    edge("infrastructure/pds/a.ts", "../../shared/config/index.ts"),
  ],
  "net-guard": [
    edge("infrastructure/net-guard/a.ts", "undici"),
    edge("infrastructure/net-guard/a.ts", "./b.ts"),
    edge("infrastructure/net-guard/a.ts", "node:dns"),
  ],
  shared: [edge("shared/config/a.ts", "../errors/index.ts"), edge("shared/http/a.ts", "node:http")],
  "shared-ui-lexicons": [edge("shared/lexicons/a.ts", "@atproto/lex"), edge("shared/ui/a.ts", "./b.ts")],
  "shared-lexicons-scripts": [
    edge("shared/lexicons/scripts/build.ts", "../src/a.ts"),
    edge("shared/lexicons/scripts/build.ts", "./b.ts"),
    edge("shared/lexicons/scripts/build.ts", "@atproto/lex-cli"),
    ...config.LEXICON_SCRIPT_BUILTINS.map((name) => edge("shared/lexicons/scripts/build.ts", `node:${name}`)),
  ],
  "shared-ui-islands": [edge("shared/ui/a.ts", "../islands/index.ts")],
  "shared-islands": [edge("shared/islands/a.ts", "./b.ts"), edge("shared/islands/a.ts", "left-pad")],
  "shared-ui-build": [
    edge("shared/ui-build/a.ts", "./b.ts"),
    edge("shared/ui-build/a.ts", "../ui/index.ts", "type"),
    edge("shared/ui-build/a.ts", "left-pad"),
  ],
  "shared-admin-envelope": [
    edge("shared/admin-envelope/a.ts", "node:crypto"),
    edge("shared/admin-envelope/a.ts", "./b.ts"),
  ],
  "shared-host-pin": [edge("shared/host-pin/a.ts", "node:fs"), edge("shared/host-pin/a.ts", "./b.ts")],
  "deployment-preflight": [
    edge("deployment/preflight/a.ts", "./checks/b.ts"),
    edge("deployment/preflight/a.ts", "yaml"),
    edge("deployment/preflight/a.ts", "node:child_process"),
    edge("deployment/preflight/checks/a.ts", "../../edge/caddyfile.ts"),
    // P1.33i: the index only. The row-alone cruise fails until the row allows this file.
    edge("deployment/preflight/a.ts", "../../shared/host-pin/index.ts"),
  ],
  tooling: [
    edge("tests/integration/a.test.ts", "../../scripts/guards/files.ts"),
    edge("infrastructure/arachnid/fingerprint-check.test.ts", "./fingerprint-check.fake.ts"),
    edge("tests/integration/a.test.ts", `../../${FAKE}`),
  ],
};

/** One real file per top-level area, cruised with the real config (P1.28z). */
const REAL_FILES = [
  "apps/web/render.tsx",
  "domains/identity/index.ts",
  "shared/errors/index.ts",
  "shared/host-pin/index.ts",
  "shared/host-pin/index.test.ts",
  "infrastructure/net-guard/index.ts",
  "interfaces/http/main.ts",
  "deployment/preflight/index.ts",
  "scripts/guards/files.ts",
];

const REAL_RULES: object = {
  allowed: config.allowed,
  allowedSeverity: config.allowedSeverity,
  forbidden: config.forbidden,
};

describe("dependency-cruiser runs", () => {
  test("depcruise_cruised_nonzero", async () => {
    const root = fixture([edge("scripts/a.ts", "./b.ts")]);
    const small = spawnSync(DEPCRUISE, ["--config", CONFIG_PATH, "--output-type", "json", "."], {
      cwd: root,
      encoding: "utf8",
    });
    expect(small.status, small.stderr).toBe(0);
    const json: ICruiseResult = JSON.parse(small.stdout);
    expect(json.summary.totalCruised).toBe(2);
    expect(json.modules.find((m) => m.source === "scripts/a.ts")?.dependencies.map((d) => d.resolved)).toEqual([
      "scripts/b.ts",
    ]);

    // The real config on one real file per top-level area (P1.28z): no `exclude` or path rule may drop an area. The
    // whole tree is cruised by `npm run lint`; cruising it here as well took about 3 s and timed out under load.
    for (const file of REAL_FILES) expect(existsSync(join(ROOT, file)), `${file} no longer exists`).toBe(true);
    // In process with the config's own options and rules: the fixture half above already covers the CLI loading it.
    const { output } = await cruise(REAL_FILES, {
      ...config.options,
      baseDir: ROOT,
      validate: true,
      ruleSet: REAL_RULES,
      outputType: "json",
    });
    const real: ICruiseResult = JSON.parse(String(output));
    expect(real.summary.error).toBe(0);
    const cruised = real.modules.map((m) => m.source);
    for (const file of REAL_FILES) expect(cruised, file).toContain(file);
  });
});

describe("boundary rules", () => {
  test("depcruise_app_to_app", async () => {
    const { exitCode, rules } = await check([edge("apps/web/a.ts", "../../apps/admin/b.ts")]);
    expect(exitCode).not.toBe(0);
    expect(rules.some((r) => r === "web-not-admin" || r === "no-app-to-app")).toBe(true);
    await expectFail("no-app-to-app", edge("apps/chat/a.ts", "../../apps/web/b.ts"));
  });

  test("depcruise_pds_admin_builtins", async () => {
    for (const service of ["pds-admin", "chat-admin"]) {
      const from = `interfaces/${service}/a.ts`;
      await expectFail("admin-services-zero-deps", edge(from, "undici"), edge(from, "../../shared/config/index.ts"));
      await expectPass(edge(from, "../../shared/admin-envelope/index.ts"));
    }
  });

  test("depcruise_allowlist_zero_deps", async () => {
    await expectFail(
      "allowlist-zero-deps",
      edge("shared/admin-envelope/a.ts", "../config/index.ts"),
      edge("shared/admin-envelope/a.ts", "undici"),
    );
  });

  test("depcruise_allowlist_exact", () => {
    expect(config.ZERO_DEP_ALLOWLIST).toEqual(["shared/admin-envelope/"]);
  });

  test("depcruise_no_interface_to_interface", async () => {
    await expectFail("no-interface-to-interface", edge("interfaces/api/a.ts", "../http/b.ts"));
  });

  test("depcruise_app_render_entry", async () => {
    await expectFail("app-render-entry-only", edge("interfaces/api/a.ts", "../../apps/web/render.tsx"));
    await expectPass(edge("interfaces/http/a.ts", `../../${config.RENDER_ENTRIES.http}`));
    await expectFail("app-render-entry-only", edge("interfaces/http/a.ts", "../../apps/web/other.ts"));
    await expectFail("app-render-entry-only", edge("interfaces/admin/a.ts", "../../apps/admin/other.ts"));
  });

  test("depcruise_sdk_adapter", async () => {
    await expectFail("vendor-sdk-one-adapter", edge("infrastructure/storage/a.ts", "pg"));
    await expectFail("vendor-sdk-one-adapter", edge("apps/web/a.ts", "matrix-js-sdk"));
    await expectPass(edge("apps/chat/matrix/a.ts", "matrix-js-sdk"));
  });

  test("depcruise_forbidden_edges", async () => {
    await expectFail(
      "app-only-shared",
      edge("apps/web/a.ts", "../../infrastructure/postgres/index.ts"),
      edge("apps/web/a.ts", "../../domains/identity/b.ts"),
    );
    await expectFail(
      "domain-pure",
      edge("domains/identity/a.ts", "../../infrastructure/pds/index.ts"),
      edge("domains/identity/a.ts", "../../interfaces/http/b.ts"),
      edge("domains/identity/a.ts", "../../apps/web/b.ts"),
    );
    await expectFail("infrastructure-not-entry", edge("infrastructure/pds/a.ts", "../../interfaces/http/b.ts"));
    await expectFail("shared-leaf", edge("shared/config/a.ts", "../../domains/identity/b.ts"));
    await expectFail("vendor-sdk-one-adapter", edge("domains/identity/a.ts", "pg"));
    await expectFail("web-not-admin", edge("interfaces/http/a.ts", "../../apps/admin/b.ts"));
    await expectFail("domain-cross-via-index", edge("domains/content/a.ts", "../identity/sessions/b.ts"));
    await expectPass(edge("domains/content/a.ts", "../identity/index.ts"));
    await expectFail("domain-no-io-builtins", edge("domains/identity/a.ts", "node:fs"));
    await expectPass(edge("domains/identity/a.ts", "node:crypto"));
    await expectFail(
      "no-product-imports-tooling",
      edge("domains/identity/a.ts", "../../scripts/guards/files.ts"),
      edge("interfaces/http/a.ts", "../../scripts/guards/files.ts"),
    );
    await expectPass(edge("tests/integration/a.test.ts", "../../scripts/guards/files.ts"));
  });

  test("depcruise_infra_shared_via_index", async () => {
    await expectFail(
      "infra-shared-via-index",
      edge("interfaces/http/a.ts", "../../shared/http/csrf.ts"),
      edge("interfaces/http/a.ts", "../../infrastructure/postgres/pool.ts"),
      edge("infrastructure/pds/a.ts", "../net-guard/classify.ts"),
      edge("shared/config/a.ts", "../errors/codes.ts"),
      edge("domains/identity/a.ts", "../../shared/errors/codes.ts"),
      edge("tests/integration/a.test.ts", "../../infrastructure/postgres/pool.ts"),
      edge("interfaces/http/a.ts", "../../shared/config/schema.ts", "type"),
    );
    await expectPass(
      edge("interfaces/http/a.ts", "../../shared/http/index.ts"),
      edge("tests/integration/a.test.ts", "../../infrastructure/postgres/index.ts"),
      edge("infrastructure/postgres/a.ts", "./pool/b.ts"),
      edge("infrastructure/postgres/pool.test.ts", "./pool.ts"),
      edge("apps/web/a.ts", "../../shared/ui/button.module.css"),
      edge("interfaces/http/compose.ts", `../../${FAKE}`, "dynamic"),
    );
  });

  test("depcruise_domain_imports", async () => {
    await expectPass(...(ROW_FIXTURES.domain ?? []));
    const from = "domains/identity/a.ts";
    await expectFail(
      "not-in-allowed",
      edge(from, "../../shared/config/index.ts"),
      edge(from, "../../shared/log/index.ts"),
      edge(from, "zod"),
      edge(from, "@atproto/lex"),
    );
  });

  test("depcruise_fake_only_in_composition_root", async () => {
    await expectPass(edge("interfaces/http/compose.ts", `../../${FAKE}`, "dynamic"));
    await expectFail("fake-only-in-composition-root", edge("interfaces/http/compose.ts", `../../${FAKE}`));
    await expectFail(
      "fake-only-in-composition-root",
      edge("interfaces/http/routes/a.ts", `../../../${FAKE}`),
      edge("interfaces/http/main.ts", `../../${FAKE}`),
      edge("infrastructure/arachnid/arachnid-check.ts", "./fingerprint-check.fake.ts"),
      edge("domains/moderation/a.ts", `../../${FAKE}`),
    );
    await expectPass(
      edge("infrastructure/arachnid/fingerprint-check.test.ts", "./fingerprint-check.fake.ts"),
      edge("tests/integration/a.test.ts", `../../${FAKE}`),
    );
  });

  test("depcruise_net_guard_leaf", async () => {
    await expectFail(
      "net-guard-leaf",
      edge("infrastructure/net-guard/a.ts", "../seal/index.ts"),
      edge("infrastructure/net-guard/a.ts", "zod"),
      edge("infrastructure/net-guard/src/a.ts", "fast-check"),
      edge("infrastructure/net-guard/src/a.test.ts", "zod"),
      edge("infrastructure/net-guard/src/a.test.ts", "../../seal/index.ts"),
    );
  });

  test("depcruise_net_guard_tests_may_use_fast_check", async () => {
    // Test files never ship, so property tests (TE-6) may use fast-check; shipped files may not (ruling 2026-10-04).
    await expectPass(edge("infrastructure/net-guard/src/a.test.ts", "fast-check"));
  });

  test("depcruise_no_circular", async () => {
    const { exitCode, rules } = await check([
      edge("domains/identity/a.ts", "./b.ts"),
      edge("domains/identity/b.ts", "./a.ts"),
    ]);
    expect(exitCode).not.toBe(0);
    expect(rules).toContain("no-circular");
  });

  test("depcruise_root_files_are_not_tooling", async () => {
    // Only *.config.* files at the root are tooling; any other root file has no MATRIX row.
    await expectFail("not-in-allowed", edge("server.ts", "./domains/identity/b.ts"));
    await expectPass(edge("vitest.config.ts", "./scripts/guards/files.ts"));
  });

  test("app_build_config_is_tooling", async () => {
    // P1.23v: an app's vite.config.ts may use Node and the shared class-name hash; app source may not, and nothing
    // imports the config.
    await expectPass(
      edge("apps/web/vite.config.ts", "node:crypto"),
      edge("apps/web/vite.config.ts", "../../scripts/ui/css-scope.ts"),
    );
    await expectFail(null, edge("apps/web/src/a.ts", "node:crypto"));
    await expectFail("app-only-shared", edge("apps/web/src/a.ts", "../../../scripts/ui/css-scope.ts"));
    await expectFail(
      "app-build-config-not-imported",
      edge("apps/web/render.tsx", "./vite.config.ts"),
      edge("scripts/budgets/a.ts", "../../apps/web/vite.config.ts"),
    );
    await expectFail(null, edge("apps/web/src/vite.config.ts", "node:crypto"));
    await expectFail(
      "app-build-config-imports",
      edge("apps/web/vite.config.ts", "../../scripts/guards/x.ts"),
      edge("apps/web/vite.config.ts", "../../domains/identity/index.ts"),
      edge("apps/web/vite.config.ts", "../admin/b.ts"),
    );
    await expectPass(
      edge("apps/web/vite.config.ts", "./src/a.ts"),
      edge("apps/web/vite.config.ts", "../../shared/ui/index.ts"),
      edge("apps/web/vite.config.ts", "vite"),
    );
  });

  test("depcruise_fake_tsx_and_render_prefix", async () => {
    await expectFail("fake-only-in-composition-root", edge("interfaces/http/routes/a.ts", "../x.fake.tsx"));
    await expectFail("app-render-entry-only", edge("interfaces/http/a.ts", "../../apps/web/render.tsx/x.ts"));
  });

  const ISLANDS = ["apps/web/src/islands/demo.island.tsx", "shared/ui/islands/menu.island.tsx"];
  const up = (island: string) => "../".repeat(island.split("/").length - 1);

  test("island_import_boundary", async () => {
    for (const island of ISLANDS) {
      await expectFail("island-import-boundary", edge(island, `${up(island)}domains/identity/index.ts`));
      await expectFail("island-import-boundary", edge(island, `${up(island)}infrastructure/postgres/index.ts`));
      await expectFail("island-import-boundary", edge(island, `${up(island)}interfaces/http/compose.ts`));
      await expectFail("island-import-boundary", edge(island, `${up(island)}shared/config/index.ts`));
      await expectPass(edge(island, `${up(island)}shared/ui/index.ts`));
      await expectPass(edge(island, `${up(island)}shared/islands/index.ts`));
    }
    await expectFail("island-import-boundary", edge(ISLANDS[0] as string, "../server/session.ts"));
    await expectPass(edge(ISLANDS[0] as string, "../../../../shared/config/index.ts", "type"));
  });

  test("island_imports_jsx_runtime_passes", async () => {
    for (const island of ISLANDS) await expectPass(edge(island, "react/jsx-runtime"));
  });

  test("island_imports_other_subpath_fails", async () => {
    for (const island of ISLANDS) {
      await expectFail("island-import-boundary", edge(island, "react/jsx-dev-runtime"), edge(island, "react"));
    }
  });

  test("island_imports_unrelated_package_fails", async () => {
    for (const island of ISLANDS) await expectFail("island-import-boundary", edge(island, "left-pad"));
  });

  test("island_imports_node_builtin_fails", async () => {
    for (const island of ISLANDS) await expectFail("island-import-boundary", edge(island, "node:fs"));
  });

  test("depcruise_scans_every_source_file", () => {
    // dependency-cruiser reads .mts/.cts only with the TypeScript parser, which TypeScript 7 no longer
    // provides, so such a file would skip every boundary. None may exist until that changes.
    const unscanned = sourceFiles(ROOT, ["."]).filter((f) => /\.(mts|cts)$/.test(f));
    expect(unscanned).toEqual([]);
  });

  test("fake_files_outside_domains", () => {
    const fakesInDomains = (root: string) => sourceFiles(root, ["domains"]).filter((f) => f.endsWith(".fake.ts"));
    expect(fakesInDomains(ROOT)).toEqual([]);
    const root = tempDir();
    write(root, "domains/x/y.fake.ts", "export {};\n");
    expect(fakesInDomains(root)).toEqual(["domains/x/y.fake.ts"]);
  });
});

describe("allowlist matrix", () => {
  test("depcruise_allowed_edges", async () => {
    // One cruise over every row edge (P1.30e): one per edge took about 3 s and timed out under full-suite load.
    const edges = Object.values(ROW_FIXTURES).flat();
    expect(duplicatePairs(ROW_FIXTURES).join("\n"), "a from → spec pair in two rows").toBe("");
    // A target that is also an importing file would mix two edges' contents in one file.
    const importers = new Set(edges.map((e) => e.from));
    expect(edges.map(target).filter((file) => file !== undefined && importers.has(file))).toEqual([]);
    const result = await cruiseResult(edges, RULES);
    for (const e of edges) expect(cruised(result, e), `${e.from} → ${e.spec} was not cruised`).toBe(true);
    if (outcome(result).exitCode !== 0 || outcome(result).rules.length > 0) await expectPass(...edges);
    expect(outcome(result), "edges that pass alone fail together").toEqual({ exitCode: 0, rules: [] });
  });

  test("row_coverage_is_exact", async () => {
    const local = edge("apps/web/a.ts", "./b.ts");
    const dynamic = edge("interfaces/http/compose.ts", "../x/fake.ts", "dynamic");
    const result = await cruiseResult([local, dynamic], RULES);
    expect([cruised(result, local), cruised(result, dynamic)]).toEqual([true, true]);
    // A row whose resolved target is not the file the fixture wrote.
    const moved = structuredClone(result);
    for (const m of moved.modules) for (const d of m.dependencies) d.resolved = `${d.resolved}.elsewhere`;
    expect(cruised(moved, local)).toBe(false);
    // A dynamic row checked as static, and a static row as type-only.
    expect(cruised(result, edge(dynamic.from, dynamic.spec))).toBe(false);
    expect(cruised(result, edge(local.from, local.spec, "type"))).toBe(false);
    // The same (from, spec) in two rows: dependency-cruiser keeps only the first, so the pair must be unique.
    expect(duplicatePairs({ one: [local], two: [edge(local.from, local.spec, "dynamic")] })).toEqual([
      "apps/web/a.ts → ./b.ts: one, two",
    ]);
  });

  test("depcruise_unlisted_edge_fails", async () => {
    expect(config.allowedSeverity).toBe("error");
    expect(Array.isArray(config.allowed) && config.allowed.length > 0).toBe(true);
    await expectFail(
      "not-in-allowed",
      edge("domains/identity/a.ts", "../../shared/http/index.ts"),
      edge("infrastructure/storage/a.ts", "../audit/index.ts"),
      edge("shared/ui/a.ts", "../config/index.ts"),
    );
  });

  test("shared_ui_build_is_pure", async () => {
    // P1.25w (architecture ruling 2026-10-07-p125h-follow-ups, N2): the build runners take their IO injected, so no
    // Node built-in, and they see shared/ui only as types through its index.
    await expectFail(
      "not-in-allowed",
      edge("shared/ui-build/a.ts", "node:fs"),
      edge("shared/ui-build/a.ts", "../ui/index.ts"),
      edge("shared/ui-build/a.ts", "../ui/b.ts", "type"),
    );
    // shared/ui's own row stops at its trailing slash, so it never covers shared/ui-build.
    const uiFrom = config.MATRIX.find((row) => row.name === "shared-ui-lexicons")?.from as
      | { path?: string }
      | undefined;
    expect(new RegExp(uiFrom?.path ?? "$^").test("shared/ui-build/a.ts")).toBe(false);
    expect(new RegExp(uiFrom?.path ?? "$^").test("shared/ui/a.ts")).toBe(true);
  });

  test("shared_islands_is_a_leaf", async () => {
    // P1.25o: the island runtime ships to the browser, so it reaches only itself and npm (no Node built-in), and never
    // the kit, which imports it. The kit sees it only through its index (DC-2).
    await expectFail(
      "not-in-allowed",
      edge("shared/islands/a.ts", "node:fs"),
      edge("shared/islands/a.ts", "../ui/index.ts"),
      edge("shared/islands/a.ts", "../ui/index.ts", "type"),
      edge("shared/ui/a.ts", "../islands/props.ts"),
      // The kit's edge to the runtime adds the index alone: no Node built-in for the kit, and no other leaf gains it.
      edge("shared/ui/a.ts", "node:fs"),
      edge("shared/lexicons/a.ts", "../islands/index.ts"),
    );
  });

  test("deployment_preflight_is_a_leaf", async () => {
    // P1.30q: the preflight reaches only itself, Node built-ins and the yaml parser; it runs verify-images as a child
    // process, never by import, and nothing outside it imports it. Two files outside itself are allowed: the edge
    // reader deployment/edge/caddyfile.ts (P1.30u, Alex's "Allow import" 2026-10-12T02:16:16Z), and shared/host-pin's
    // index only (P1.33i, DC-2; Alex's typed line 2026-10-14). Never a test, a sibling, or a file whose name only
    // starts the same.
    await expectPass(edge("deployment/preflight/a.ts", "../../shared/host-pin/index.ts"));
    await expectFail(
      "not-in-allowed",
      edge("deployment/preflight/a.ts", "../edge/caddyfile.test.ts"),
      edge("deployment/preflight/a.ts", "../edge/caddyfile.image.test.ts"),
      edge("deployment/preflight/a.ts", "../edge/caddyfile.ts.bak.ts"),
      edge("deployment/preflight/a.ts", "../edge/edge.test.ts"),
      edge("deployment/preflight/a.ts", "../edge/sites/caddyfile.ts"),
      edge("deployment/preflight/a.ts", "../../x/deployment/edge/caddyfile.ts"),
      // Only the preflight gains the edge reader: no other deployment/ file may import it (P1.30r).
      edge("deployment/images/a.ts", "../edge/caddyfile.ts"),
      edge("deployment/preflight/a.ts", "../../scripts/ci/verify-images.ts"),
      // P1.33i red fixtures: any other shared module, and a non-index file of shared/host-pin/.
      edge("deployment/preflight/a.ts", "../../shared/config/index.ts"),
      edge("deployment/preflight/a.ts", "../../shared/errors/index.ts"),
      edge("deployment/preflight/a.ts", "../../shared/host-pin/walk.ts"),
      edge("deployment/preflight/a.ts", "../../shared/host-pin/index.ts.bak.ts"),
      edge("deployment/preflight/a.ts", "../../shared/host-pin/lib/index.ts"),
      // P1.33o: the allow path is anchored at shared/, so the same suffix under deployment/images is refused.
      edge("deployment/preflight/a.ts", "../images/shared/host-pin/index.ts"),
      // P1.33o: the dot in index.ts is escaped, so a file named index-ts is not that file.
      edge("deployment/preflight/a.ts", "../../shared/host-pin/index-ts"),
      edge("deployment/preflight/a.ts", "../images/b.ts"),
      edge("deployment/preflight/a.ts", "pg"),
      edge("deployment/images/a.ts", "../preflight/b.ts"),
      edge("interfaces/http/a.ts", "../../deployment/preflight/b.ts"),
    );
    // The row is one way: the edge still never imports the preflight (P1.30r).
    await expectFail("edge-not-preflight", edge("deployment/edge/caddyfile.ts", "../preflight/checks/edge.ts"));
  });

  test("lexicon_scripts_row_is_narrow", async () => {
    // P1.31d (architecture record 2026-10-12-p131-depcruise-and-lexicon-choices item 2): the scripts reach their own
    // package, npm and exactly five Node built-ins, never all of CORE, and nothing outside them imports one.
    expect(config.LEXICON_SCRIPT_BUILTINS).toEqual(["fs", "path", "os", "url", "child_process"]);
    const script = "shared/lexicons/scripts/build.ts";
    await expectFail(
      "not-in-allowed",
      edge(script, "node:http"),
      edge(script, "node:net"),
      edge(script, "node:crypto"),
      edge(script, "node:worker_threads"),
      // Each built-in is named exactly; a subpath module such as fs/promises is another module.
      edge(script, "node:fs/promises"),
      edge(script, "../../config/index.ts"),
      // Only the scripts gain the built-ins: the package's own code stays on its pure row.
      edge("shared/lexicons/src/a.ts", "node:fs"),
      edge("shared/lexicons/a.ts", "node:child_process"),
      edge("shared/lexicons/scriptsx/a.ts", "node:fs"),
    );
    await expectFail("no-product-imports-tooling", edge(script, "../../../scripts/guards/files.ts"));
    await expectFail(
      "lexicon-scripts-not-imported",
      edge("shared/lexicons/src/a.ts", "../scripts/build.ts"),
      edge("shared/lexicons/index.ts", "./scripts/build.ts"),
      edge("interfaces/http/a.ts", "../../shared/lexicons/scripts/build.ts"),
      edge("domains/identity/a.ts", "../../shared/lexicons/scripts/build.ts"),
      // Tests included: a test of a script sits beside it, under scripts/.
      edge("shared/lexicons/src/a.test.ts", "../scripts/build.ts"),
      edge("tests/integration/a.test.ts", "../../shared/lexicons/scripts/build.ts"),
      // Every file under scripts/, not only build.ts.
      edge("shared/lexicons/src/b.ts", "../scripts/lib/hash.ts"),
    );
    await expectPass(
      edge("shared/lexicons/scripts/build.test.ts", "./build.ts"),
      edge("shared/lexicons/scripts/check/a.ts", "../build.ts"),
    );
  });

  test("exports_only_package_resolves", async () => {
    // P1.31d: a package that publishes only an `exports` map (no `main`), as @atproto/lex-schema does. Without
    // exportsFields its import never resolved, so no path rule saw it. The conditions are exactly architecture's four
    // ("types" was declined: it would cruise .d.ts files instead of runtime entries).
    expect((config.options as { enhancedResolveOptions?: unknown }).enhancedResolveOptions).toEqual({
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    });
    const from = "shared/http/a.ts";
    const result = await packageCruise(from, ["exp-only", "exp-only/public", "exp-only/conditional"]);
    const found = (path: string) => ({ resolved: `node_modules/exp-only/${path}`, couldNotResolve: false });
    expect(resolved(result, from, "exp-only")).toEqual(found("dist/index.js"));
    expect(resolved(result, from, "exp-only/public")).toEqual(found("public.js"));
    // The first condition in the package's own order that is in conditionNames wins (enhanced-resolve 5.26.0
    // lib/util/entrypoints.js), as in Node.
    expect(resolved(result, from, "exp-only/conditional")).toEqual(found("esm.js"));
    expect(outcome(result)).toEqual({ exitCode: 0, rules: [] });
  });

  test("exports_unexported_subpath_is_a_finding", async () => {
    // A file the package ships but does not export cannot be reached, so the import is unresolved and fails.
    const from = "shared/http/a.ts";
    const result = await packageCruise(from, ["exp-only/private.js"]);
    expect(resolved(result, from, "exp-only/private.js")?.couldNotResolve).toBe(true);
    expect(outcome(result).exitCode).not.toBe(0);
    expect(outcome(result).rules).toContain("not-in-allowed");
  });

  test("package_dist_entry_is_checked", async () => {
    // P1.31d: `exclude` drops our own dist/ but never a package's. Before, an entry under node_modules/*/dist/ (vitest,
    // vite, hono, most exports maps) was excluded with its edge, so a domain could import such a package unseen.
    const from = "domains/identity/a.ts";
    const result = await packageCruise(from, ["main-dist", "exp-only"]);
    expect(resolved(result, from, "main-dist")).toEqual({
      resolved: "node_modules/main-dist/dist/index.js",
      couldNotResolve: false,
    });
    expect(resolved(result, from, "exp-only")?.resolved).toBe("node_modules/exp-only/dist/index.js");
    expect(outcome(result).rules).toEqual(["not-in-allowed", "not-in-allowed"]);
    expect(result.modules.map((m) => m.source)).not.toContain("apps/web/dist/server.js");
  });

  test("render_build_import_is_exact", async () => {
    // P1.23w: the one unresolvable edge is this file's import of this specifier; nothing near it passes.
    const { from, module } = config.RENDER_BUILD_IMPORT;
    expect({ from, module }).toEqual({ from: "interfaces/http/web/render-entry.ts", module: "@unset/apps-web/server" });
    const unresolved = (file: string, spec: string): Edge => ({ from: file, spec, kind: "dynamic", unresolved: true });
    await expectPass(unresolved(from, module));
    await expectFail("not-in-allowed", unresolved("interfaces/http/web/page.ts", module));
    await expectFail("not-in-allowed", unresolved(from, "@unset/apps-web/other"), unresolved(from, `${module}x`));
    await expectFail("app-render-entry-only", edge(from, "../../../apps/web/src/document.tsx", "dynamic"));
  });

  test("shared_host_pin_is_a_leaf", async () => {
    // P1.33o: host-pin joins LEAF_SHARED. dependency-cruiser 18.5.0 allows a dependency that satisfies any
    // allowed rule (doc/rules-reference.md, `allowed`). This row is only its own files and Node built-ins.
    // A test file stays on the tooling row, so index.test.ts may import vitest even though the row refuses it.
    await expectPass(
      edge("shared/host-pin/a.ts", "node:fs"),
      edge("shared/host-pin/a.ts", "./walk.ts"),
      edge("shared/host-pin/index.test.ts", "vitest"),
    );
    const row = config.MATRIX.find((entry) => entry.name === "shared-host-pin");
    if (!row) throw new Error("shared-host-pin row is missing");
    const allowed = row.to.map((to) => ({ from: row.from, to }));
    const rowAlone = await cruiseFixture([edge("shared/host-pin/index.test.ts", "vitest")], {
      allowed,
      allowedSeverity: "error",
      forbidden: [],
    });
    expect(rowAlone.exitCode, "the host-pin row itself does not allow vitest").not.toBe(0);
    await expectFail(
      "not-in-allowed",
      edge("shared/host-pin/a.ts", "../config/index.ts"),
      edge("shared/host-pin/a.ts", "../errors/index.ts"),
      edge("shared/host-pin/a.ts", "fast-check"),
    );
  });

  test("depcruise_exclude_anchors_to_our_outputs", async () => {
    // P1.33f: `(^|/)dist/` also matched node_modules/yaml/dist, so that edge never reached a row. yaml 2.9.1's
    // package.json main is ./dist/index.js. host-pin's row does not allow it, so the cruise must refuse it.
    const yaml: Edge = { from: "shared/host-pin/a.ts", spec: "yaml", packageEntry: "dist/index.js" };
    const seen = await cruiseResult([yaml], RULES);
    const resolved = seen.modules
      .find((mod) => mod.source === yaml.from)
      ?.dependencies.find((dep) => dep.module === "yaml");
    expect(resolved?.resolved).toBe("node_modules/yaml/dist/index.js");
    expect(outcome(seen).rules).toContain("not-in-allowed");
    // A workspace build output stays out of the graph, so a forbidden import there is not a violation.
    const dist = await cruiseResult(
      [edge("apps/web/src/a.ts", "./b.ts"), edge("apps/web/dist/a.ts", "../../admin/b.ts")],
      RULES,
    );
    expect(dist.modules.map((mod) => mod.source)).not.toContain("apps/web/dist/a.ts");
    expect(dist.summary.error).toBe(0);
    // tsc emits deployment/dist directly, and scripts/dist and tests/dist; none of those is a node_modules path.
    const excludePath = (config.options as { exclude?: { path?: string | string[] } }).exclude?.path;
    const patterns = typeof excludePath === "string" ? [excludePath] : (excludePath ?? []);
    const excluded = (file: string) => patterns.some((pattern) => new RegExp(pattern).test(file));
    expect(excluded("node_modules/yaml/dist/index.js")).toBe(false);
    expect(excluded("deployment/dist/preflight/checks/index.d.ts")).toBe(true);
    expect(excluded("apps/web/dist/a.ts")).toBe(true);
    expect(excluded("scripts/dist/a.js")).toBe(true);
    expect(excluded("tests/dist/a.js")).toBe(true);
    expect(excluded("scripts/guards/fixtures/a.ts")).toBe(true);
  });

  test("depcruise_matrix_rows_have_fixtures", async () => {
    expect(Object.keys(ROW_FIXTURES).sort()).toEqual(config.MATRIX.map((row) => row.name).sort());
    for (const row of config.MATRIX) {
      // The row alone must allow its fixtures, so each fixture proves its own row, not a neighbour.
      const allowed = row.to.map((to) => ({ from: row.from, to }));
      for (const e of ROW_FIXTURES[row.name] ?? []) {
        const outcome = await cruiseFixture([e], { allowed, allowedSeverity: "error", forbidden: [] });
        expect(outcome, `${row.name}: ${e.from} → ${e.spec}`).toEqual({ exitCode: 0, rules: [] });
      }
    }
  });
});
