// P1.29n: every image kind's built image has no package manager (architecture record
// 2026-10-07-p129-migrate-image-and-run-only-images, amendment 6, step B; step book record
// 2026-10-07-p129e-p129n-p129p-image-outcome-checks). The recipe rules in images.test.ts are a fast pre-check; this is
// the deciding check on what ships: each image is built, its filesystem exported, and every file or link whose name is
// a package manager's fails, wherever it sits. images.test.ts holds every kind in KIND_BY_FINAL_ENTRY to a test named
// `<kind>_image_has_no_package_manager` here. It builds images, so it lives in an *.image.test.ts file (P1.28r).
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";

const DEPLOYMENT = join(import.meta.dirname, "..");
const REPO = join(DEPLOYMENT, "..");
const json = (file: string): unknown => JSON.parse(readFileSync(join(import.meta.dirname, file), "utf8"));
const lock = json("bases.lock.json") as Record<string, { ref: string; tag: string; digest: string }>;
/** The same lock-entry-to-kind map images.test.ts reads, so every kind it knows is built and checked here. */
const KIND_BY_FINAL_ENTRY = new Map(Object.entries(json("kinds.json") as Record<string, string>));
const dockerfiles = (readdirSync(DEPLOYMENT, { recursive: true }) as string[])
  .filter((file) => /(^|\/)([\w.-]+\.)?Dockerfile$/.test(file) && !file.includes("node_modules"))
  .sort();
const built: string[] = [];

/** The image the final stage builds on, following stage aliases back to a base; undefined with no FROM. */
function finalBase(dockerfile: string): string | undefined {
  const stages = [...dockerfile.matchAll(/^FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?/gim)].map(
    ([, base = "", alias]) => ({ base, alias: alias?.toLowerCase() }),
  );
  let at = stages.length - 1;
  for (;;) {
    const stage = stages[at];
    if (stage === undefined) return undefined;
    const parent = stages.findLastIndex((earlier, index) => index < at && earlier.alias === stage.base.toLowerCase());
    if (parent < 0) return stage.base;
    at = parent;
  }
}

/** A Dockerfile's kind, by the lock entry its final stage builds on; undefined when it is on no known kind. */
function kindOf(dockerfile: string): string | undefined {
  const base = finalBase(dockerfile);
  const entry = Object.entries(lock).find(([, b]) => `${b.ref}:${b.tag}@${b.digest}` === base)?.[0];
  return KIND_BY_FINAL_ENTRY.get(entry ?? "");
}

/** The images/ Dockerfiles build from the repository root; any other builds from its own folder. */
const contextOf = (file: string): string => (file.startsWith("images/") ? REPO : join(DEPLOYMENT, dirname(file)));

function docker(args: readonly string[]): { code: number; out: string; err: string } {
  const result = spawnSync("docker", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { code: result.status ?? -1, out: result.stdout ?? "", err: result.stderr ?? String(result.error ?? "") };
}

/** Builds a Dockerfile with its context; the image id. A failed build fails the test, so no kind passes unbuilt. */
function build(dockerfile: string, context: string): string {
  const result = docker(["build", "-q", "-f", dockerfile, context]);
  if (result.code !== 0) throw new Error(`${dockerfile} build failed: ${result.err.slice(-2000)}`);
  built.push(result.out.trim());
  return result.out.trim();
}

/** An image's whole filesystem: its `tar -tv` listing, and a file's text by absolute path ("" when absent). */
type Filesystem = { lines: string[]; text: (path: string) => string };

/** Exports an image's filesystem from a container that never starts, and hands it to `use`. */
function inspect<T>(image: string, use: (filesystem: Filesystem) => T): T {
  const created = docker(["create", image]);
  if (created.code !== 0) throw new Error(`docker create failed: ${created.err.slice(-2000)}`);
  const container = created.out.trim();
  const dir = mkdtempSync(join(tmpdir(), "image-fs-"));
  const tar = join(dir, "fs.tar");
  try {
    const exported = docker(["export", "-o", tar, container]);
    if (exported.code !== 0) throw new Error(`docker export failed: ${exported.err.slice(-2000)}`);
    const listed = spawnSync("tar", ["-tvf", tar], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    if (listed.status !== 0) throw new Error(`tar failed: ${listed.stderr.slice(-2000)}`);
    const text = (path: string): string =>
      spawnSync("tar", ["-xOf", tar, path.slice(1)], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).stdout ?? "";
    return use({ lines: listed.stdout.split("\n").filter((line) => line !== ""), text });
  } finally {
    docker(["rm", "-f", container]);
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A listing line's mode and absolute path. */
const entry = (line: string): { mode: string; path: string } => ({
  mode: line.slice(0, 10),
  path: (/ (\S+?)(?: -> \S+)?$/.exec(line)?.[1] ?? "").replace(/^\.?\/?/, "/").replace(/\/$/, ""),
});

/**
 * Every file or link in a listing whose name is a package manager's or its library's, wherever it sits; directories
 * are left out (architecture note under amendment 7: an empty directory runs nothing).
 */
function packageManagers(lines: readonly string[]): string[] {
  return lines
    .map(entry)
    .filter(({ mode, path }) => !mode.startsWith("d") && PACKAGE_MANAGER.test(path.slice(path.lastIndexOf("/") + 1)))
    .map(({ path }) => path);
}

/**
 * The names a package manager or its library ships under, for every kind (architecture note under amendment 7, after
 * #535): Alpine's apk and libapk, Debian's apt, libapt and dpkg, and the RPM family.
 */
const PACKAGE_MANAGER =
  /^(?:apk|apk\.static|apk-.+|libapk.*|apt|apt-get|apt-.+|libapt.*|dpkg|dpkg-.+|rpm|yum|dnf|microdnf)$/;

/**
 * Each kind's package database, kept so image scanners still see its OS packages (third architecture note under
 * amendment 7): only the exact data files listed, none executable, so no maintainer script survives, and an index that
 * still names at least one package. Paths are relative to the root; each list entry is cited in the PR body.
 */
const DATABASE_BY_KIND = new Map([
  [
    "node",
    {
      root: "/var/lib/dpkg",
      data: /^(?:status|status-old|arch-native|available|cmethopt|diversions|diversions-old|lock|lock-frontend|info\/format|info\/[^/]+\.(?:list|md5sums|conffiles|shlibs|symbols|templates|triggers)|alternatives\/[^/]+|triggers\/[^/]+)$/,
      index: "status",
      names: /^Package: /m,
    },
  ],
  [
    "edge",
    { root: "/lib/apk/db", data: /^(?:installed|lock|triggers|scripts\.tar\.gz)$/, index: "installed", names: /^P:/m },
  ],
]);

/** Every way a kind's package database holds more than inert data, or no longer names a package. */
function databaseProblems(kind: string, filesystem: Filesystem): string[] {
  const database = DATABASE_BY_KIND.get(kind);
  if (database === undefined) return [`the ${kind} kind has no package-database list`];
  const problems = filesystem.lines
    .map(entry)
    .filter(({ mode, path }) => !mode.startsWith("d") && path.startsWith(`${database.root}/`))
    .flatMap(({ mode, path }) => {
      const relative = path.slice(database.root.length + 1);
      if (!mode.startsWith("-") || !database.data.test(relative)) return [`${path} is not on the ${kind} list`];
      return mode.includes("x") ? [`${path} is executable`] : [];
    });
  const index = `${database.root}/${database.index}`;
  return database.names.test(filesystem.text(index)) ? problems : [...problems, `${index} names no package`];
}

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
      "-rw-r--r-- 0/0        1000 2026-10-07 00:00 usr/lib/x86_64-linux-gnu/libapt-pkg.so.7.0.0",
      "-rwxr-xr-x 0/0        1000 2026-10-07 00:00 opt/tools/apk.static",
      "-rwxr-xr-x 0/0        1000 2026-10-07 00:00 usr/lib/libapk.so.2.14.0",
      "-rwxr-xr-x 0/0        1000 2026-10-07 00:00 usr/bin/microdnf",
      "drwxr-xr-x 0/0           0 2026-10-07 00:00 etc/apk/",
    ];
    expect(packageManagers(lines)).toEqual([
      "/usr/bin/apt-get",
      "/usr/share/doc/dpkg-dev",
      "/usr/sbin/dpkg-reconfigure",
      "/opt/x/dpkg",
      "/usr/lib/x86_64-linux-gnu/libapt-pkg.so.7.0.0",
      "/opt/tools/apk.static",
      "/usr/lib/libapk.so.2.14.0",
      "/usr/bin/microdnf",
    ]);
  });

  test("package_database_reader", () => {
    const line = (mode: string, path: string): string => `${mode} 0/0 10 2026-10-07 00:00 ${path}`;
    const dpkg = [
      line("drwxr-xr-x", "var/lib/dpkg/"),
      line("-rw-r--r--", "var/lib/dpkg/status"),
      line("-rw-r--r--", "var/lib/dpkg/info/tar.list"),
      line("-rwxr-xr-x", "var/lib/dpkg/info/tar.postinst"),
      line("-rwxr-xr-x", "var/lib/dpkg/info/tar.md5sums"),
      line("lrwxrwxrwx", "var/lib/dpkg/alternatives/x -> /tmp/x"),
      line("-rw-r--r--", "var/lib/dpkg/info/tzdata.config"),
    ];
    const status = (text: string): Filesystem => ({ lines: dpkg, text: () => text });
    expect(databaseProblems("node", status("Package: tar\n"))).toEqual([
      "/var/lib/dpkg/info/tar.postinst is not on the node list",
      "/var/lib/dpkg/info/tar.md5sums is executable",
      "/var/lib/dpkg/alternatives/x is not on the node list",
      "/var/lib/dpkg/info/tzdata.config is not on the node list",
    ]);
    expect(databaseProblems("node", { lines: dpkg.slice(0, 3), text: () => "" })).toEqual([
      "/var/lib/dpkg/status names no package",
    ]);
    const apk = [line("-rw-r--r--", "lib/apk/db/installed"), line("-rw-r--r--", "lib/apk/db/scripts.tar.gz")];
    expect(databaseProblems("edge", { lines: apk, text: () => "C:x\nP:musl\n" })).toEqual([]);
    expect(databaseProblems("edge", { lines: [...apk, line("-rw-r--r--", "lib/apk/db/x")], text: () => "" })).toEqual([
      "/lib/apk/db/x is not on the edge list",
      "/lib/apk/db/installed names no package",
    ]);
    expect(databaseProblems("postgres", { lines: [], text: () => "" })).toEqual([
      "the postgres kind has no package-database list",
    ]);
  });

  test("every_dockerfile_builds_a_known_kind", () => {
    expect(dockerfiles.filter((file) => kindOf(readFileSync(join(DEPLOYMENT, file), "utf8")) === undefined)).toEqual(
      [],
    );
  });

  // Architecture notes under amendment 7: the kind map itself is iterated, a kind with no Dockerfile fails, and a
  // failed build fails, so no kind passes by being skipped.
  for (const kind of new Set(KIND_BY_FINAL_ENTRY.values())) {
    test(`${kind}_image_has_no_package_manager`, () => {
      const files = dockerfiles.filter((file) => kindOf(readFileSync(join(DEPLOYMENT, file), "utf8")) === kind);
      expect(files, `the ${kind} kind has no Dockerfile`).not.toEqual([]);
      for (const file of files) {
        const image = build(join(DEPLOYMENT, file), contextOf(file));
        inspect(image, (filesystem) => {
          expect(packageManagers(filesystem.lines), file).toEqual([]);
          expect(databaseProblems(kind, filesystem), file).toEqual([]);
        });
      }
    }, 1_200_000);
  }
});
