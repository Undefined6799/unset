// P1.38w: test containers outlive a run that ends before its teardown. Vitest 5.0.5 answers Ctrl-C and SIGTERM with
// process.exit and no globalSetup teardown (dist/chunks/index.1TqnEahn.js, addCleanupListeners), and
// scripts/test/run.ts ends a run past its limit with SIGKILL, so the Postgres a run started kept running (measured
// 2026-11-21: one unset-test-pg container left per interrupted run). A process that exits removes what it started, and
// the next integration run removes whatever a killed one left.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { docker, OWNER_LABEL, removeOrphans } from "../support/docker.ts";
import { POSTGRES_IMAGE } from "../support/postgres.ts";

const CALL_MS = 60_000;
const dir = mkdtempSync(join(tmpdir(), "docker-orphans-"));
const started: string[] = [];
afterAll(() => {
  for (const name of started) docker(["rm", "-f", "-v", name], { timeoutMs: CALL_MS });
  rmSync(dir, { recursive: true, force: true });
}, 2 * CALL_MS);

/** A pid no process holds any more: a child that has already exited. */
const endedPid = (): number => {
  const pid = spawnSync(process.execPath, ["-e", ""]).pid;
  if (pid === undefined) throw new Error("no child pid");
  return pid;
};

/** Starts a container that only sleeps, labelled as started by `owner`; returns its name. */
function sleeper(owner: number): string {
  const name = `unset-test-orphan-${owner}-${started.length}`;
  const args = ["run", "-d", "--rm", "--name", name, "--label", `${OWNER_LABEL}=${owner}`, POSTGRES_IMAGE];
  const ran = docker([...args, "sleep", "300"], { timeoutMs: CALL_MS });
  expect(ran.code, ran.err).toBe(0);
  started.push(name);
  return name;
}

const exists = (name: string): boolean =>
  docker(["ps", "-a", "--filter", `name=^${name}$`, "--format", "{{.Names}}"], { timeoutMs: CALL_MS }).out.trim() ===
  name;

describe("containers a run leaves behind", () => {
  test("containers_of_an_ended_run_are_removed", { timeout: 3 * CALL_MS }, () => {
    const orphan = sleeper(endedPid());
    const ours = sleeper(process.pid);
    expect(removeOrphans(CALL_MS)).toContain(orphan);
    expect(exists(orphan)).toBe(false);
    // A container whose owner still runs, this test's or another checkout's run, is never touched.
    expect(exists(ours)).toBe(true);
  });

  test("an_exiting_process_removes_its_postgres", { timeout: 20_000 }, () => {
    // A stand-in docker answers a start at once and writes down every removal; the child exits the way vitest does
    // on Ctrl-C, with process.exit and no afterAll.
    const removals = join(dir, "removals");
    writeFileSync(
      join(dir, "docker"),
      [
        "#!/bin/sh",
        'case "$1" in',
        "  run) echo stand-in ;;",
        "  logs) echo 'PostgreSQL init process complete' ;;",
        "  exec) exit 0 ;;",
        "  port) echo 127.0.0.1:55432 ;;",
        `  rm) echo "$*" >> '${removals}' ;;`,
        "esac",
        "",
      ].join("\n"),
    );
    chmodSync(join(dir, "docker"), 0o755);
    const child = [
      `import { startPostgres } from ${JSON.stringify(join(import.meta.dirname, "..", "support", "postgres.ts"))};`,
      `const pg = await startPostgres({ initDir: ${JSON.stringify(dir)} });`,
      "process.stdout.write(pg.name);",
      "process.exit(130);",
    ].join("\n");
    const ran = spawnSync(process.execPath, ["--input-type=module", "-e", child], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH}` },
      timeout: 15_000,
    });
    expect(ran.status, ran.stderr).toBe(130);
    expect(ran.stdout).toMatch(/^unset-test-pg-[0-9a-f]{12}$/);
    expect(readFileSync(removals, "utf8")).toBe(`rm -f -v ${ran.stdout}\n`);
  });
});
