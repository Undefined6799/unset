// tests/support/postgres.ts (P1.27i, verifier P2 on #690): a removal killed in stopAllPostgres fails the calling hook
// by name instead of passing silently. A stand-in docker answers the start on loopback and hangs on `rm`; no docker
// daemon is used.
import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { startPostgres, stopAllPostgresAfter, stopAllPostgresWithin } from "../support/postgres.ts";

const dir = mkdtempSync(join(tmpdir(), "postgres-stop-"));
writeFileSync(
  join(dir, "docker"),
  [
    "#!/bin/sh",
    'case "$1" in',
    "  run) echo stand-in ;;",
    "  logs) echo 'PostgreSQL init process complete' ;;",
    "  port) echo 127.0.0.1:55432 ;;",
    "  rm) exec sleep 5 ;;",
    "esac",
    "",
  ].join("\n"),
);
chmodSync(join(dir, "docker"), 0o755);
// A second stand-in whose server never finishes init, so a start times out and has to clean up after itself.
const neverReady = mkdtempSync(join(tmpdir(), "postgres-stop-"));
writeFileSync(
  join(neverReady, "docker"),
  ["#!/bin/sh", 'case "$1" in', "  run) echo stand-in ;;", "  rm) exec sleep 5 ;;", "esac", ""].join("\n"),
);
chmodSync(join(neverReady, "docker"), 0o755);
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(neverReady, { recursive: true, force: true });
});

/** Runs `body` with `stand-in` first on PATH. */
async function withDocker<T>(standIn: string, body: () => Promise<T>): Promise<T> {
  const path = process.env.PATH;
  process.env.PATH = `${standIn}${delimiter}${path}`;
  try {
    return await body();
  } finally {
    process.env.PATH = path;
  }
}

/** The secrets folders this process created that still hold a file named `marker`. */
const secretsFoldersHolding = (marker: string): string[] =>
  readdirSync(tmpdir())
    .filter((entry) => entry.startsWith("unset-pg-secrets-"))
    .filter((entry) => existsSync(join(tmpdir(), entry, marker)));

describe("stopAllPostgresWithin", () => {
  test("killed_removal_fails_by_name", { timeout: 20_000 }, async () => {
    const path = process.env.PATH;
    process.env.PATH = `${dir}${delimiter}${path}`;
    try {
      const pg = await startPostgres({ initDir: dir });
      expect(() => stopAllPostgresWithin(300)).toThrow(`docker rm killed after 300 ms (${pg.name})`);
      // Nothing is left to retry: a second call has nothing to remove.
      expect(() => stopAllPostgresWithin(300)).not.toThrow();
    } finally {
      process.env.PATH = path;
    }
  });
});

describe("startPostgres", () => {
  test("failed_start_keeps_the_removal_error_and_its_folder_goes", { timeout: 20_000 }, async () => {
    // A start that fails removes its container; a killed removal was dropped and the secrets folder stayed, and a
    // failed globalSetup gets no teardown to remove either (F1, P1.11f).
    const marker = `marker-${process.pid}-${Date.now()}`;
    const failed = await withDocker(neverReady, () =>
      startPostgres({ initDir: neverReady, secrets: { [marker]: "x" } }, 300, 300).catch((error: unknown) => error),
    );
    expect(failed).toBeInstanceOf(AggregateError);
    expect((failed as AggregateError).message).toMatch(
      /^unset-test-pg-[0-9a-f]{12} did not finish init within 300 ms \(cleanup also failed: docker rm killed after 300 ms/,
    );
    expect(secretsFoldersHolding(marker)).toEqual([]);
    // The container that could not be removed is still named for stopAllPostgres to retry and report.
    await withDocker(neverReady, async () => expect(() => stopAllPostgresWithin(300)).toThrow("docker rm killed"));
  });
});

describe("stopAllPostgresAfter", () => {
  test("stop_runs_after_a_failing_close", async () => {
    // An afterAll hook that awaited pool.close() before stopAllPostgres left the containers running when a close
    // rejected (F2, P1.11f).
    let stopped = 0;
    const stop = () => {
      stopped += 1;
    };
    const closeFailed = new Error("pool close failed");
    await expect(stopAllPostgresAfter(() => Promise.reject(closeFailed), stop)).rejects.toBe(closeFailed);
    expect(stopped).toBe(1);
    // Both failures are reported, the close first.
    const both = await stopAllPostgresAfter(
      () => Promise.reject(closeFailed),
      () => {
        throw new Error("docker rm killed after 60000 ms (unset-test-pg-x)");
      },
    ).catch((error: unknown) => error);
    expect(both).toBeInstanceOf(AggregateError);
    expect((both as AggregateError).errors[0]).toBe(closeFailed);
    expect((both as AggregateError).message).toBe(
      "pool close failed (cleanup also failed: docker rm killed after 60000 ms (unset-test-pg-x))",
    );
    // A close that passes still stops, and a failing stop is thrown.
    await stopAllPostgresAfter(async () => undefined, stop);
    expect(stopped).toBe(2);
    await expect(
      stopAllPostgresAfter(
        async () => undefined,
        () => {
          throw new Error("docker rm killed");
        },
      ),
    ).rejects.toThrow("docker rm killed");
  });
});
