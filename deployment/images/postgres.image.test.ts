// P1.29d: the built postgres image has no gosu, runs as the official image's postgres user (999:999), boots and
// accepts connections as that user, and refuses to start as root, because the official entrypoint's gosu call then
// fails. It builds an image, so it lives in an *.image.test.ts file (P1.28r): CI runs it after the unit tests, and a
// local run without Docker fails rather than skips.
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { docker, killBefore } from "../../tests/support/docker.ts";

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
const REMOVE_CALL_MS = 35_000;

describe("postgres image", () => {
  let image = "";
  const containers: string[] = [];

  beforeAll(() => {
    const built = docker(["build", "-q", "-f", POSTGRES_DOCKERFILE, join(DEPLOYMENT, "..")], {
      timeoutMs: BUILD_CALL_MS,
    });
    expect(built.code, built.err.slice(-2000)).toBe(0);
    image = built.out.trim();
  }, BUILD_MS);

  // Every removal is tried, even after one is killed, and each is killed at REMOVE_CALL_MS so the two containers and
  // the image fit in the hook's budget; the kills are reported together (P1.27g).
  afterAll(() => {
    const removals = [
      ...containers.map((name) => ["rm", "-f", "-v", name]),
      ...(image === "" ? [] : [["rmi", "-f", image]]),
    ];
    const failures: unknown[] = [];
    for (const args of removals) {
      try {
        docker(args, { timeoutMs: REMOVE_CALL_MS });
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) throw new AggregateError(failures, `${failures.length} removal(s) killed`);
  }, CONTAINER_MS);

  /** Starts the image detached with no network and a throwaway superuser password; returns the container name. */
  function start(timeoutMs: number, extra: readonly string[] = []): string {
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
        `POSTGRES_PASSWORD=${randomBytes(24).toString("base64url")}`,
        ...extra,
        image,
      ],
      { timeoutMs },
    );
    expect(run.code, run.err.slice(-2000)).toBe(0);
    return name;
  }

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

  test("postgres_image_runs_as_postgres_uid", { timeout: CONTAINER_MS }, async () => {
    expect(
      docker(["image", "inspect", "--format", "{{.Config.User}}", image], {
        timeoutMs: CONTAINER_CALL_MS,
      }).out.trim(),
    ).toBe("999:999");
    const name = start(CONTAINER_CALL_MS);
    let logs = "";
    for (let tries = 0; tries < 120 && !serving(logs); tries++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const read = docker(["logs", name], { timeoutMs: CONTAINER_CALL_MS });
      logs = read.out + read.err;
    }
    expect(serving(logs), logs.slice(-2000)).toBe(true);
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
