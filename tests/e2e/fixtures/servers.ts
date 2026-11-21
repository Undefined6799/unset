// Two processes for the browser harness (P1.26; on the SvelteKit server since P1.20k). Each starts Postgres, runs the
// migrations, and starts the built interfaces/web server (tests/integration/web/built-server.ts startWeb) behind a
// TLS listener on 127.0.0.1, as the edge stands in front of it in production:
// - `prod`: the real routes and nothing else (no test-only route, no stand-in).
// - `test`: the test profile with TEST_ROUTES on, the stand-in network and PDS of tests/integration/web, and signed-in
//   members at each onboarding step and one finished member, whose cookies it writes to SESSIONS_FILE for the specs.
// Browsers reach both at https://unset.test (pages.ts): a name that is neither an IP nor loopback, as the OAuth
// client's metadata needs, that SvelteKit's Origin check compares a form post against (server.ts sets ORIGIN), and
// where every browser keeps a Secure __Host- cookie. Playwright gets there through the CONNECT proxy below. The
// certificate is made per run by openssl and trusted by no one: the harness ignores certificate errors.
// `wait` probes the plain listeners' /health (no host check there), so it needs no certificate.
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer, request as httpRequest, type IncomingMessage } from "node:http"; // guard-allow: egress forwards to the loopback test servers only
import { createServer as createTlsServer } from "node:https"; // guard-allow: egress inbound listener only
import { connect } from "node:net"; // guard-allow: egress the proxy's tunnels reach the loopback TLS listeners only
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import { type Did, PRIVACY_VERSION, parseDid, TERMS_VERSION } from "@unset/domains-identity";
import { toCardRecord } from "@unset/domains-profile";
import { createNetGuard, guardedFetch, internalPolicy } from "@unset/infrastructure-net-guard";
import type { SavedSession } from "@unset/infrastructure-pds";
import {
  createAccountRepository,
  createNotificationStore,
  createOAuthSessionStore,
  createPool,
  createSignInStore,
  migrate,
  withClient,
  withTransaction,
} from "@unset/infrastructure-postgres";
import { createSealer, parseKeyring } from "@unset/infrastructure-seal";
import { createSessionStore } from "@unset/infrastructure-session";
import { createLogger } from "@unset/shared-log";
import { buildOnce, PDS_HOST, type Postgres, type RunningWeb, startWeb } from "../../integration/web/built-server.ts";
import { readyMember } from "../../integration/web/members.ts";
import { randomPassword, startPostgres, stopAllPostgres } from "../../support/postgres.ts";
import {
  ACCOUNT,
  BELL_SIZE,
  HOST,
  INBOX_SIZE,
  INDEXED,
  INNER,
  LISTEN,
  type MemberName,
  PROD_ORIGIN,
  PROXY,
  SESSIONS_FILE,
  TEST_ORIGIN,
} from "../pages.ts";

const ROOT = join(import.meta.dirname, "../../..");
const LOGS = ["e2e-prod.log", "e2e-test.log"] as const;
const quiet = createLogger({ service: "e2e", commit: "c".repeat(40), env: "test", write: () => undefined });

// The wait process probes both plain listeners. scripts/guards/egress.ts scans tests/ and refuses a dynamic fetch, so
// the probe is guardedFetch, with an internal policy for these exact loopback origins.
const health = guardedFetch(
  createNetGuard({ internalHosts: [], allowLoopback: false, commit: "c".repeat(40) }),
  internalPolicy("e2e-health", [`http://127.0.0.1:${INNER.prod}`, `http://127.0.0.1:${INNER.test}`]),
  { timeoutMs: 2_000, maxBytes: 4_096 },
);

type Mode = "prod" | "test" | "wait";

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "unset-e2e-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Postgres with the migrations applied, then `seed` run as the superuser, connected to as `web` for this run. */
async function database(seed = ""): Promise<Postgres> {
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
  if (seed !== "") postgres.sql("unset", seed);
  const password = randomPassword();
  postgres.sql("unset", `ALTER ROLE web PASSWORD '${password}'`);
  return { host: "127.0.0.1", port: postgres.port, database: "unset", user: "web", password };
}

/** A self-signed certificate for HOST, made by openssl for this run only. */
function certificate(dir: string): { key: Buffer; cert: Buffer } {
  const key = join(dir, "tls.key");
  const cert = join(dir, "tls.crt");
  execFileSync(
    "openssl",
    ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-days", "1"].concat([
      "-subj",
      `/CN=${HOST}`,
      "-addext",
      `subjectAltName=DNS:${HOST}`,
      "-keyout",
      key,
      "-out",
      cert,
    ]),
    { stdio: "ignore" },
  );
  return { key: readFileSync(key), cert: readFileSync(cert) };
}

/**
 * Loopback reads as an unknown client (the resolver skips trusted-proxy entries, shared/http/trustedProxy.ts), so the
 * listener names a TEST-NET-3 address (RFC 5737), a new one per TLS connection: each test's own browser context reads
 * as its own visitor. One address for the whole run outran one bucket (limits.ts: 60, 5 a second) and got 429s; the
 * limit itself is tested in tests/integration/web/gate.test.ts.
 */
let connections = 0;
const nextBrowserAddress = (): string => `203.0.113.${(connections++ % 254) + 1}`;

/**
 * The TLS listener in front of the web server, as the edge is: it forwards each request unchanged with its connection's
 * address in X-Forwarded-For (the web server trusts that header from loopback only, TRUSTED_PROXY_MODE header).
 */
function tlsFront(dir: string, listen: number, inner: number): Promise<void> {
  const addresses = new WeakMap<object, string>();
  const server = createTlsServer(certificate(dir), (req, res) => {
    const forwarded = httpRequest(
      {
        host: "127.0.0.1",
        port: inner,
        method: req.method,
        path: req.url,
        headers: { ...req.headers, "x-forwarded-for": addresses.get(req.socket) ?? nextBrowserAddress() },
      },
      (answer) => {
        res.writeHead(answer.statusCode ?? 502, answer.rawHeaders);
        answer.pipe(res);
      },
    );
    forwarded.on("error", () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(forwarded);
  });
  server.on("secureConnection", (socket) => addresses.set(socket, nextBrowserAddress()));
  return new Promise((done) => server.listen(listen, "127.0.0.1", () => done()));
}

/** What both processes set: the browser origin is the TLS listener's, the server's own port is the plain one. */
function frontedEnv(mode: "prod" | "test"): Record<string, string> {
  return {
    LISTEN_PORT: String(INNER[mode]),
    PUBLIC_ORIGIN: mode === "prod" ? PROD_ORIGIN : TEST_ORIGIN,
    HTTP_ALLOWED_HOSTS: HOST,
    TRUSTED_PROXY_MODE: "header",
    TRUSTED_PROXY_HEADER: "x-forwarded-for",
    TRUSTED_PROXY_CIDRS: "127.0.0.0/8",
  };
}

function report(mode: "prod" | "test", web: RunningWeb): void {
  process.stderr.write(`e2e ${mode} listening ${mode === "prod" ? PROD_ORIGIN : TEST_ORIGIN}\n`);
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
}

/**
 * Playwright's proxy (playwright.config.ts): it answers CONNECT for HOST at the two TLS listeners only, by opening the
 * tunnel to 127.0.0.1, and refuses everything else, so a page that reached for any other host fails the run.
 */
function connectProxy(): Promise<void> {
  const allowed = new Set([`${HOST}:${LISTEN.prod}`, `${HOST}:${LISTEN.test}`]);
  const proxy = createHttpServer((_req, res) => {
    res.writeHead(405);
    res.end();
  });
  proxy.on("connect", (req: IncomingMessage, client: Duplex, head: Buffer) => {
    const target = req.url ?? "";
    if (!allowed.has(target)) {
      client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    const upstream = connect(Number(target.split(":")[1]), "127.0.0.1", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on("error", () => client.destroy());
    client.on("error", () => upstream.destroy());
  });
  return new Promise((done) => proxy.listen(Number(new URL(PROXY).port), "127.0.0.1", () => done()));
}

/**
 * INDEXED as the indexer leaves a member with a profile and one card (P3.12s), so the public profile page at /@did
 * is a page under test. Constants only; the records are dollar-quoted JSON.
 */
function indexedMember(): string {
  const at = "2026-11-19T00:00:00.000Z";
  const card = toCardRecord({ kind: "readme", text: "A card on a public page." }, "full", null, at);
  if (!card.ok) throw new Error(`e2e card did not build: ${card.code}`);
  const profile = {
    $type: "sh.unset.profile",
    displayName: "Public Member",
    headline: "On the open web",
    createdAt: at,
  };
  const did = INDEXED.did;
  return `
    INSERT INTO idx.account (did, handle_status, pds_active, track_requested_at, updated_at)
      VALUES ('${did}', 'unresolved', true, now(), now());
    INSERT INTO idx.profile (did, uri, cid, rev, record, display_name, discoverable, indexed_at)
      VALUES ('${did}', 'at://${did}/sh.unset.profile/self', 'cid-p', '3l', $j$${JSON.stringify(profile)}$j$,
        'Public Member', false, now());
    INSERT INTO idx.section (uri, did, rkey, cid, rev, record, position, indexed_at)
      VALUES ('at://${did}/sh.unset.card/3jzfcijpj2z2a', '${did}', '3jzfcijpj2z2a', 'cid-s', '3l',
        $j$${JSON.stringify(card.record)}$j$, 0, now());`;
}

async function serveProd(): Promise<void> {
  const pg = await database(indexedMember());
  const dir = scratch();
  const web = await startWeb(pg, { UNSET_ENV: "dev", TEST_ROUTES: "false", ...frontedEnv("prod") });
  await tlsFront(dir, LISTEN.prod, INNER.prod);
  await connectProxy();
  report("prod", web);
}

const didOf = (letter: string): Did => {
  const did = parseDid(`did:plc:${letter.repeat(24)}`);
  if (did === null) throw new Error("e2e DID did not parse");
  return did;
};

/**
 * Where each signed-in member stands: a step of onboarding, onboarded with an email not yet confirmed, or done with a
 * confirmed one (ACCOUNT, whose repo the stand-in PDS holds).
 */
const MEMBERS: Record<
  MemberName,
  { did: Did; step: "age" | "terms" | "chat" | "verify" | "done" | "notice" | "inbox" | "bell" }
> = {
  age: { did: didOf("b"), step: "age" },
  terms: { did: didOf("c"), step: "terms" },
  chat: { did: didOf("d"), step: "chat" },
  verify: { did: didOf("e"), step: "verify" },
  account: { did: ACCOUNT.did as Did, step: "done" },
  // Done, but accepted an older privacy notice, so the shell shows the changed-notice banner (P2.12b).
  notice: { did: didOf("f"), step: "notice" },
  // Done, with more notifications and sign-ins than the pages' lists show at once (P2.27b, P2.27c): the notifications
  // spec reads them and deletes none, so the lists scroll and a cut-off title can be lifted.
  inbox: { did: didOf("g"), step: "inbox" },
  // Done, with BELL_SIZE notifications this browser has not seen: only the bell spec's failed mark opens its bell, so
  // its count is still there (ADR 0085). Its own session, as a seen mark is the session's.
  bell: { did: didOf("h"), step: "bell" },
};

/** `size` notifications, oldest first, each a millisecond apart so their order is fixed. */
async function seedNotifications(pool: ReturnType<typeof createPool>, did: Did, size: number): Promise<void> {
  const inbox = createNotificationStore();
  for (let n = 0; n < size; n += 1) {
    const notification =
      n % 3 === 0 ? { reason: "privacy_notice" as const, topic: `e2e-${n}` } : { reason: "sign_in" as const };
    await withClient(pool, null, (db) => inbox.insert(db, did, notification));
    await new Promise((done) => setTimeout(done, 2));
  }
}

/** INBOX_SIZE notifications, and as many sign-ins. */
async function seedInbox(pool: ReturnType<typeof createPool>, did: Did): Promise<void> {
  await seedNotifications(pool, did, INBOX_SIZE);
  // As many sign-ins in the Sign-in history tab (P2.27c), so its list scrolls too.
  const history = createSignInStore();
  for (let n = 0; n < INBOX_SIZE; n += 1) {
    await withClient(pool, null, (db) => history.record(db, did));
    await new Promise((done) => setTimeout(done, 2));
  }
}

/** The notifications (and sign-ins) a member at `step` starts with: only "inbox" and "bell" have any. */
async function seedInboxOf(pool: ReturnType<typeof createPool>, did: Did, step: string): Promise<void> {
  if (step === "inbox") await seedInbox(pool, did);
  if (step === "bell") await seedNotifications(pool, did, BELL_SIZE);
}

/** Each member's grant (so the session's foreign key holds) and session, stepped to where MEMBERS puts them. */
async function seedMembers(pg: Postgres, keyring: string): Promise<Record<MemberName, string>> {
  const pool = createPool({ connection: { ...pg, ssl: false }, service: "e2e-seed", max: 2, connectTimeoutMs: 5000 });
  const parsed = parseKeyring(keyring);
  if (parsed === undefined) throw new Error("e2e keyring did not parse");
  const tokenSets = createOAuthSessionStore<SavedSession>({ pool, sealer: createSealer(parsed), log: quiet });
  const sessions = createSessionStore({
    withDb: async () => {
      throw new Error("the seed only writes through its own transactions");
    },
    limits: { idleS: 604_800, absoluteS: 2_592_000, touchIntervalS: 300 },
    log: quiet,
  });
  const accounts = createAccountRepository(pool, {
    recordUnderageBlock: async () => {
      throw new Error("the seed never blocks");
    },
  });
  const issuer = `https://${PDS_HOST}`;
  const cookies = {} as Record<MemberName, string>;
  for (const [name, { did, step }] of Object.entries(MEMBERS) as [MemberName, (typeof MEMBERS)[MemberName]][]) {
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
    const deadline = AbortSignal.timeout(5000);
    if (step === "terms" || step === "chat") await accounts.confirmAdult(did, deadline);
    if (step === "chat") await accounts.acceptTerms(did, TERMS_VERSION, PRIVACY_VERSION, deadline);
    if (step === "verify" || step === "done" || step === "notice" || step === "inbox" || step === "bell") {
      await readyMember(pool, did, step !== "verify");
    }
    if (step === "notice") await accounts.acceptTerms(did, TERMS_VERSION, "2000-01-01", deadline);
    await seedInboxOf(pool, did, step);
    cookies[name] = `__Host-sid=${created.cookieValue}`;
  }
  await pool.end();
  return cookies;
}

async function serveTest(): Promise<void> {
  const pg = await database();
  const dir = scratch();
  const keyring = JSON.stringify({ active: "k1", keys: { k1: randomBytes(32).toString("base64") } });
  const keyringFile = join(dir, "seal_keyring");
  writeFileSync(keyringFile, keyring);
  const writesFile = join(dir, "pds-writes.jsonl");
  writeFileSync(writesFile, "");
  const web = await startWeb(
    pg,
    { SEAL_KEYRING_FILE: keyringFile, ...frontedEnv("test") },
    {
      pds: {
        origin: `https://${PDS_HOST}`,
        did: ACCOUNT.did,
        // A profile, so the member page shows its card controls (cards.spec.ts adds and deletes its own cards).
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
  writeFileSync(SESSIONS_FILE, JSON.stringify(await seedMembers(pg, keyring)));
  process.on("exit", () => rmSync(SESSIONS_FILE, { force: true }));
  await tlsFront(dir, LISTEN.test, INNER.test);
  report("test", web);
}

async function once(url: string, deadline: number): Promise<boolean> {
  if (Date.now() >= deadline) return false;
  try {
    const response = await health(url);
    return response.ok;
  } catch (error) {
    void error;
    return false;
  }
}

async function waitFor(url: string): Promise<void> {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (await once(url, deadline)) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`health timeout ${url}`);
}

function dumpLogs(): void {
  for (const file of LOGS) {
    try {
      process.stderr.write(`\n# ${file}\n${readFileSync(file, "utf8")}\n`);
    } catch (error) {
      void error;
    }
  }
}

async function waitForServers(): Promise<void> {
  try {
    await waitFor(`http://127.0.0.1:${INNER.prod}/health`);
    await waitFor(`http://127.0.0.1:${INNER.test}/health`);
  } catch (error) {
    dumpLogs();
    throw error;
  }
}

function assertMode(value: string | undefined): Mode {
  if (value === "prod" || value === "test" || value === "wait") return value;
  throw new Error("usage: servers.ts prod|test|wait");
}

const mode = assertMode(process.argv[2]);
// One build for both processes: buildOnce takes the build lock, so the second waits for the first.
if (mode !== "wait") buildOnce("e2e");
if (mode === "prod") await serveProd();
else if (mode === "test") await serveTest();
else await waitForServers();
