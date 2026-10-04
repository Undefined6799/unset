// The boundary rules in .dependency-cruiser.cjs, checked edge by edge on throwaway fixture trees (P0.05).
import { spawnSync } from "node:child_process";
import type { ICruiseResult } from "dependency-cruiser";
import { afterAll, describe, expect, test } from "vitest";
import { sourceFiles } from "../guards/files.ts";
import {
  CONFIG_PATH,
  check,
  config,
  cruiseFixture,
  DEPCRUISE,
  type Edge,
  edge,
  fixture,
  ROOT,
  removeFixtures,
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

const FAKE = "infrastructure/arachnid/fingerprint-check.fake.ts";

/** At least one passing edge per MATRIX row (AB-1: one fixture per matrix row). */
const ROW_FIXTURES: Record<string, Edge[]> = {
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
  "shared-admin-envelope": [
    edge("shared/admin-envelope/a.ts", "node:crypto"),
    edge("shared/admin-envelope/a.ts", "./b.ts"),
  ],
  tooling: [
    edge("tests/integration/a.test.ts", "../../scripts/guards/files.ts"),
    edge("infrastructure/arachnid/fingerprint-check.test.ts", "./fingerprint-check.fake.ts"),
    edge("tests/integration/a.test.ts", `../../${FAKE}`),
  ],
};

describe("dependency-cruiser runs", () => {
  test("depcruise_cruised_nonzero", () => {
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
    );
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

  test("depcruise_fake_tsx_and_render_prefix", async () => {
    await expectFail("fake-only-in-composition-root", edge("interfaces/http/routes/a.ts", "../x.fake.tsx"));
    await expectFail("app-render-entry-only", edge("interfaces/http/a.ts", "../../apps/web/render.tsx/x.ts"));
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
    await expectPass(...Object.values(ROW_FIXTURES).flat());
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
