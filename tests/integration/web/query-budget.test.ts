// P1.20k, ported from tests/integration/query-budget.test.ts query_budget_per_route (P1.11t; README invariant 14;
// plan §6.1 Data access) for the SvelteKit server. Every page and handler under interfaces/web/src/routes, asked once
// as a signed-out browser asks it (a GET, and for a route that writes a POST with no Origin, as the old fixture sent
// one), runs at most BUDGET statements against Postgres. The built server runs in its own process, so the count is
// taken on the wire: the server reaches Postgres through a loopback relay here that reads the frontend protocol
// (https://www.postgresql.org/docs/18/protocol-message-formats.html) and counts each simple Query ('Q') and each
// extended-protocol Execute ('E'), leaving out what the old count left out (NOT_COUNTED; architecture
// ruling 2026-10-06 (c)). Requests run one at a time, so the count between two requests is that request's. The test routes
// are left out: they exist only for other tests.
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { connect, createServer, type Server, type Socket } from "node:net"; // guard-allow: egress loopback relay to the test Postgres only
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { type Did, parseDid } from "@unset/domains-identity";
import type { SavedSession } from "@unset/infrastructure-pds";
import { createOAuthSessionStore, createPool, withTransaction } from "@unset/infrastructure-postgres";
import { createSealer, parseKeyring } from "@unset/infrastructure-seal";
import { createSessionStore } from "@unset/infrastructure-session";
import { createLogger } from "@unset/shared-log";
import { afterAll, beforeAll, describe, expect, inject, test } from "vitest";
import { buildOnce, clientAddress, PDS_HOST, type RunningWeb, type StandInFixture, startWeb } from "./built-server.ts";
import { readyMember } from "./members.ts";

const BUDGET = 5;
/**
 * The owner's page runs 7: the session, the account row, then the sealed grant read once to restore the OAuth session
 * and once more inside the restore lock for each of the page's PDS calls (measured 2026-11-18 on k2). It was 6 until
 * the main page became its own record (ADR 0091), a third PDS read after the profile and before the cards (CI run on
 * #1952, 2026-11-21).
 */
const KNOWN_OVERRUNS: Record<string, number> = { [`/did:plc:${"a".repeat(24)}`]: 7 };
const REPO = join(import.meta.dirname, "..", "..", "..");
const ROUTES = join(REPO, "interfaces", "web", "src", "routes");
const provided = inject("postgres");
const database = provided.databases[relative(REPO, import.meta.filename)] ?? "";

/**
 * What the old count left out. Transaction control, as infrastructure/postgres/pool.ts TRANSACTION_CONTROL leaves it
 * out. And the advisory lock's own statements (its SET LOCAL timeouts, the lock itself, the RESET): they run on the
 * lock pool, which the old count never saw (infrastructure/postgres/lock.ts createLockPool takes no onStatement).
 * The statements the work inside the lock runs still count.
 */
const NOT_COUNTED =
  /^\s*(?:BEGIN|START\s+TRANSACTION|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE|SET\s+LOCAL|RESET|SELECT\s+pg_advisory_xact_lock)\b/i;

/**
 * The next whole message at the head of `pending`, or none yet. Before startup a message has no type byte
 * (StartupMessage, or an SSLRequest, which this server refuses since the web server connects with sslmode disable);
 * every later one is a type byte and an Int32 length that counts itself.
 */
function nextMessage(pending: Buffer, started: boolean): { type: string; body: Buffer; size: number } | undefined {
  if (!started) {
    if (pending.length < 8) return undefined;
    const size = pending.readInt32BE(0);
    // 80877103 is SSLRequest: a startup message still follows it.
    return pending.length < size
      ? undefined
      : { type: pending.readInt32BE(4) === 80877103 ? "ssl" : "startup", body: pending.subarray(8, size), size };
  }
  if (pending.length < 5) return undefined;
  const size = pending.readInt32BE(1) + 1;
  if (pending.length < size) return undefined;
  return { type: String.fromCharCode(pending[0] ?? 0), body: pending.subarray(5, size), size };
}

/** Calls `count` with the text of each statement one connection's client sends to run. */
function frontendCounter(count: (sql: string) => void): (chunk: Buffer) => void {
  let pending = Buffer.alloc(0);
  let started = false;
  // An Execute names no text: it runs the statement the last Parse sent (node-postgres 8 parses unnamed statements).
  let parsed = "";
  return (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    for (let message = nextMessage(pending, started); message; message = nextMessage(pending, started)) {
      pending = pending.subarray(message.size);
      if (message.type === "startup") started = true;
      if (message.type === "Q") count(message.body.toString("utf8"));
      if (message.type === "E") count(parsed);
      if (message.type === "P") {
        const nameEnd = message.body.indexOf(0);
        parsed = message.body.subarray(nameEnd + 1, message.body.indexOf(0, nameEnd + 1)).toString("utf8");
      }
    }
  };
}

/** A loopback relay to the test Postgres that adds every data statement sent through it to `statements`. */
let statements = 0;
function countingRelay(): Promise<{ port: number; close: () => Promise<void> }> {
  const sockets = new Set<Socket>();
  const relay: Server = createServer((client) => {
    const upstream = connect(provided.port, provided.host);
    sockets.add(client).add(upstream);
    const read = frontendCounter((sql) => {
      if (!NOT_COUNTED.test(sql)) statements += 1;
    });
    client.on("data", (chunk: Buffer) => {
      read(chunk);
      upstream.write(chunk);
    });
    upstream.pipe(client);
    for (const socket of [client, upstream]) {
      socket.on("error", () => undefined);
      socket.on("close", () => {
        client.destroy();
        upstream.destroy();
      });
    }
  });
  return new Promise((resolve) =>
    relay.listen(0, "127.0.0.1", () => {
      const address = relay.address();
      resolve({
        port: typeof address === "object" && address !== null ? address.port : 0,
        close: () =>
          new Promise((done) => {
            for (const socket of sockets) socket.destroy();
            relay.close(() => done());
          }),
      });
    }),
  );
}

/** A route folder as a request path: a parameter takes a value its matcher accepts, `[x+2e]` is a dot. */
function pathOf(folder: string): string {
  const path = folder
    .split("/")
    .filter((segment) => segment !== "" && !/^\(.*\)$/.test(segment))
    .map((segment) =>
      segment
        .replace("[did=did]", `did:plc:${"a".repeat(24)}`)
        .replace("[document=legal]", "terms")
        .replace("[x+2e]", "."),
    )
    .join("/");
  return `/${path}`;
}

type Probe = { method: "GET" | "POST"; path: string };
const files = readdirSync(ROUTES, { recursive: true, encoding: "utf8" }).filter(
  (file) => !file.startsWith("test-routes"),
);
const exports = (source: string, name: string) =>
  new RegExp(`export\\s+(?:const|async\\s+function|function)\\s+${name}\\b`).test(source);
const PROBES: Probe[] = files
  .filter((file) => /(^|\/)\+(page\.svelte|server\.ts)$/.test(file))
  .flatMap((file): Probe[] => {
    const folder = file.slice(0, file.lastIndexOf("/") + 1);
    const path = pathOf(folder);
    if (file.endsWith("+page.svelte")) {
      const server = files.includes(`${folder}+page.server.ts`)
        ? readFileSync(join(ROUTES, `${folder}+page.server.ts`), "utf8")
        : "";
      return exports(server, "actions")
        ? [
            { method: "GET", path },
            { method: "POST", path },
          ]
        : [{ method: "GET", path }];
    }
    const source = readFileSync(join(ROUTES, file), "utf8");
    return (["GET", "POST"] as const).filter((method) => exports(source, method)).map((method) => ({ method, path }));
  })
  .sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`));

// The signed-in browser, made as member-page.test.ts makes one, straight into the database (not through the relay):
// a grant the OAuth client restores against the stand-in PDS, then a session. The server unseals that grant, so both
// use one keyring, handed to the server by file.
const OWNER = parseDid(`did:plc:${"a".repeat(24)}`) as Did;
const PDS = `https://${PDS_HOST}`;
const NOW = "2026-11-18T00:00:00.000Z";
const pool = createPool({
  connection: { host: provided.host, port: provided.port, database, ...provided.roles.web, ssl: false },
  service: "web-query-budget-test",
  max: 2,
  connectTimeoutMs: 5000,
});
const quiet = createLogger({ service: "web", commit: "c".repeat(40), env: "test", write: () => undefined });
const sessions = createSessionStore({
  withDb: async () => {
    throw new Error("this file only creates sessions");
  },
  limits: { idleS: 604_800, absoluteS: 2_592_000, touchIntervalS: 300 },
  log: quiet,
});
const KEYRING = JSON.stringify({ active: "k1", keys: { k1: randomBytes(32).toString("base64") } });
const keyring = parseKeyring(KEYRING);
if (keyring === undefined) throw new Error("test keyring did not parse");
const tokenSets = createOAuthSessionStore<SavedSession>({ pool, sealer: createSealer(keyring), log: quiet });

async function signedIn(owner: Did): Promise<string> {
  const dpopJwk = {
    ...generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "jwk" }),
    kid: "dpop",
    alg: "ES256",
  };
  await tokenSets.set(owner, {
    dpopJwk: dpopJwk as SavedSession["dpopJwk"],
    authMethod: { method: "private_key_jwt", kid: "A" },
    tokenSet: {
      iss: PDS,
      sub: owner as SavedSession["tokenSet"]["sub"],
      aud: PDS,
      scope: "atproto",
      access_token: "a",
      token_type: "DPoP",
    },
  });
  const created = await withTransaction(pool, null, (tx) => sessions.create(tx, owner));
  await readyMember(pool, owner);
  return created.cookieValue;
}

/** The owner's DID document naming the stand-in PDS, which holds their profile and one README card. */
function fixture(writesFile: string): StandInFixture {
  return {
    http: {
      [`https://plc.directory/${OWNER}`]: {
        body: {
          "@context": ["https://www.w3.org/ns/did/v1"],
          id: OWNER,
          verificationMethod: [
            { id: `${OWNER}#atproto`, type: "Multikey", controller: OWNER, publicKeyMultibase: "zQ3sh" },
          ],
          service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: PDS }],
        },
      },
    },
    pds: {
      origin: PDS,
      did: OWNER,
      records: {
        "sh.unset.profile": { self: { $type: "sh.unset.profile", displayName: "Member One", createdAt: NOW } },
      },
      writesFile,
    },
  };
}

let web: RunningWeb;
let relay: { port: number; close: () => Promise<void> };
beforeAll(async () => {
  buildOnce(provided.port);
  relay = await countingRelay();
  const dir = mkdtempSync(join(tmpdir(), "web-query-budget-"));
  const keyringFile = join(dir, "seal_keyring");
  writeFileSync(keyringFile, KEYRING);
  writeFileSync(join(dir, "writes.jsonl"), "");
  web = await startWeb(
    { host: "127.0.0.1", port: relay.port, database, ...provided.roles.web },
    { SEAL_KEYRING_FILE: keyringFile },
    fixture(join(dir, "writes.jsonl")),
  );
}, 120_000);
afterAll(async () => {
  await web?.stop();
  await relay?.close();
  await pool.end();
});

/** The statements one request runs, and its status. */
async function measure(probe: Probe, cookie?: string): Promise<{ status: number; statements: number }> {
  statements = 0;
  const response = await web.fetch(probe.path, {
    method: probe.method,
    headers: {
      "x-forwarded-for": clientAddress(),
      ...(cookie === undefined ? {} : { cookie: `__Host-sid=${cookie}` }),
    },
  });
  await response.arrayBuffer();
  return { status: response.status, statements };
}

describe("query budget", () => {
  test("query_budget_per_route", async () => {
    expect(PROBES.length).toBeGreaterThan(25);
    for (const probe of PROBES) {
      const label = `${probe.method} ${probe.path}`;
      const result = await measure(probe);
      expect(result.status, label).toBeLessThan(500);
      expect(result.statements, label).toBeLessThanOrEqual(BUDGET);
    }
  });

  test("query_budget_per_route_signed_in", async () => {
    // The same GETs from a signed-in member whose own page is the [did] probe: the session read, the account row and
    // the page's own reads all count. The old Hono test sent no session, so this half is new. Known overruns are
    // pinned at what they run today, so they cannot grow; each is an open item for Alex, not an allowance.
    const cookie = await signedIn(OWNER);
    for (const probe of PROBES.filter((one) => one.method === "GET")) {
      const label = `signed in GET ${probe.path}`;
      const result = await measure(probe, cookie);
      expect(result.status, label).toBeLessThan(500);
      expect(result.statements, label).toBeLessThanOrEqual(KNOWN_OVERRUNS[probe.path] ?? BUDGET);
    }
  });

  test("the_relay_counts_what_a_route_runs", async () => {
    // /health asks Postgres before it answers 200 (P1.04w) once its 2 s cache has run out (shared/http/health.ts
    // CACHE_MS), so a relay that counted nothing would fail here.
    await new Promise((resolve) => setTimeout(resolve, 2100));
    const result = await measure({ method: "GET", path: "/health" });
    expect(result.status).toBe(200);
    expect(result.statements).toBeGreaterThanOrEqual(1);
  });
});
