// The one Postgres test helper (tests/support/postgres.ts, ruling 2026-10-06): it keeps the container on loopback,
// unprivileged and read-only, reports a failed init script, and leaves nothing behind.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { runUntilExit, startPostgres, stopAllPostgres } from "../support/postgres.ts";

const dirs: string[] = [];
const names: string[] = [];
const volumes: string[] = [];

afterAll(() => {
  stopAllPostgres();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** An init folder the image can read, holding the given scripts (executable). */
function initDir(scripts: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "unset-pg-init-"));
  dirs.push(dir);
  chmodSync(dir, 0o755);
  for (const [file, body] of Object.entries(scripts)) {
    writeFileSync(join(dir, file), body);
    chmodSync(join(dir, file), 0o755);
  }
  return dir;
}

const inspect = (name: string, format: string) =>
  spawnSync("docker", ["inspect", "-f", format, name], { encoding: "utf8" }).stdout.trim();

describe("tests/support/postgres.ts", () => {
  test("postgres_helper_is_hardened", { timeout: 120_000 }, async () => {
    const pg = await startPostgres({ initDir: initDir({}), secrets: { example: "value" } });
    names.push(pg.name);
    expect(pg.port).toBeGreaterThan(0);
    expect(inspect(pg.name, "{{range $p, $b := .NetworkSettings.Ports}}{{range $b}}{{.HostIp}} {{end}}{{end}}")).toBe(
      "127.0.0.1",
    );
    expect(inspect(pg.name, "{{.HostConfig.Privileged}} {{.HostConfig.NetworkMode}} {{.HostConfig.AutoRemove}}")).toBe(
      "false bridge true",
    );
    expect(
      inspect(pg.name, '{{range .Mounts}}{{if eq .Type "bind"}}{{.Destination}}={{.RW}} {{end}}{{end}}')
        .split(" ")
        .filter(Boolean)
        .sort(),
    ).toEqual(["/docker-entrypoint-initdb.d=false", "/run/secrets=false"]);
    volumes.push(
      ...inspect(pg.name, '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}} {{end}}{{end}}')
        .split(" ")
        .filter(Boolean),
    );
    expect(volumes).not.toHaveLength(0);
    expect(pg.sql("postgres", "SELECT 1")).toBe("1");
  });

  test("postgres_helper_reports_init_failure", { timeout: 120_000 }, () => {
    const result = runUntilExit({
      initDir: initDir({ "00-fail.sh": "#!/bin/sh\necho init-script-failed >&2\nexit 3\n" }),
    });
    expect(result.code).not.toBeNull();
    expect(result.code).not.toBe(0);
    expect(result.logs).toContain("init-script-failed");
  });

  test("postgres_helper_leaves_nothing_behind", { timeout: 30_000 }, () => {
    stopAllPostgres();
    for (const name of names) {
      expect(spawnSync("docker", ["inspect", name], { stdio: "ignore" }).status).not.toBe(0);
    }
    for (const volume of volumes) {
      expect(spawnSync("docker", ["volume", "inspect", volume], { stdio: "ignore" }).status).not.toBe(0);
    }
  });
});
