// The built web server, started as production starts it (`node server.ts` over adapter-node's build), for the tests in
// this folder: every security outcome is checked on the build, never under `vite dev` (ADR 0054 decision 5). Each
// test file starts its own server against its own database, as the web role (TE-2), and stops it when done.
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { request as httpRequest } from "node:http"; // guard-allow: egress loopback requests to the test server only
import { createServer } from "node:net"; // guard-allow: egress binds a loopback port to find a free one
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = join(import.meta.dirname, "..", "..", "..");
const WEB = join(REPO, "interfaces", "web");
export const ORIGIN = "https://unset.test";
export const HOST = "unset.test";
export const PDS_HOST = "pds.unset.test";

/** The folders whose code goes into the web build: the app, its pages, and every workspace package it bundles. */
const BUILD_INPUTS = ["interfaces/web", "apps/web", "shared", "domains", "infrastructure"].map((dir) =>
  join(REPO, dir),
);
const NOT_INPUTS = new Set(["node_modules", "build", "dist", ".svelte-kit", ".build-lock", "test-results"]);

/**
 * What the build is made from, as each file's path, size and modification time: an edit changes it, so a later run
 * never reuses a build of older code (outside review of f5cab2f, finding 2: two local Playwright runs with an edit
 * between them built once). Reading only file metadata keeps it to a few milliseconds.
 */
export function sourceFingerprint(inputs: readonly string[] = BUILD_INPUTS): string {
  const hash = createHash("sha256");
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (NOT_INPUTS.has(entry.name) || entry.name.endsWith(".tsbuildinfo")) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) {
        const { size, mtimeMs } = statSync(path);
        hash.update(`${path}\0${size}\0${mtimeMs}\n`);
      }
    }
  };
  for (const input of inputs) walk(input);
  return hash.digest("hex").slice(0, 16);
}

/**
 * Builds interfaces/web once per run and source, however many processes ask at once: the first takes a lock folder
 * and builds; the others wait for its marker. `run` names the run (the test Postgres's port, new each run; "e2e" for
 * the browser harness's two servers), so a later file in the same run never rebuilds under a server another file is
 * still running; the source fingerprint makes a run after an edit build again. The build empties build/, markers
 * included.
 */
export function buildOnce(run: string | number): void {
  const marker = join(WEB, "build", `.built-${run}-${sourceFingerprint()}`);
  if (existsSync(marker)) return;
  withBuildLock(() => {
    if (existsSync(marker)) return;
    execFileSync("npx", ["vite", "build", "--logLevel", "error"], { cwd: WEB, stdio: "inherit" });
    writeFileSync(marker, "");
  });
}

/**
 * Runs `work` while no other test file writes interfaces/web's generated folders: vite build and svelte-kit sync both
 * rewrite .svelte-kit, and two at once fail.
 */
export function withBuildLock<T>(work: () => T): T {
  const lock = join(WEB, ".build-lock");
  for (let waited = 0; !tryLock(lock); waited += 1) {
    if (waited > 1200) throw new Error("interfaces/web build: waited 10 minutes for another file's build");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  try {
    return work();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

/** mkdir is atomic: exactly one caller creates the folder. */
function tryLock(path: string): boolean {
  try {
    mkdirSync(path);
    return true;
  } catch {
    return false;
  }
}

export async function freePort(): Promise<number> {
  return await new Promise((done, fail) => {
    const probe = createServer();
    probe.once("error", fail);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => done(typeof address === "object" && address !== null ? address.port : 0));
    });
  });
}

/** A request as the tests send it. Sent with node:http, because fetch may not set the Host header (Fetch spec,
 * forbidden request-header) and the host check is one of the outcomes under test. Redirects are never followed. */
export type WebRequest = { method?: string; headers?: Record<string, string>; body?: string };

function send(port: number, path: string, init: WebRequest): Promise<Response> {
  return new Promise((done, fail) => {
    const req = httpRequest(
      { host: "127.0.0.1", port, path, method: init.method ?? "GET", headers: { host: HOST, ...init.headers } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const headers = new Headers();
          for (const [name, value] of Object.entries(res.headers)) {
            for (const one of Array.isArray(value) ? value : [value ?? ""]) headers.append(name, one);
          }
          const status = res.statusCode ?? 0;
          const body = status === 204 || status === 304 ? null : Buffer.concat(chunks);
          done(new Response(body, { status, headers }));
        });
      },
    );
    req.once("error", fail);
    req.end(init.body);
  });
}

/**
 * What stand-in-server.ts answers in place of the network: `http` for identity GETs (PLC documents, did:web, handle
 * domains) by URL, `txt` for DNS TXT lookups by name, `fetch` for the OAuth client's and the PDS calls' requests by
 * "METHOD url". A server started without one reaches the real network through net-guard, as in production.
 */
export type StandInFixture = {
  http?: Record<string, { status?: number; body: unknown }>;
  txt?: Record<string, string[]>;
  /** `delayMs` holds the answer that long, or until the request is aborted, to play a slow server. */
  fetch?: Record<string, { status?: number; body: unknown; delayMs?: number }>;
  /** A stand-in PDS and authorization server at `origin` holding `did`'s repo (stand-in-pds.ts). */
  pds?: PdsFixture;
};

export type PdsFixture = {
  readonly origin: string;
  readonly did: string;
  /** collection → record key → record value. */
  readonly records: Record<string, Record<string, unknown>>;
  /** Every write is appended here as one JSON line, for the test to read back. */
  readonly writesFile: string;
  /** XRPC methods that answer 503, to play an unavailable PDS. */
  readonly failing?: readonly string[];
  /** XRPC methods (com.atproto.repo.*) whose answer is held this many milliseconds, to line up two requests' calls. */
  readonly slow?: Readonly<Record<string, number>>;
  /** With it the stand-in answers com.atproto.server.getSession for `did` with this email state. */
  readonly session?: { readonly emailConfirmed: boolean };
};

export type Postgres = { host: string; port: number; database: string; user: string; password: string };

export type RunningWeb = {
  /** The loopback port it listens on, for a test that must write the bytes of a request itself. */
  port: number;
  /** A request to the server, with the Host header ours unless `headers` sets one. */
  fetch: (path: string, init?: WebRequest) => Promise<Response>;
  /** Every log line written so far, parsed. */
  logs: () => Record<string, unknown>[];
  /** Replaces the stand-ins' answers (a server started with a fixture only). */
  setStandIns: (standIns: StandInFixture) => void;
  /** Every stand-in fetch so far, as "METHOD url", oldest first. */
  standInCalls: () => string[];
  /** Stops the server with SIGTERM and resolves with its exit code. */
  stop: () => Promise<number | null>;
};

/** The legal settings (P1.20d), as deployment/compose.local.yaml has them: the placeholder tokens. */
export const LEGAL_ENV = {
  PRIVACY_OFFICER_TITLE: "[to fill: PRIVACY_OFFICER_TITLE]",
  PRIVACY_OFFICER_CONTACT: "[to fill: PRIVACY_OFFICER_CONTACT]",
  SUPPORT_EMAIL: "[to fill: SUPPORT_EMAIL]",
  SECURITY_CONTACT: "privacy-page",
  SECURITY_TXT_EXPIRES: "2027-10-01T00:00:00Z",
};

/**
 * Starts the built server with the test profile and TEST_ROUTES on; `env` adds or replaces keys. With `standIns` it
 * starts through stand-in-server.ts, which answers the network from that fixture.
 */
export async function startWeb(
  pg: Postgres,
  env: Record<string, string> = {},
  standIns?: StandInFixture,
  options: { pickPort?: () => Promise<number> } = {},
): Promise<RunningWeb> {
  // A caller may pin the port (the browser harness, tests/e2e/fixtures/servers.ts); a pinned port is never swapped.
  if (env.LISTEN_PORT !== undefined) return await startOn(Number(env.LISTEN_PORT), pg, env, standIns);
  // A port freePort released can be taken before the child binds it; then the start is tried again on a new one.
  const pickPort = options.pickPort ?? freePort;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await startOn(await pickPort(), pg, env, standIns);
    } catch (error) {
      if (!(error instanceof PortTaken) || attempt === PORT_TRIES) throw error;
    }
  }
}

const PORT_TRIES = 3;

/** The child could not bind its port, because another process took it after freePort released it. */
class PortTaken extends Error {}

async function startOn(
  port: number,
  pg: Postgres,
  env: Record<string, string>,
  standIns: StandInFixture | undefined,
): Promise<RunningWeb> {
  const secrets = mkdtempSync(join(tmpdir(), "web-kit-"));
  const secret = (name: string, text: string): string => {
    const path = join(secrets, name);
    writeFileSync(path, text);
    return path;
  };
  // Made per run, as interfaces/http/test-env.ts makes them, so no key material sits in the repository.
  const keyring = { active: "k1", keys: { k1: randomBytes(32).toString("base64") } };
  const clientKey = {
    ...generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "jwk" }),
    kid: "A",
    alg: "ES256",
  };
  // web's key for pds-admin (P2.10): a fresh Ed25519 pair; a test that plays pds-admin passes PDS_ADMIN_URL.
  const adminKey = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  const chatAdminKey = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  // This child's own commit, so the readiness probe knows its answer from another process's on the same port.
  const commit = env.UNSET_COMMIT ?? randomBytes(20).toString("hex");
  const entry = standIns === undefined ? "server.ts" : join(import.meta.dirname, "stand-in-server.ts");
  const fixture =
    standIns === undefined
      ? {}
      : {
          WEB_STAND_IN_FIXTURE: secret("stand-ins.json", JSON.stringify(standIns)),
          WEB_STAND_IN_CALLS: secret("stand-in-calls.txt", ""),
        };
  const child: ChildProcess = spawn(process.execPath, [entry], {
    cwd: WEB,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      PATH: process.env.PATH ?? "",
      UNSET_ENV: "test",
      UNSET_SERVICE: "http",
      UNSET_COMMIT: commit,
      PUBLIC_ORIGIN: ORIGIN,
      HTTP_ALLOWED_HOSTS: HOST,
      MEDIA_ORIGIN: "https://unset-media.test",
      TRUSTED_PROXY_MODE: "header",
      TRUSTED_PROXY_HEADER: "x-forwarded-for",
      TRUSTED_PROXY_CIDRS: "127.0.0.0/8",
      PG_HOST: pg.host,
      PG_PORT: String(pg.port),
      PG_DATABASE: pg.database,
      PG_USER: pg.user,
      PG_PASSWORD_FILE: secret("pg_web", pg.password),
      PG_SSLMODE: "disable",
      PG_POOL_MAX: "4",
      SEAL_KEYRING_FILE: secret("seal_keyring", JSON.stringify(keyring)),
      PLC_URL: "https://plc.directory",
      OAUTH_CLIENT_KEYS_FILE: secret("oauth_client_keys", JSON.stringify([clientKey])),
      OAUTH_ACTIVE_KID: "A",
      PDS_HOSTNAME: PDS_HOST,
      HANDLE_SUFFIX: `.${PDS_HOST}`,
      PDS_ADMIN_URL: "http://pds-admin.test:8080",
      PDS_ADMIN_WEB_KEY_FILE: secret("web_pds_admin_key", adminKey),
      PDS_WEB_KEY_FILE: secret("pds_web_key", randomBytes(32).toString("hex")),
      PDS_ADMIN_WEB_KID: "web-test",
      // Build step 5: chat-admin's origin and web's key there; nothing answers, so queued accounts wait.
      CHAT_ADMIN_URL: "http://chat-admin.test:8080",
      CHAT_ADMIN_WEB_KEY_FILE: secret("web_chat_admin_key", chatAdminKey),
      CHAT_ADMIN_WEB_KID: "web-test",
      CHAT_DOOR_ORIGIN: "https://staging.unset.cc",
      // Build step 10: the door's count port; nothing answers, so a member's chat icon shows no number.
      CHAT_COUNT_URL: "http://chat-count.test:8081",
      PDS_DID: `did:web:${PDS_HOST}`,
      // P2.21a: the draft image store; no store answers here, and none is asked at boot.
      OBJECT_STORE_URL: "http://objects.test:8333",
      REVIEW_URL: "http://review.test:8082",
      OBJECT_STORE_BUCKET: "unset-private",
      OBJECT_STORE_ACCESS_ID: "unset-web",
      OBJECT_STORE_SECRET_FILE: secret("objects_web", randomBytes(32).toString("hex")),
      TEST_ROUTES: "true",
      ...LEGAL_ENV,
      ...fixture,
      ...env,
      LISTEN_PORT: String(port),
    },
  });
  let out = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    out += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    out += chunk.toString();
  });
  const exited = new Promise<number | null>((done) => child.once("exit", (code) => done(code)));
  const fetchWeb = (path: string, init: WebRequest = {}) => send(port, path, init);
  try {
    await waitUntilListening(fetchWeb, commit, exited, () => out);
  } catch (error) {
    child.kill("SIGKILL");
    await exited;
    rmSync(secrets, { recursive: true, force: true });
    throw error;
  }
  return {
    port,
    fetch: fetchWeb,
    logs: () =>
      out
        .split("\n")
        .filter((line) => line.startsWith("{"))
        .map((line) => JSON.parse(line) as Record<string, unknown>),
    setStandIns: (next) => {
      secret("stand-ins.json", JSON.stringify(next));
    },
    standInCalls: () =>
      standIns === undefined
        ? []
        : readFileSync(join(secrets, "stand-in-calls.txt"), "utf8").split("\n").filter(Boolean),
    stop: async () => {
      child.kill("SIGTERM");
      const code = await exited;
      rmSync(secrets, { recursive: true, force: true });
      return code;
    },
  };
}

/**
 * Waits until /health on the port answers with this child's commit. The port was free when freePort released it, but
 * another process on the runner can bind it before the child does; the child then exits on EADDRINUSE, and an answer
 * from that process must never count (#1731 code job, 2026-11-19: every later request went to it, a 404 in 17 ms).
 */
async function waitUntilListening(
  fetchWeb: RunningWeb["fetch"],
  commit: string,
  exited: Promise<number | null>,
  output: () => string,
): Promise<void> {
  let gone = false;
  void exited.then(() => {
    gone = true;
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (gone) {
      const message = `web server exited before listening:\n${output()}`;
      // server.ts logs no error code (rule SE-7); on a port above 1024 a failed listen means the port is taken.
      throw output().includes('"event":"http.listen_failed"') ? new PortTaken(message) : new Error(message);
    }
    try {
      const response = await fetchWeb("/health");
      const body = (await response.json().catch(() => null)) as { commit?: unknown } | null;
      if (body?.commit === commit) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((done) => setTimeout(done, 50));
  }
  throw new Error(`web server did not listen:\n${output()}`);
}

let addresses = 0;
/** A new client address per call, so two tests never share a rate-limit bucket. */
export const clientAddress = (): string => {
  addresses += 1;
  return `198.51.100.${addresses}`;
};
