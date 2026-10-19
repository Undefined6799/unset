// Production runs apps/web's server build, never its source (P1.23c; architecture Amendment 2026-10-06 21:05Z): the
// static import graph of the production entry reaches no file under apps/. Type-only imports are erased and the
// loader's import() of the built file is not a source edge, so both are left out of the walk.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cruise, type ICruiseResult } from "dependency-cruiser";
import { afterAll, expect, test } from "vitest";
import { webTestEnv } from "./test-env.ts";

const REPOSITORY = fileURLToPath(new URL("../../", import.meta.url));
const { options } = createRequire(import.meta.url)("../../scripts/lint/.dependency-cruiser.cjs");
const ENTRY = "interfaces/http/main.ts";
const ERASED = new Set(["type-only", "dynamic-import"]);

/** Every module the entry reaches through imports that run, as repository-relative paths. */
async function staticGraph(entry: string): Promise<Set<string>> {
  const { output } = await cruise([entry], { ...options, baseDir: REPOSITORY, outputType: "json" });
  const { modules }: ICruiseResult = JSON.parse(String(output));
  const edges = new Map(modules.map((m) => [m.source, m.dependencies]));
  const seen = new Set([entry]);
  for (const source of seen) {
    for (const d of edges.get(source) ?? []) {
      if (d.dependencyTypes.some((type) => ERASED.has(type)) || d.coreModule) continue;
      seen.add(d.resolved);
    }
  }
  return seen;
}

test("prod_entry_imports_no_app_source", async () => {
  const graph = await staticGraph(ENTRY);
  expect(graph).toContain("interfaces/http/web/render-entry.ts");
  expect([...graph].filter((path) => path.startsWith("apps/"))).toEqual([]);
}, 30_000);

test("prod_entry_reaches_no_tsx", async () => {
  // Node 26 strips types from .ts but refuses .tsx (ERR_UNKNOWN_FILE_EXTENSION), and Vitest compiles .tsx itself, so
  // only this walk, before the image's health check, sees a value import that reaches the kit's components (P2.05).
  // UI code reaches the server through the render build alone (render-entry.ts).
  const graph = await staticGraph(ENTRY);
  expect([...graph].filter((path) => path.endsWith(".tsx"))).toEqual([]);
}, 30_000);

test("prod_entry_loads_no_test_routes", async () => {
  // The test-only pages (P1.25c) are imported only behind TEST_ROUTES, which the config refuses outside test, so a
  // deployed process never loads the module (departure 3 of the P1.25c record).
  const graph = await staticGraph(ENTRY);
  expect(graph).toContain("interfaces/http/compose.ts");
  expect(graph).not.toContain("interfaces/http/routes/test-routes.ts");
}, 30_000);

// A load hook in the real entry's process that fails on the test-only pages, so a run that loads them cannot exit 78.
// No module mock (TE-1): the entry runs unchanged under Node, and only the loader is watched. The test profile is the
// control that shows the hook fires.
const TEST_ROUTES_HOOK = `import { registerHooks } from "node:module";
registerHooks({ load(url, context, next) {
  if (url.endsWith("/interfaces/http/routes/test-routes.ts")) throw new Error("test-routes loaded");
  return next(url, context);
} });`;
const SECRETS = mkdtempSync(join(tmpdir(), "web-secrets-"));
afterAll(() => rmSync(SECRETS, { recursive: true, force: true }));

/** Starts the production entry under `unsetEnv` with `extra` keys; returns its exit status and stderr. */
function startWithTestRoutes(unsetEnv: string, extra: Record<string, string> = { TEST_ROUTES: "true" }) {
  const env = webTestEnv(SECRETS, {
    PUBLIC_ORIGIN: "https://unset.test",
    WEB_BUILD_DIR: join(REPOSITORY, "interfaces/http/web/testdata/"),
    // Nothing listens here, so a start that gets past compose stops at the database at once.
    PG_HOST: "127.0.0.1",
    PG_PORT: "1",
    ...(unsetEnv === "prod" ? { NETGUARD_INTERNAL_HOSTS: "postgres" } : {}),
  });
  const run = spawnSync(
    process.execPath,
    [`--import=data:text/javascript,${encodeURIComponent(TEST_ROUTES_HOOK)}`, join(REPOSITORY, ENTRY)],
    { env: { ...env, UNSET_ENV: unsetEnv, ...extra }, encoding: "utf8", timeout: 20_000 },
  );
  return { status: run.status, stderr: run.stderr };
}

test("startup_outside_test_never_loads_test_routes", () => {
  for (const unsetEnv of ["prod", "dev"]) {
    const { status, stderr } = startWithTestRoutes(unsetEnv);
    expect(stderr, unsetEnv).toContain('{"event":"config.invalid","key":"TEST_ROUTES","reason":"invalid"}');
    expect(stderr, unsetEnv).not.toContain("test-routes loaded");
    expect(status, unsetEnv).toBe(78);
    // With the key off the start gets past the config, and so past compose's import point, still without the module.
    const off = startWithTestRoutes(unsetEnv, {});
    expect(off.stderr, unsetEnv).not.toContain("config.invalid");
    expect(off.stderr, unsetEnv).not.toContain("test-routes loaded");
  }
  const control = startWithTestRoutes("test");
  expect(control.stderr).toContain("test-routes loaded");
  expect(control.status).not.toBe(78);
}, 60_000);
