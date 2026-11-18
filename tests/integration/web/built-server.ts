// The built web server, started as production starts it (`node server.ts` over adapter-node's build), for the tests in
// this folder: every security outcome is checked on the build, never under `vite dev` (ADR 0054 decision 5). Each
// test file starts its own server against its own database, as the web role (TE-2), and stops it when done.
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http"; // guard-allow: egress loopback requests to the test server only
import { createServer } from "node:net"; // guard-allow: egress binds a loopback port to find a free one
import { tmpdir } from "node:os";
import { join } from "node:path";

const WEB = join(import.meta.dirname, "..", "..", "..", "interfaces", "web");
export const ORIGIN = "https://unset.test";
export const HOST = "unset.test";
export const PDS_HOST = "pds.unset.test";

/** Builds interfaces/web once per run; a file that finds a build made by an earlier file in this run reuses it. */
export function buildOnce(): void {
  if (process.env.WEB_BUILD_DONE === "1" && existsSync(join(WEB, "build", "handler.js"))) return;
  execFileSync("npx", ["vite", "build", "--logLevel", "error"], { cwd: WEB, stdio: "inherit" });
  process.env.WEB_BUILD_DONE = "1";
}

async function freePort(): Promise<number> {
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

export type Postgres = { host: string; port: number; database: string; user: string; password: string };

export type RunningWeb = {
  /** A request to the server, with the Host header ours unless `headers` sets one. */
  fetch: (path: string, init?: WebRequest) => Promise<Response>;
  /** Every log line written so far, parsed. */
  logs: () => Record<string, unknown>[];
  /** Stops the server with SIGTERM and resolves with its exit code. */
  stop: () => Promise<number | null>;
};

/** Starts the built server with the test profile and TEST_ROUTES on; `env` adds or replaces keys. */
export async function startWeb(pg: Postgres, env: Record<string, string> = {}): Promise<RunningWeb> {
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
  const port = await freePort();
  const child: ChildProcess = spawn(process.execPath, ["server.ts"], {
    cwd: WEB,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      PATH: process.env.PATH ?? "",
      UNSET_ENV: "test",
      UNSET_SERVICE: "http",
      UNSET_COMMIT: "c".repeat(40),
      LISTEN_PORT: String(port),
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
      TEST_ROUTES: "true",
      ...env,
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
  await waitUntilListening(fetchWeb, exited, () => out);
  return {
    fetch: fetchWeb,
    logs: () =>
      out
        .split("\n")
        .filter((line) => line.startsWith("{"))
        .map((line) => JSON.parse(line) as Record<string, unknown>),
    stop: async () => {
      child.kill("SIGTERM");
      const code = await exited;
      rmSync(secrets, { recursive: true, force: true });
      return code;
    },
  };
}

async function waitUntilListening(
  fetchWeb: RunningWeb["fetch"],
  exited: Promise<number | null>,
  output: () => string,
): Promise<void> {
  let gone = false;
  void exited.then(() => {
    gone = true;
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (gone) throw new Error(`web server exited before listening:\n${output()}`);
    try {
      await fetchWeb("/health");
      return;
    } catch {
      await new Promise((done) => setTimeout(done, 50));
    }
  }
  throw new Error(`web server did not listen:\n${output()}`);
}

let addresses = 0;
/** A new client address per call, so two tests never share a rate-limit bucket. */
export const clientAddress = (): string => {
  addresses += 1;
  return `198.51.100.${addresses}`;
};
