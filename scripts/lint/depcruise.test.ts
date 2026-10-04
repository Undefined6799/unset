// The boundary rules in .dependency-cruiser.cjs, checked edge by edge on throwaway fixture trees (P0.05).
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { cruise, type ICruiseResult } from "dependency-cruiser";
import { afterAll, describe, expect, test } from "vitest";
import { sourceFiles } from "../guards/files.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONFIG_PATH = join(ROOT, ".dependency-cruiser.cjs");
const DEPCRUISE = join(ROOT, "node_modules", ".bin", "depcruise");

type Row = { name: string; from: object; to: object[] };
type Config = {
  allowed: object[];
  allowedSeverity: string;
  forbidden: object[];
  options: object;
  MATRIX: Row[];
  ZERO_DEP_ALLOWLIST: string[];
  RENDER_ENTRIES: { http: string; admin: string };
};
const config: Config = createRequire(import.meta.url)(CONFIG_PATH);

/** One import in a fixture: `from` (repo-relative) imports `spec`, statically unless `kind` says otherwise. */
type Edge = { from: string; spec: string; kind?: "type" | "dynamic" };
type Outcome = { exitCode: number; rules: string[] };

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "depcruise-"));
  temps.push(dir);
  return dir;
}

function write(root: string, file: string, text: string): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text, { flag: "a" });
}

function importLine({ spec, kind }: Edge, n: number): string {
  if (kind === "type") return `import type { T${n} } from "${spec}";\n`;
  if (kind === "dynamic") return `export const d${n} = await import("${spec}");\n`;
  return `import * as m${n} from "${spec}";\nexport { m${n} };\n`;
}

/** Writes the importing files, every relative target, and a stub package for every bare specifier. */
function fixture(edges: Edge[]): string {
  const root = tempDir();
  const packages = new Set<string>();
  edges.forEach((edge, n) => {
    write(root, edge.from, importLine(edge, n));
    if (edge.spec.startsWith(".")) {
      write(root, posix.join(posix.dirname(edge.from), edge.spec), "export const x = 1;\n");
    } else if (!edge.spec.startsWith("node:")) {
      packages.add(edge.spec);
    }
  });
  for (const name of packages) {
    write(root, `node_modules/${name}/package.json`, JSON.stringify({ name, main: "index.js" }));
    write(root, `node_modules/${name}/index.js`, "module.exports = {};\n");
  }
  const dependencies = Object.fromEntries([...packages].map((name) => [name, "1.0.0"]));
  write(root, "package.json", JSON.stringify({ name: "fixture", private: true, dependencies }));
  return root;
}

async function cruiseFixture(edges: Edge[], ruleSet: object): Promise<Outcome> {
  const root = fixture(edges);
  const { output } = await cruise(["."], {
    ...config.options,
    baseDir: root,
    validate: true,
    ruleSet,
    outputType: "json",
  });
  const result: ICruiseResult = JSON.parse(String(output));
  const rules = result.summary.violations.filter((v) => v.rule.severity === "error").map((v) => v.rule.name);
  // The API reports exit 0 for the json reporter; the CLI's err reporter exits with the error count.
  return { exitCode: result.summary.error > 0 ? 1 : 0, rules };
}

const RULES = { allowed: config.allowed, allowedSeverity: config.allowedSeverity, forbidden: config.forbidden };
const check = (edges: Edge[]): Promise<Outcome> => cruiseFixture(edges, RULES);
const edge = (from: string, spec: string, kind?: Edge["kind"]): Edge => (kind ? { from, spec, kind } : { from, spec });

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

const FAKE = "infrastructure/arachnid/fingerprint-check.fake.ts";

/** At least one passing edge per MATRIX row (AB-1: one fixture per matrix row). */
const ROW_FIXTURES: Record<string, Edge[]> = {
  app: [edge("apps/web/a.ts", "../../shared/ui/b.ts"), edge("apps/chat/matrix/a.ts", "matrix-js-sdk")],
  interface: [
    edge("interfaces/http/a.ts", "../../domains/identity/b.ts"),
    edge("interfaces/admin/a.ts", "../../shared/http/b.ts"),
    edge("interfaces/http/compose.ts", `../../${FAKE}`, "dynamic"),
  ],
  "interface-http-render": [edge("interfaces/http/a.ts", `../../${config.RENDER_ENTRIES.http}`)],
  "interface-admin-render": [edge("interfaces/admin/a.ts", `../../${config.RENDER_ENTRIES.admin}`)],
  "admin-service": [
    edge("interfaces/pds-admin/a.ts", "../../shared/admin-envelope/jcs.ts"),
    edge("interfaces/chat-admin/a.ts", "../../shared/admin-envelope/jcs.ts"),
    edge("interfaces/pds-admin/a.ts", "node:crypto"),
  ],
  domain: [
    edge("domains/identity/a.ts", "../../shared/errors/b.ts"),
    edge("domains/identity/a.ts", "../../shared/lexicons/b.ts"),
    edge("domains/identity/a.ts", "../content/index.ts"),
    edge("domains/identity/a.ts", "node:crypto"),
    edge("domains/identity/a.ts", "../../shared/config/b.ts", "type"),
    edge("domains/content/a.ts", "../identity/index.ts"),
  ],
  infrastructure: [
    edge("infrastructure/pds/a.ts", "../../domains/identity/contract.ts"),
    edge("infrastructure/postgres/a.ts", "pg"),
  ],
  "net-guard": [edge("infrastructure/net-guard/a.ts", "undici")],
  shared: [edge("shared/config/a.ts", "../errors/b.ts")],
  "shared-ui-lexicons": [edge("shared/lexicons/a.ts", "@atproto/lex")],
  "shared-admin-envelope": [edge("shared/admin-envelope/a.ts", "node:crypto")],
  tooling: [
    edge("tests/integration/a.test.ts", "../../scripts/guards/files.ts"),
    edge("infrastructure/arachnid/fingerprint-check.test.ts", "./fingerprint-check.fake.ts"),
    edge("tests/integration/a.test.ts", `../../${FAKE}`),
  ],
};

describe("dependency-cruiser runs", () => {
  test("depcruise_cruised_nonzero", () => {
    const root = fixture([edge("a.ts", "./b.ts")]);
    const small = spawnSync(DEPCRUISE, ["--config", CONFIG_PATH, "--output-type", "json", "."], {
      cwd: root,
      encoding: "utf8",
    });
    expect(small.status, small.stderr).toBe(0);
    const json: ICruiseResult = JSON.parse(small.stdout);
    expect(json.summary.totalCruised).toBe(2);
    expect(json.modules.find((m) => m.source === "a.ts")?.dependencies.map((d) => d.resolved)).toEqual(["b.ts"]);

    const real = spawnSync(DEPCRUISE, ["--config", CONFIG_PATH, "--output-type", "json", "."], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(real.status, real.stderr).toBe(0);
    expect((JSON.parse(real.stdout) as ICruiseResult).summary.totalCruised).toBeGreaterThanOrEqual(1);
  });

  test("lint_clean_repo", () => {
    const lint = spawnSync("npm", ["run", "lint"], { cwd: ROOT, encoding: "utf8" });
    expect(lint.status, lint.stdout + lint.stderr).toBe(0);
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
      await expectFail("admin-services-zero-deps", edge(from, "undici"), edge(from, "../../shared/config/x.ts"));
      await expectPass(edge(from, "../../shared/admin-envelope/jcs.ts"));
    }
  });

  test("depcruise_allowlist_zero_deps", async () => {
    await expectFail(
      "allowlist-zero-deps",
      edge("shared/admin-envelope/a.ts", "../config/x.ts"),
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
      edge("apps/web/a.ts", "../../infrastructure/postgres/b.ts"),
      edge("apps/web/a.ts", "../../domains/identity/b.ts"),
    );
    await expectFail(
      "domain-pure",
      edge("domains/identity/a.ts", "../../infrastructure/pds/b.ts"),
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

  test("depcruise_domain_imports", async () => {
    await expectPass(...(ROW_FIXTURES.domain ?? []));
    const from = "domains/identity/a.ts";
    await expectFail(
      "not-in-allowed",
      edge(from, "../../shared/config/b.ts"),
      edge(from, "../../shared/log/b.ts"),
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
    await expectPass(...Object.values(ROW_FIXTURES).flat());
  });

  test("depcruise_unlisted_edge_fails", async () => {
    expect(config.allowedSeverity).toBe("error");
    expect(Array.isArray(config.allowed) && config.allowed.length > 0).toBe(true);
    await expectFail(
      "not-in-allowed",
      edge("domains/identity/a.ts", "../../shared/http/b.ts"),
      edge("infrastructure/storage/a.ts", "../audit/b.ts"),
      edge("shared/ui/a.ts", "../config/b.ts"),
    );
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
