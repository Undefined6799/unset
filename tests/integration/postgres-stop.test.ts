// tests/support/postgres.ts (P1.27i, verifier P2 on #690): a removal killed in stopAllPostgres fails the calling hook
// by name instead of passing silently. A stand-in docker answers the start on loopback and hangs on `rm`; no docker
// daemon is used.
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { startPostgres, stopAllPostgresWithin } from "../support/postgres.ts";

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
afterAll(() => rmSync(dir, { recursive: true, force: true }));

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
