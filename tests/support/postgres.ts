// The one way tests run Postgres (ruling 2026-10-06, P1.11g): the pinned image, started by `docker run` from the
// test, so the local gate and CI run the same thing and the init scripts run at initdb as in production. Any second
// mechanism stops and asks. Hardening: --rm, the port published on 127.0.0.1 only, no --privileged or host network,
// the init folder and secrets mounted read-only, a random superuser password per run, and removal even on failure.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanUpAll, docker, failAfterCleanup } from "./docker.ts";

type LockEntry = { ref: string; tag: string; digest: string };

/**
 * The upstream image our Postgres image builds on, read from the lock's `postgres` entry (P1.29d), so tests and the
 * shipped image move together. Tests run it as shipped upstream, starting as root and dropping to postgres through
 * gosu, test-only; the image we ship (deployment/images/postgres.Dockerfile) has no gosu and never starts as root.
 */
function lockedPostgres(): string {
  const lock = JSON.parse(
    readFileSync(join(import.meta.dirname, "../../deployment/images/bases.lock.json"), "utf8"),
  ) as Record<string, LockEntry>;
  const entry = lock.postgres;
  if (entry === undefined) throw new Error("bases.lock.json has no postgres entry");
  return `${entry.ref}:${entry.tag}@${entry.digest}`;
}

/** postgres:18-trixie by index digest, the image every Postgres test runs. */
export const POSTGRES_IMAGE = lockedPostgres();

export interface PostgresOptions {
  /** Folder mounted read-only at /docker-entrypoint-initdb.d. */
  readonly initDir: string;
  /** Files mounted read-only at /run/secrets, by name. */
  readonly secrets?: Readonly<Record<string, string>>;
}

export interface PostgresContainer {
  readonly name: string;
  /** The host port bound on 127.0.0.1. */
  readonly port: number;
  /** One query's rows as `a|b` lines, as the bootstrap superuser over the container's local socket. */
  sql(db: string, query: string): string;
  /** Runs `psql -Atc <query>` inside the container over TCP with a password, as a login role would connect. */
  login(user: string, db: string, password: string, query: string): string;
}

export interface InitExit {
  /** The container's exit code, or null when it was still serving at the timeout. */
  readonly code: number | null;
  readonly logs: string;
}

const STARTED = new Set<string>();
const DIRS = new Set<string>();
const INIT_COMPLETE = "PostgreSQL init process complete";
const OWNER_LABEL = "sh.unset.test-owner";
// One docker call (ps, run -d, logs, exec, port, rm) may queue behind CI's parallel image builds (P1.29z), but never
// for a minute: it is killed at 60 s, so a hung daemon fails the calling test with a named message instead of
// blocking the event loop until scripts/test/run.ts kills the whole run at 600 s (P1.27k). Every caller's budget holds
// its calls: startPostgres's beforeAll hooks give 120 s, and hooks that end in stopAllPostgres give STOP_ALL_MS.
const CALL_MS = 60_000;
/**
 * The budget for an afterAll hook that ends in stopAllPostgres: one removal per container this file started (most
 * start one), each killed at CALL_MS, plus room for the hook's own quick cleanup. Vitest's 10 s default is shorter
 * than a single killed removal (P1.27g).
 */
export const STOP_ALL_MS = 2 * CALL_MS;

/** Names of the containers, running or stopped, that this process started and has not removed. */
export function ownContainers(): string[] {
  const listed = docker(["ps", "-a", "--filter", `label=${OWNER_LABEL}=${process.pid}`, "--format", "{{.Names}}"], {
    timeoutMs: CALL_MS,
  });
  return listed.out.split("\n").filter((name) => name !== "");
}

/** A password for one run: 32 random bytes, URL-safe. */
export const randomPassword = (): string => randomBytes(32).toString("base64url");

/**
 * Removes every container (with its anonymous data volume) and secrets folder this file created. Call it from
 * afterAll, as `afterAll(stopAllPostgres)` or in a hook. Every removal is tried; a killed one then fails the hook by
 * name, after the folders are gone (P1.27i). It takes no argument, since vitest passes its hooks one.
 */
export function stopAllPostgres(): void {
  stopAllPostgresWithin(CALL_MS);
}

/** stopAllPostgres with each removal killed at `removeMs`; only the test of a killed removal lowers it. */
export function stopAllPostgresWithin(removeMs: number): void {
  const failures = [...STARTED].flatMap((name) => {
    const failure = remove(name, removeMs);
    return failure === null ? [] : [failure];
  });
  STARTED.clear();
  for (const dir of DIRS) rmSync(dir, { recursive: true, force: true });
  DIRS.clear();
  if (failures.length > 0) throw new AggregateError(failures, failures.map((failure) => failure.message).join("; "));
}

/**
 * Awaits `close` (an afterAll hook's pool closes), then runs `stop` whatever `close` did, so a rejected close never
 * leaves the containers running; when both fail, both are reported, the close first (F2, P1.11f).
 */
export async function stopAllPostgresAfter(
  close: () => Promise<unknown>,
  stop: () => void = stopAllPostgres,
): Promise<void> {
  try {
    await close();
  } catch (failure) {
    failAfterCleanup(failure, stop);
  }
  stop();
}

/**
 * Starts the image detached and waits until initdb finished and the server accepts connections again. A start that
 * fails removes its container and its secrets folder before throwing; a killed removal is reported with the failure,
 * never dropped, and the name stays for stopAllPostgres (F1, P1.11f). `removeMs` is lowered only by that test.
 */
export async function startPostgres(
  options: PostgresOptions,
  timeoutMs = 90_000,
  removeMs = CALL_MS,
): Promise<PostgresContainer> {
  const name = containerName();
  const secrets = secretsDir(options.secrets ?? {});
  try {
    dockerOut(["run", "-d", ...runArgs(name, options.initDir, secrets), POSTGRES_IMAGE]);
    await waitUntilServing(name, timeoutMs);
    return container(name, hostPort(name));
  } catch (error) {
    failAfterCleanup(error, () =>
      cleanUpAll(
        () => {
          const failure = remove(name, removeMs);
          if (failure !== null) throw failure;
        },
        () => removeSecretsDir(secrets),
      ),
    );
  }
}

/** Runs the image in the foreground and reports how initdb ended: for scripts that must fail closed. */
export function runUntilExit(options: PostgresOptions, timeoutMs = 90_000): InitExit {
  const name = containerName();
  const secrets = secretsDir(options.secrets ?? {});
  // Its own timeout reports a server still running as `code: null`, so it keeps spawnSync, now with SIGKILL (P1.27k).
  const result = spawnSync("docker", ["run", ...runArgs(name, options.initDir, secrets), POSTGRES_IMAGE], {
    encoding: "utf8",
    timeout: timeoutMs,
    killSignal: "SIGKILL",
  });
  const logs = `${result.stdout}${result.stderr}`;
  if (result.error || result.status === null) {
    remove(name);
    return { code: null, logs };
  }
  return { code: result.status, logs };
}

function containerName(): string {
  const name = `unset-test-pg-${randomBytes(6).toString("hex")}`;
  STARTED.add(name);
  return name;
}

function runArgs(name: string, initDir: string, secrets: string): string[] {
  return [
    "--rm",
    "--name",
    name,
    // Lets a test list the containers its own process started (teardown_after_failure).
    "--label",
    `${OWNER_LABEL}=${process.pid}`,
    "-p",
    "127.0.0.1::5432",
    "-e",
    `POSTGRES_PASSWORD=${randomPassword()}`,
    "-v",
    `${initDir}:/docker-entrypoint-initdb.d:ro`,
    "-v",
    `${secrets}:/run/secrets:ro`,
  ];
}

/** A folder the image's postgres user (uid 999) can read, holding one file per secret. */
function secretsDir(files: Readonly<Record<string, string>>): string {
  const dir = mkdtempSync(join(tmpdir(), "unset-pg-secrets-"));
  DIRS.add(dir);
  chmodSync(dir, 0o755);
  for (const [file, value] of Object.entries(files)) {
    writeFileSync(join(dir, file), value);
    chmodSync(join(dir, file), 0o644);
  }
  return dir;
}

function removeSecretsDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
  DIRS.delete(dir);
}

async function waitUntilServing(name: string, timeoutMs: number): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const logs = docker(["logs", name], { timeoutMs: CALL_MS });
    if (logs.code !== 0) throw new Error(`${name} exited during init`);
    const ready = `${logs.out}${logs.err}`.includes(INIT_COMPLETE);
    if (ready && docker(["exec", name, "pg_isready", "-h", "127.0.0.1"], { timeoutMs: CALL_MS }).code === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${name} did not finish init within ${timeoutMs} ms`);
}

function hostPort(name: string): number {
  const binding = dockerOut(["port", name, "5432/tcp"]);
  const match = /^127\.0\.0\.1:(\d+)$/m.exec(binding);
  if (!match?.[1]) throw new Error(`${name} is not bound to 127.0.0.1 only`);
  return Number(match[1]);
}

function container(name: string, port: number): PostgresContainer {
  return {
    name,
    port,
    sql: (db, query) =>
      dockerOut(["exec", name, "psql", "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1", "-Atc", query]),
    login: (user, db, password, query) =>
      dockerOut([
        "exec",
        "-e",
        `PGPASSWORD=${password}`,
        name,
        "psql",
        `host=127.0.0.1 user=${user} dbname=${db}`,
        "-Atc",
        query,
      ]),
  };
}

/**
 * Removes a container and its anonymous volume. A kill is returned, naming the container, and the name stays for
 * stopAllPostgres to report; it is never thrown here, so it cannot mask the failure of a start that is cleaning up.
 */
function remove(name: string, timeoutMs = CALL_MS): Error | null {
  try {
    docker(["rm", "-f", "-v", name], { timeoutMs });
  } catch (error) {
    return new Error(`${(error as Error).message} (${name})`);
  }
  STARTED.delete(name);
  return null;
}

function dockerOut(args: string[]): string {
  const result = docker(args, { timeoutMs: CALL_MS });
  if (result.code !== 0) throw new Error(`docker ${args[0]} failed: ${result.err.trim()}`);
  return result.out.trim();
}
