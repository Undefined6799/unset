// P1.11t: query_budget_per_route (README invariant 14; plan §6.1 Data access). Every route in every
// interfaces/*/routes.manifest.json has a request fixture in query-budget/fixtures/<interface>.json, and serving it runs
// at most BUDGET statements, counted by a pool's onStatement hook. Every statement a checked-out client sends counts,
// inside withTransaction too, except transaction control (BEGIN, COMMIT, ROLLBACK, SAVEPOINT, RELEASE): the budget is
// about data round trips, and tx.ts adds those on its own (architecture ruling 2026-10-06 (c)). Requests run one at a time, so the count between two
// requests is that request's. No composition root takes a pool yet: the step that first wires one passes this test's
// counting pool into compose().
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { loadConfig } from "@unset/shared-config";
import { createServer, defineRoute } from "@unset/shared-http";
import { createLogger } from "@unset/shared-log";
import { afterAll, describe, expect, inject, test } from "vitest";
import { createPool, type Pool, withClient, withTransaction } from "../../infrastructure/postgres/index.ts";

const BUDGET = 5;
/** The allowed host and a client behind the trusted proxy, for interfaces in header mode; socket-mode ones ignore it. */
const CLIENT = { host: "unset.test", "x-forwarded-for": "203.0.113.9" };
const REPOSITORY = join(import.meta.dirname, "..", "..");
const INTERFACES = join(REPOSITORY, "interfaces");
const FIXTURES = join(import.meta.dirname, "query-budget", "fixtures");

type Route = { readonly method: string; readonly path: string };
type Fixture = {
  readonly env: Record<string, string>;
  readonly requests: readonly (Route & { readonly status: number })[];
};
type Server = { request(request: Request, peer?: string): Promise<Response> };

const provided = inject("postgres");
const database = provided.databases[relative(REPOSITORY, import.meta.filename)] ?? "";
let statements = 0;
const pools: Pool[] = [];
afterAll(() => Promise.all(pools.map((pool) => pool.close())));

function countingPool(): Pool {
  const pool = createPool({
    connection: { host: provided.host, port: provided.port, ...provided.roles.web, database, ssl: false },
    service: "query-budget",
    max: 1,
    connectTimeoutMs: 2000,
    statementTimeoutMs: 2000,
    idleInTransactionTimeoutMs: 5000,
    onStatement: () => {
      statements += 1;
    },
  });
  pools.push(pool);
  return pool;
}

/** The statements one request runs, and its status. */
async function measure(server: Server, route: Route): Promise<{ status: number; statements: number }> {
  statements = 0;
  const response = await server.request(
    new Request(`https://unset.test${route.path}`, { method: route.method, headers: CLIENT }),
    "10.0.0.1",
  );
  await response.arrayBuffer();
  return { status: response.status, statements };
}

const interfacesWithManifest = (): string[] =>
  existsSync(INTERFACES)
    ? readdirSync(INTERFACES).filter((name) => existsSync(join(INTERFACES, name, "routes.manifest.json")))
    : [];
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

describe("query budget", () => {
  test("query_budget_per_route", async () => {
    const names = interfacesWithManifest();
    if (existsSync(join(INTERFACES, "http"))) expect(names).toContain("http");
    for (const name of names) {
      const manifest = readJson<Route[]>(join(INTERFACES, name, "routes.manifest.json"));
      const fixturePath = join(FIXTURES, `${name}.json`);
      expect(existsSync(fixturePath), `no query budget fixture for interfaces/${name}`).toBe(true);
      const fixture = readJson<Fixture>(fixturePath);
      const covered = new Set(fixture.requests.map((r) => `${r.method} ${r.path}`));
      expect(manifest.map((r) => `${r.method} ${r.path}`).filter((key) => !covered.has(key))).toEqual([]);

      const { compose } = (await import(join(INTERFACES, name, "compose.ts"))) as {
        compose: (cfg: unknown, ...wiring: unknown[]) => Promise<{ server: Server }>;
      };
      const { config } = (await import(join(INTERFACES, name, "config.ts"))) as {
        config: Parameters<typeof loadConfig>[0];
      };
      // The web server's composition takes apps/web's render; tests pass the source (P1.23c), never the build.
      const wiring = name === "http" ? [await import(join(REPOSITORY, "apps", "web", "render.tsx"))] : [];
      const { server } = await compose(loadConfig(config, fixture.env), ...wiring);
      for (const request of fixture.requests) {
        const route = `${name} ${request.method} ${request.path}`;
        const result = await measure(server, request);
        expect(result.status, route).toBe(request.status);
        expect(result.statements, route).toBeLessThanOrEqual(BUDGET);
      }
    }
  });

  test("query_budget_counts_statements", async () => {
    const pool = countingPool();
    const route = (path: string, count: number) =>
      defineRoute({
        method: "GET",
        path,
        group: "static",
        rateLimit: "exempt",
        session: "none",
        handler: async () => {
          await withClient(pool, null, async (client) => {
            for (let i = 0; i < count; i += 1) await client.query("SELECT 1");
          });
          return new Response("ok");
        },
      });
    const fixture = readJson<Fixture>(join(FIXTURES, "http.json"));
    const { config } = (await import(join(INTERFACES, "http", "config.ts"))) as {
      config: Parameters<typeof loadConfig>[0];
    };
    const log = createLogger({ service: "http", commit: "c".repeat(40), env: "test", write: () => undefined });
    const server = createServer({
      config: loadConfig(config, fixture.env) as never,
      routes: [route("/five", BUDGET), route("/six", BUDGET + 1)],
      policies: {},
      log,
    });
    expect(await measure(server, { method: "GET", path: "/five" })).toEqual({ status: 200, statements: BUDGET });
    expect((await measure(server, { method: "GET", path: "/six" })).statements).toBeGreaterThan(BUDGET);
  });

  test("query_budget_counts_tx_statements", async () => {
    const pool = countingPool();
    statements = 0;
    await withTransaction(pool, null, async (client) => {
      await client.query("SELECT 1");
      await client.query("SAVEPOINT s");
      await client.query({ text: "SELECT $1::int", values: [2] });
      await client.query("RELEASE SAVEPOINT s");
    });
    await withClient(pool, null, (client) => client.query("SELECT 3"));
    expect(statements).toBe(3);
  });
});
