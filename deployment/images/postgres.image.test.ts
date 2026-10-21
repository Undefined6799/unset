// P1.29d: the built postgres image has no gosu, runs as the official image's postgres user (999:999), boots and
// accepts connections as that user, and refuses to start as root, because the official entrypoint's gosu call then
// fails. P1.11y: it authenticates only by deployment/postgres/pg_hba.conf, on a new data directory and on one
// initialised before. It builds an image, so it lives in an *.image.test.ts file (P1.28r): CI runs it after the unit tests, and a
// local run without Docker fails rather than skips.
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { docker, killBefore } from "../../tests/support/docker.ts";
import { buildTestImage, removeTestImage } from "../../tests/support/image-build.ts";

const DEPLOYMENT = join(import.meta.dirname, "..");
const POSTGRES_DOCKERFILE = join(DEPLOYMENT, "images/postgres.Dockerfile");
const READY = "database system is ready to accept connections";
/** The entrypoint runs initdb's scripts on a temporary server first; the real one is ready only after this line. */
const INIT_COMPLETE = "PostgreSQL init process complete";
const serving = (logs: string): boolean =>
  logs.includes(INIT_COMPLETE) && logs.lastIndexOf(READY) > logs.indexOf(INIT_COMPLETE);

// A container start, exec or removal waits on the one docker daemon, behind CI's parallel image builds, so it gets
// the budget of this repository's container tests (60 to 120 s), never vitest's 5 s test or 10 s hook default (P1.29o).
const CONTAINER_MS = 120_000;
const BUILD_MS = 300_000;
const ROOT_START_MS = 60_000;
// Each docker call is killed just under the budget of the test or hook that makes it, so a hung daemon fails that
// test with a named message before scripts/test/run.ts kills the whole run at 600 s (P1.27k, P1.27g).
const BUILD_CALL_MS = killBefore(BUILD_MS);
const CONTAINER_CALL_MS = killBefore(CONTAINER_MS);
const ROOT_START_CALL_MS = killBefore(ROOT_START_MS);
// A removal may queue behind CI's image builds like any container call, so it gets the same 60 s (verifier P4 on
// #690); the hook holds up to five containers, a volume and the image (Codex on #1189).
const REMOVE_CALL_MS = 60_000;
const REMOVE_HOOK_MS = 7 * REMOVE_CALL_MS + 5_000;

describe("postgres image", () => {
  let image = "";
  const containers: string[] = [];
  const volumes: string[] = [];

  beforeAll(() => {
    image = buildTestImage(POSTGRES_DOCKERFILE, join(DEPLOYMENT, ".."), { timeoutMs: BUILD_CALL_MS });
  }, BUILD_MS);

  // Every removal is tried, even after one fails, and the failures are reported together (P1.27g, P1.27x).
  afterAll(() => {
    const removals = [
      ...containers.map((name) => () => docker(["rm", "-f", "-v", name], { timeoutMs: REMOVE_CALL_MS })),
      ...volumes.map((name) => () => docker(["volume", "rm", "-f", name], { timeoutMs: REMOVE_CALL_MS })),
      ...(image === "" ? [] : [() => removeTestImage(image, { timeoutMs: REMOVE_CALL_MS })]),
    ];
    const failures: unknown[] = [];
    for (const remove of removals) {
      try {
        remove();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) throw new AggregateError(failures, `${failures.length} removal(s) failed`);
  }, REMOVE_HOOK_MS);

  /**
   * Starts the image detached with no network and a superuser password (a throwaway one unless given); `extra` goes
   * before the image and `command` after it. Returns the container name.
   */
  function start(
    timeoutMs: number,
    extra: readonly string[] = [],
    password = randomBytes(24).toString("base64url"),
    command: readonly string[] = [],
  ): string {
    const name = `p129d-postgres-${randomBytes(6).toString("hex")}`;
    containers.push(name);
    const run = docker(
      [
        "run",
        "-d",
        "--name",
        name,
        "--network",
        "none",
        "-e",
        `POSTGRES_PASSWORD=${password}`,
        ...extra,
        image,
        ...command,
      ],
      { timeoutMs },
    );
    expect(run.code, run.err.slice(-2000)).toBe(0);
    return name;
  }

  /** Waits until the entrypoint's init has finished and the real server accepts connections. */
  async function untilServing(name: string): Promise<void> {
    let logs = "";
    for (let tries = 0; tries < 120 && !serving(logs); tries++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const read = docker(["logs", name], { timeoutMs: CONTAINER_CALL_MS });
      logs = read.out + read.err;
    }
    expect(serving(logs), logs.slice(-2000)).toBe(true);
  }

  /** One query as the superuser over the socket, as the container's own postgres user (peer). */
  const superuser = (name: string, query: string) =>
    docker(["exec", name, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atc", query], {
      timeoutMs: CONTAINER_CALL_MS,
    });

  /** The rules the server loaded that are not ours: any error, and any method but peer, reject and SCRAM. */
  const OTHER_RULES =
    "SELECT count(*) FROM pg_hba_file_rules WHERE error IS NOT NULL OR auth_method NOT IN ('peer', 'reject', 'scram-sha-256')";

  /** Connects with a libpq string, never prompting, and returns psql's result. */
  const connect = (name: string, conninfo: string, password?: string) =>
    docker(
      [
        "exec",
        ...(password === undefined ? [] : ["-e", `PGPASSWORD=${password}`]),
        name,
        "psql",
        "-w",
        conninfo,
        "-Atc",
        "SELECT current_user",
      ],
      { timeoutMs: CONTAINER_CALL_MS },
    );

  test("postgres_image_authenticates_by_peer_and_scram_only", { timeout: CONTAINER_MS }, async () => {
    const password = randomBytes(24).toString("base64url");
    const name = start(CONTAINER_CALL_MS, [], password);
    await untilServing(name);
    expect(superuser(name, "SHOW hba_file").out.trim()).toBe("/etc/unset/pg_hba.conf");
    expect(superuser(name, OTHER_RULES).out.trim()).toBe("0");
    const probe = randomBytes(24).toString("base64url");
    expect(superuser(name, `CREATE ROLE probe LOGIN PASSWORD '${probe}'`).code).toBe(0);
    // A login role over TCP with its SCRAM password, and not without it.
    expect(connect(name, "host=127.0.0.1 user=probe dbname=postgres", probe).out.trim()).toBe("probe");
    expect(connect(name, "host=127.0.0.1 user=probe dbname=postgres").code).not.toBe(0);
    // Not on the socket, by peer or with its password: no line matches it there.
    for (const secret of [undefined, probe]) {
      const socket = connect(name, "host=/var/run/postgresql user=probe dbname=postgres", secret);
      expect(socket.code).not.toBe(0);
      expect(socket.err).toContain("no pg_hba.conf entry");
    }
    // The superuser never over TCP, even with its password.
    const tcp = connect(name, "host=127.0.0.1 user=postgres dbname=postgres", password);
    expect(tcp.code).not.toBe(0);
    expect(tcp.err).toContain("pg_hba.conf rejects connection");
  });

  test("postgres_image_overrides_an_existing_trust_file", { timeout: 2 * CONTAINER_MS }, async () => {
    // A data directory initialised without our CMD keeps initdb's own pg_hba.conf, trust lines included, as staging's
    // does. Started again with the image's CMD, the server reads only our file, so nothing in that volume needs editing.
    const volume = `p111y-pgdata-${randomBytes(6).toString("hex")}`;
    volumes.push(volume);
    const mount = ["-v", `${volume}:/var/lib/postgresql`];
    const before = start(CONTAINER_CALL_MS, mount, undefined, ["postgres"]);
    await untilServing(before);
    expect(superuser(before, "SELECT count(*) FROM pg_hba_file_rules WHERE auth_method = 'trust'").out.trim()).not.toBe(
      "0",
    );
    expect(docker(["stop", before], { timeoutMs: CONTAINER_CALL_MS }).code).toBe(0);
    const after = start(CONTAINER_CALL_MS, mount);
    let ready = false;
    for (let tries = 0; tries < 120 && !ready; tries++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      ready =
        docker(["exec", after, "pg_isready", "-h", "/var/run/postgresql"], { timeoutMs: CONTAINER_CALL_MS }).code === 0;
    }
    expect(ready).toBe(true);
    expect(superuser(after, "SHOW hba_file").out.trim()).toBe("/etc/unset/pg_hba.conf");
    expect(superuser(after, OTHER_RULES).out.trim()).toBe("0");
  });

  test("postgres_image_strips_gosu", { timeout: CONTAINER_MS }, () => {
    const run = docker(["run", "--rm", "--network", "none", "--entrypoint", "sh", image, "-c", "command -v gosu"], {
      timeoutMs: CONTAINER_CALL_MS,
    });
    expect(run.out).toBe("");
    expect(run.code).not.toBe(0);
    const listed = docker(["run", "--rm", "--network", "none", "--entrypoint", "ls", image, "/usr/local/bin"], {
      timeoutMs: CONTAINER_CALL_MS,
    });
    expect(listed.out.split("\n").filter((file) => file !== "")).toEqual([
      "docker-enforce-initdb.sh",
      "docker-ensure-initdb.sh",
      "docker-entrypoint.sh",
    ]);
  });

  test("postgres_image_has_no_sample_key_pair", { timeout: CONTAINER_MS }, () => {
    // The base's ssl-cert package generates a "snakeoil" key pair at upstream build time, so every copy of the official
    // image holds the same private key, and the subject-hash link to the certificate; it is listed as root so the 0710
    // private folder can be read. Any dangling link under /etc/ssl also fails, which catches a renamed hash link.
    const run = docker(
      [
        "run",
        "--rm",
        "--network",
        "none",
        "--user",
        "0:0",
        "--entrypoint",
        "sh",
        image,
        "-c",
        "ls -A /etc/ssl/private; find /etc/ssl -name '*snakeoil*' -o -xtype l",
      ],
      { timeoutMs: CONTAINER_CALL_MS },
    );
    expect(run.code, run.err.slice(-2000)).toBe(0);
    expect(run.out).toBe("");
  });

  test("postgres_image_runs_as_postgres_uid", { timeout: CONTAINER_MS }, async () => {
    expect(
      docker(["image", "inspect", "--format", "{{.Config.User}}", image], {
        timeoutMs: CONTAINER_CALL_MS,
      }).out.trim(),
    ).toBe("999:999");
    const name = start(CONTAINER_CALL_MS);
    await untilServing(name);
    // Every process in the container, the server included, runs as 999.
    // docker top runs ps with these options and needs the PID column (dockerd's ps parse).
    const top = docker(["top", name, "-o", "pid,uid,comm"], { timeoutMs: CONTAINER_CALL_MS });
    const uids = top.out
      .split("\n")
      .slice(1)
      .filter((line) => line.trim() !== "")
      .map((line) => line.trim().split(/\s+/)[1]);
    expect(uids.length, top.out).toBeGreaterThan(0);
    expect(new Set(uids), top.out).toEqual(new Set(["999"]));
    const ready = docker(["exec", name, "pg_isready", "-U", "postgres"], { timeoutMs: CONTAINER_CALL_MS });
    expect(ready.code, ready.out + ready.err).toBe(0);
  });

  test("postgres_image_refuses_root_start", { timeout: ROOT_START_MS }, async () => {
    // Started as root, the official entrypoint drops to postgres through gosu; with gosu gone that step fails, so the
    // server never runs as root.
    const name = start(ROOT_START_CALL_MS, ["--user", "0:0"]);
    let state = "";
    for (let tries = 0; tries < 60 && state !== "exited"; tries++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      state = docker(["inspect", "--format", "{{.State.Status}}", name], {
        timeoutMs: ROOT_START_CALL_MS,
      }).out.trim();
    }
    expect(state).toBe("exited");
    expect(
      docker(["inspect", "--format", "{{.State.ExitCode}}", name], { timeoutMs: ROOT_START_CALL_MS }).out.trim(),
    ).not.toBe("0");
    const read = docker(["logs", name], { timeoutMs: ROOT_START_CALL_MS });
    expect(read.out + read.err).not.toContain(READY);
  });
});
