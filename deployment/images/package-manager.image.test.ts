// P1.29n: every image kind's built image has no package manager (architecture record
// 2026-10-07-p129-migrate-image-and-run-only-images, amendment 6, step B; step book record
// 2026-10-07-p129e-p129n-p129p-image-outcome-checks). The recipe rules in images.test.ts are a fast pre-check; this is
// the deciding check on what ships: each image is built, its filesystem exported, and every file or link whose name is
// a package manager's fails, wherever it sits. images.test.ts holds every kind in KIND_BY_FINAL_ENTRY to a test named
// `<kind>_image_has_no_package_manager` here. It builds images, so it lives in an *.image.test.ts file (P1.28r).
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";

const DEPLOYMENT = join(import.meta.dirname, "..");
const built: string[] = [];

function docker(args: readonly string[]): { code: number; out: string; err: string } {
  const result = spawnSync("docker", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { code: result.status ?? -1, out: result.stdout ?? "", err: result.stderr ?? String(result.error ?? "") };
}

/** Builds a Dockerfile with its context; the image id. */
function build(dockerfile: string, context: string): string {
  const result = docker(["build", "-q", "-f", dockerfile, context]);
  if (result.code !== 0) throw new Error(`${dockerfile} build failed: ${result.err.slice(-2000)}`);
  built.push(result.out.trim());
  return result.out.trim();
}

/** The `tar -tv` listing of an image's whole filesystem, exported from a container that never starts. */
function listing(image: string): string[] {
  const created = docker(["create", image]);
  if (created.code !== 0) throw new Error(`docker create failed: ${created.err.slice(-2000)}`);
  const container = created.out.trim();
  const dir = mkdtempSync(join(tmpdir(), "image-fs-"));
  try {
    const exported = docker(["export", "-o", join(dir, "fs.tar"), container]);
    if (exported.code !== 0) throw new Error(`docker export failed: ${exported.err.slice(-2000)}`);
    const listed = spawnSync("tar", ["-tvf", join(dir, "fs.tar")], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    if (listed.status !== 0) throw new Error(`tar failed: ${listed.stderr.slice(-2000)}`);
    return listed.stdout.split("\n").filter((line) => line !== "");
  } finally {
    docker(["rm", "-f", container]);
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Every executable file or link in a listing whose name is a package manager's. A `tar -tv` line starts with the mode
 * (`-rwxr-xr-x`, `lrwxrwxrwx`) and ends with the path, then ` -> target` for a link.
 */
function packageManagers(lines: readonly string[], name: RegExp): string[] {
  return lines.flatMap((line) => {
    const mode = line.slice(0, 10);
    const path = (/ (\S+?)(?: -> \S+)?$/.exec(line)?.[1] ?? "").replace(/^\.?\/?/, "/");
    const executable = mode.startsWith("l") || (mode.startsWith("-") && mode.includes("x"));
    return executable && name.test(path.slice(path.lastIndexOf("/") + 1)) ? [path] : [];
  });
}

const DEBIAN = /^(?:apt|apt-get|dpkg|dpkg-.+)$/;
const ALPINE = /^(?:apk|apk-.+)$/;

describe("image package managers", () => {
  afterAll(() => {
    for (const image of built) docker(["rmi", "-f", image]);
  });

  test("package_manager_listing_reader", () => {
    const lines = [
      "-rwxr-xr-x 0/0        1000 2026-10-07 00:00 usr/bin/apt-get",
      "-rw-r--r-- 0/0          10 2026-10-07 00:00 usr/share/doc/dpkg-dev",
      "lrwxrwxrwx 0/0           0 2026-10-07 00:00 usr/sbin/dpkg-reconfigure -> ../share/debconf/x",
      "drwxr-xr-x 0/0           0 2026-10-07 00:00 etc/apt/",
      "-rwxr-xr-x 0/0        1000 2026-10-07 00:00 ./opt/x/dpkg",
      "-rwxr-xr-x 0/0        1000 2026-10-07 00:00 usr/bin/node",
    ];
    expect(packageManagers(lines, DEBIAN)).toEqual(["/usr/bin/apt-get", "/usr/sbin/dpkg-reconfigure", "/opt/x/dpkg"]);
  });

  test("node_image_has_no_package_manager", () => {
    // The web and migrate images both build on the node kind's runtime entry.
    for (const dockerfile of ["images/node-app.Dockerfile", "images/migrate.Dockerfile"]) {
      const image = build(join(DEPLOYMENT, dockerfile), join(DEPLOYMENT, ".."));
      expect(packageManagers(listing(image), DEBIAN), dockerfile).toEqual([]);
    }
  }, 1_200_000);

  test("edge_image_has_no_package_manager", () => {
    const image = build(join(DEPLOYMENT, "edge/Dockerfile"), join(DEPLOYMENT, "edge"));
    expect(packageManagers(listing(image), ALPINE)).toEqual([]);
  }, 600_000);
});
