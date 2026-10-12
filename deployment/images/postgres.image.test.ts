// P1.29d: the built postgres image has no gosu, runs as the official image's postgres user (999:999), boots and
// accepts connections as that user, and refuses to start as root, because the official entrypoint's gosu call then
// fails. It builds an image, so it lives in an *.image.test.ts file (P1.28r): CI runs it after the unit tests, and a
// local run without Docker fails rather than skips.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const DEPLOYMENT = join(import.meta.dirname, "..");
const POSTGRES_DOCKERFILE = join(DEPLOYMENT, "images/postgres.Dockerfile");
const READY = "database system is ready to accept connections";
/** The entrypoint runs initdb's scripts on a temporary server first; the real one is ready only after this line. */
const INIT_COMPLETE = "PostgreSQL init process complete";
const serving = (logs: string): boolean =>
  logs.includes(INIT_COMPLETE) && logs.lastIndexOf(READY) > logs.indexOf(INIT_COMPLETE);

const docker = (args: readonly string[]) => spawnSync("docker", args, { encoding: "utf8" });
// A container start, exec or removal waits on the one docker daemon, behind CI's parallel image builds, so it gets
// the budget of this repository's container tests (60 to 120 s), never vitest's 5 s test or 10 s hook default (P1.29o).
const CONTAINER_MS = 120_000;

describe("postgres image", () => {
  let image = "";
  const containers: string[] = [];

  beforeAll(() => {
    const built = docker(["build", "-q", "-f", POSTGRES_DOCKERFILE, join(DEPLOYMENT, "..")]);
    expect(built.status, built.stderr.slice(-2000)).toBe(0);
    image = built.stdout.trim();
  }, 600_000);

  afterAll(() => {
    for (const name of containers) spawnSync("docker", ["rm", "-f", "-v", name], { stdio: "ignore" });
    if (image !== "") spawnSync("docker", ["rmi", "-f", image], { stdio: "ignore" });
  }, CONTAINER_MS);

  /** Starts the image detached with no network and a throwaway superuser password; returns the container name. */
  function start(extra: readonly string[] = []): string {
    const name = `p129d-postgres-${randomBytes(6).toString("hex")}`;
    containers.push(name);
    const run = docker([
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
    ]);
    expect(run.status, run.stderr.slice(-2000)).toBe(0);
    return name;
  }

  test("postgres_image_strips_gosu", { timeout: CONTAINER_MS }, () => {
    const run = docker(["run", "--rm", "--network", "none", "--entrypoint", "sh", image, "-c", "command -v gosu"]);
    expect(run.stdout).toBe("");
    expect(run.status).not.toBe(0);
    const listed = docker(["run", "--rm", "--network", "none", "--entrypoint", "ls", image, "/usr/local/bin"]);
    expect(listed.stdout.split("\n").filter((file) => file !== "")).toEqual([
      "docker-enforce-initdb.sh",
      "docker-ensure-initdb.sh",
      "docker-entrypoint.sh",
    ]);
  });

  test("postgres_image_runs_as_postgres_uid", async () => {
    expect(docker(["image", "inspect", "--format", "{{.Config.User}}", image]).stdout.trim()).toBe("999:999");
    const name = start();
    let logs = "";
    for (let tries = 0; tries < 120 && !serving(logs); tries++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const read = docker(["logs", name]);
      logs = read.stdout + read.stderr;
    }
    expect(serving(logs), logs.slice(-2000)).toBe(true);
    // Every process in the container, the server included, runs as 999.
    // docker top runs ps with these options and needs the PID column (dockerd's ps parse).
    const top = docker(["top", name, "-o", "pid,uid,comm"]);
    const uids = top.stdout
      .split("\n")
      .slice(1)
      .filter((line) => line.trim() !== "")
      .map((line) => line.trim().split(/\s+/)[1]);
    expect(uids.length, top.stdout).toBeGreaterThan(0);
    expect(new Set(uids), top.stdout).toEqual(new Set(["999"]));
    const ready = docker(["exec", name, "pg_isready", "-U", "postgres"]);
    expect(ready.status, ready.stdout + ready.stderr).toBe(0);
  }, 120_000);

  test("postgres_image_refuses_root_start", async () => {
    // Started as root, the official entrypoint drops to postgres through gosu; with gosu gone that step fails, so the
    // server never runs as root.
    const name = start(["--user", "0:0"]);
    let state = "";
    for (let tries = 0; tries < 60 && state !== "exited"; tries++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      state = docker(["inspect", "--format", "{{.State.Status}}", name]).stdout.trim();
    }
    expect(state).toBe("exited");
    expect(docker(["inspect", "--format", "{{.State.ExitCode}}", name]).stdout.trim()).not.toBe("0");
    const read = docker(["logs", name]);
    expect(read.stdout + read.stderr).not.toContain(READY);
  }, 60_000);
});
