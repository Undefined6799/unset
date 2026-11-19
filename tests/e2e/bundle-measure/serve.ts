// The web server for the bundle experiment (P1.20u): the built interfaces/web as the e2e `test` process starts it (a
// stand-in PDS, one finished member), but with TRUSTED_PROXY_MODE socket as staging runs it behind its edge
// (deployment/compose.dev.yaml), on a plain loopback port that only the local edge (run.ts, edge.caddy) reaches. It writes the
// member's cookie to the file named by its first argument, then serves until SIGTERM.
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Did } from "@unset/domains-identity";
import type { SavedSession } from "@unset/infrastructure-pds";
import { createOAuthSessionStore, createPool, migrate, withTransaction } from "@unset/infrastructure-postgres";
import { createSealer, parseKeyring } from "@unset/infrastructure-seal";
import { createSessionStore } from "@unset/infrastructure-session";
import { createLogger } from "@unset/shared-log";
import { PDS_HOST, type Postgres, startWeb } from "../../integration/web/built-server.ts";
import { readyMember } from "../../integration/web/members.ts";
import { randomPassword, startPostgres, stopAllPostgres } from "../../support/postgres.ts";
import { ACCOUNT, HOST } from "../pages.ts";

const INNER_PORT = 8091;
const EDGE_PORT = 9444;
const EDGE_ORIGIN = `https://${HOST}:${EDGE_PORT}`;

const ROOT = join(import.meta.dirname, "../../..");
const quiet = createLogger({ service: "bundle", commit: "c".repeat(40), env: "test", write: () => undefined });

async function database(): Promise<Postgres> {
  process.on("exit", () => stopAllPostgres());
  const migratorPassword = randomPassword();
  const postgres = await startPostgres({
    initDir: join(ROOT, "deployment/postgres/init"),
    secrets: { pg_migrator_password: migratorPassword, pg_tap_password: randomPassword() },
  });
  const result = await migrate({
    connection: {
      host: "127.0.0.1",
      port: postgres.port,
      user: "migrator",
      password: migratorPassword,
      database: "unset",
      ssl: false,
    },
    dir: join(ROOT, "infrastructure/postgres/migrations"),
    root: ROOT,
    checkQueryFiles: true,
    log: quiet,
    retryDelaysMs: [],
  });
  if (!result.ok) throw new Error(`migration failed: ${result.reason}`);
  const password = randomPassword();
  postgres.sql("unset", `ALTER ROLE web PASSWORD '${password}'`);
  return { host: "127.0.0.1", port: postgres.port, database: "unset", user: "web", password };
}

/** The finished member's grant and session, as tests/e2e/fixtures/servers.ts seeds its `account` member. */
async function seedMember(pg: Postgres, keyring: string): Promise<string> {
  const pool = createPool({
    connection: { ...pg, ssl: false },
    service: "bundle-seed",
    max: 2,
    connectTimeoutMs: 5000,
  });
  const parsed = parseKeyring(keyring);
  if (parsed === undefined) throw new Error("keyring did not parse");
  const tokenSets = createOAuthSessionStore<SavedSession>({ pool, sealer: createSealer(parsed), log: quiet });
  const sessions = createSessionStore({
    withDb: async () => {
      throw new Error("the seed only writes through its own transactions");
    },
    limits: { idleS: 604_800, absoluteS: 2_592_000, touchIntervalS: 300 },
    log: quiet,
  });
  const did = ACCOUNT.did as Did;
  const issuer = `https://${PDS_HOST}`;
  const dpopJwk = { ...generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "jwk" }) };
  await tokenSets.set(did, {
    dpopJwk: { ...dpopJwk, kid: "dpop", alg: "ES256" } as SavedSession["dpopJwk"],
    authMethod: { method: "private_key_jwt", kid: "A" },
    tokenSet: {
      iss: issuer,
      sub: did as SavedSession["tokenSet"]["sub"],
      aud: issuer,
      scope: "atproto",
      access_token: "a",
      token_type: "DPoP",
    },
  });
  const created = await withTransaction(pool, null, (tx) => sessions.create(tx, did, { issuerOrigin: issuer }));
  await readyMember(pool, did, true);
  await pool.end();
  return created.cookieValue;
}

const cookieFile = process.argv[2];
if (cookieFile === undefined) throw new Error("usage: serve.ts <cookie-file>");
const pg = await database();
const dir = mkdtempSync(join(tmpdir(), "unset-bundle-"));
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
const keyring = JSON.stringify({ active: "k1", keys: { k1: randomBytes(32).toString("base64") } });
const keyringFile = join(dir, "seal_keyring");
writeFileSync(keyringFile, keyring);
const writesFile = join(dir, "pds-writes.jsonl");
writeFileSync(writesFile, "");
const web = await startWeb(
  pg,
  {
    SEAL_KEYRING_FILE: keyringFile,
    LISTEN_PORT: String(INNER_PORT),
    PUBLIC_ORIGIN: EDGE_ORIGIN,
    HTTP_ALLOWED_HOSTS: HOST,
    TRUSTED_PROXY_MODE: "socket",
  },
  {
    pds: {
      origin: `https://${PDS_HOST}`,
      did: ACCOUNT.did,
      records: {
        "sh.unset.profile": {
          self: { $type: "sh.unset.profile", displayName: "Member One", createdAt: "2026-11-01T00:00:00.000Z" },
        },
      },
      writesFile,
      session: { emailConfirmed: true },
    },
  },
);
writeFileSync(cookieFile, await seedMember(pg, keyring));
process.stderr.write(`bundle web listening on 127.0.0.1:${INNER_PORT}\n`);
let written = 0;
const flush = setInterval(() => {
  const lines = web.logs();
  for (const line of lines.slice(written)) process.stderr.write(`${JSON.stringify(line)}\n`);
  written = lines.length;
}, 1000);
process.on("SIGTERM", () => {
  clearInterval(flush);
  void web.stop().then(() => process.exit(0));
});
