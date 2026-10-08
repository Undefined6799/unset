// P1.29n: every image kind's built image has no package manager (architecture record
// 2026-10-07-p129-migrate-image-and-run-only-images, amendment 6, step B; step book record
// 2026-10-07-p129e-p129n-p129p-image-outcome-checks). The recipe rules in images.test.ts are a fast pre-check; this is
// the deciding check on what ships: each image is built, its filesystem exported, and every file or link whose name is
// a package manager's fails, wherever it sits. One `<kind>_image_has_no_package_manager` test runs for each kind in
// kinds.json (P1.29m), so no kind goes unchecked. It builds images, so it lives in an *.image.test.ts file (P1.28r).
import { spawnSync } from "node:child_process";
import { linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

/** One archive member: the mode `tar -tv` prints for it, and its absolute path. */
type Entry = { mode: string; path: string };
/** An image's whole filesystem: every member, and a file's text by absolute path ("" when absent). */
type Filesystem = { entries: Entry[]; text: (path: string) => string };

/** GNU tar's escape quoting, asked for by name: C escapes for control characters, a backslash doubled, octal bytes. */
const TAR_ESCAPES = new Map([
  ["a", 7],
  ["b", 8],
  ["f", 12],
  ["n", 10],
  ["r", 13],
  ["t", 9],
  ["v", 11],
  ["\\", 92],
]);

/** A member name as `tar --quoting-style=escape` prints it, decoded to the name itself; an unknown escape throws. */
function memberName(quoted: string): string {
  const bytes = quoted.split(/(\\[0-7]{3}|\\[\s\S]?)/).map((part) => {
    if (!part.startsWith("\\")) return Buffer.from(part, "utf8");
    const octal = /^\\([0-7]{3})$/.exec(part)?.[1];
    const byte = octal === undefined ? TAR_ESCAPES.get(part.slice(1)) : Number.parseInt(octal, 8);
    if (byte === undefined) throw new Error(`tar member ${quoted} has an unknown escape ${part}`);
    return Buffer.from([byte]);
  });
  return Buffer.concat(bytes).toString("utf8");
}

/**
 * Every member of a listing, its mode from the `tar -tv` line and its name from the `tar -tf` line at the same index
 * (P1.29g): a hard link's verbose line ends in its target, and a name may hold spaces, so no name is cut from a verbose
 * line. Fails closed when the lists differ in length, a verbose line does not hold its name, or a name holds a newline.
 */
function listing(verbose: string, names: string): Entry[] {
  const lines = verbose.split("\n").filter((line) => line !== "");
  const quoted = names.split("\n").filter((line) => line !== "");
  if (lines.length !== quoted.length) throw new Error(`tar listed ${lines.length} modes but ${quoted.length} names`);
  return quoted.map((name, at) => {
    const line = lines[at] ?? "";
    if (!line.includes(` ${name}`)) throw new Error(`tar line ${at + 1} does not list ${name}`);
    const path = memberName(name);
    if (path.includes("\n")) throw new Error(`tar member ${name} has a newline in its name`);
    return { mode: line.slice(0, 10), path: path.replace(/^\.?\/?/, "/").replace(/\/$/, "") };
  });
}

/** An exported image's tar file as a filesystem; tar is GNU tar, whose listings quote names by `--quoting-style`. */
function readTar(tar: string): Filesystem {
  const list = (flags: string): string => {
    const listed = spawnSync("tar", [flags, "--quoting-style=escape", "-f", tar], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
    if (listed.status !== 0) throw new Error(`tar failed: ${listed.stderr.slice(-2000)}`);
    return listed.stdout;
  };
  const text = (path: string): string =>
    spawnSync("tar", ["-xOf", tar, path.slice(1)], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).stdout ?? "";
  return { entries: listing(list("-tv"), list("-t")), text };
}

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
    return use(readTar(tar));
  } finally {
    docker(["rm", "-f", container]);
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Every file or link in a listing whose name is a package manager's or its library's, wherever it sits; directories
 * are left out (architecture note under amendment 7: an empty directory runs nothing).
 */
function packageManagers(entries: readonly Entry[]): string[] {
  return entries
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
  const problems = filesystem.entries
    .filter(({ mode, path }) => !mode.startsWith("d") && path.startsWith(`${database.root}/`))
    .flatMap(({ mode, path }) => {
      const relative = path.slice(database.root.length + 1);
      if (!mode.startsWith("-") || !database.data.test(relative)) return [`${path} is not on the ${kind} list`];
      // P1.29g: no execute bit, and no setuid, setgid or sticky bit, which tar prints as s, S, t or T.
      return /[xsStT]/.test(mode.slice(1)) ? [`${path} has an execute or special mode bit`] : [];
    });
  const index = `${database.root}/${database.index}`;
  return database.names.test(filesystem.text(index)) ? problems : [...problems, `${index} names no package`];
}

/**
 * Every problem with one kind: it has no Dockerfile, or a Dockerfile fails `check`, a build failure included. Each
 * problem is a finding, so no kind passes by being skipped (second architecture note under amendment 7).
 */
function kindProblems(kind: string, files: readonly string[], check: (file: string) => string[]): string[] {
  if (files.length === 0) return [`the ${kind} kind has no Dockerfile`];
  return files.flatMap((file) => {
    try {
      return check(file).map((problem) => `${file}: ${problem}`);
    } catch (error) {
      return [`${file}: ${error instanceof Error ? error.message : String(error)}`];
    }
  });
}

/** Builds one Dockerfile and lists its package managers and package-database problems. */
function imageProblems(kind: string, file: string): string[] {
  const image = build(join(DEPLOYMENT, file), contextOf(file));
  return inspect(image, (filesystem) => [
    ...packageManagers(filesystem.entries).map((path) => `${path} is a package manager`),
    ...databaseProblems(kind, filesystem),
  ]);
}

describe("image package managers", () => {
  afterAll(() => {
    for (const image of built) docker(["rmi", "-f", image]);
  });

  /** A listing as tar prints it, from [mode, quoted name, verbose suffix] rows: `-tv` lines and `-tf` names. */
  const tarListing = (rows: readonly (readonly [string, string, string?])[]): [string, string] => [
    rows.map(([mode, name, suffix = ""]) => `${mode} 0/0 10 2026-10-07 00:00 ${name}${suffix}\n`).join(""),
    rows.map(([, name]) => `${name}\n`).join(""),
  ];

  test("package_manager_listing_reader", () => {
    const entries = listing(
      ...tarListing([
        ["-rwxr-xr-x", "usr/bin/apt-get"],
        ["-rw-r--r--", "usr/share/doc/dpkg-dev"],
        ["lrwxrwxrwx", "usr/sbin/dpkg-reconfigure", " -> ../share/debconf/x"],
        ["drwxr-xr-x", "etc/apt/"],
        ["-rwxr-xr-x", "./opt/x/dpkg"],
        ["-rwxr-xr-x", "usr/bin/node"],
        ["-rw-r--r--", "usr/lib/x86_64-linux-gnu/libapt-pkg.so.7.0.0"],
        ["-rwxr-xr-x", "opt/tools/apk.static"],
        ["-rwxr-xr-x", "usr/lib/libapk.so.2.14.0"],
        ["-rwxr-xr-x", "usr/bin/microdnf"],
        ["drwxr-xr-x", "etc/apk/"],
        // P1.29g: a hard link's verbose line ends in its target, so the name comes from the name list.
        ["hrwxr-xr-x", "usr/bin/dpkg", " link to usr/bin/node"],
        ["hrwxr-xr-x", "usr/bin/x", " link to usr/bin/apt"],
        // Names with spaces are read whole, and a symlink's target with a space is no name.
        ["-rwxr-xr-x", "opt/a b/apt"],
        ["lrwxrwxrwx", "usr/bin/y", " -> /opt/a b/rpm"],
      ]),
    );
    expect(packageManagers(entries)).toEqual([
      "/usr/bin/apt-get",
      "/usr/share/doc/dpkg-dev",
      "/usr/sbin/dpkg-reconfigure",
      "/opt/x/dpkg",
      "/usr/lib/x86_64-linux-gnu/libapt-pkg.so.7.0.0",
      "/opt/tools/apk.static",
      "/usr/lib/libapk.so.2.14.0",
      "/usr/bin/microdnf",
      "/usr/bin/dpkg",
      "/opt/a b/apt",
    ]);
  });

  test("listing_reader_fails_closed", () => {
    const [verbose, names] = tarListing([
      ["-rw-r--r--", "usr/bin/a"],
      ["-rw-r--r--", "usr/bin/b"],
    ]);
    // P1.29g: the two lists must pair one to one, line for line.
    expect(() => listing(verbose, "usr/bin/a\n")).toThrow("tar listed 2 modes but 1 names");
    expect(() => listing(verbose, "usr/bin/b\nusr/bin/a\n")).toThrow("does not list usr/bin/b");
    expect(listing(verbose, names).map(({ path }) => path)).toEqual(["/usr/bin/a", "/usr/bin/b"]);
    // GNU tar's escape quoting: octal bytes decode as UTF-8, a backslash is doubled, and a newline fails closed.
    expect(listing(...tarListing([["-rw-r--r--", "opt/\\303\\251\\\\x"]]))).toEqual([
      { mode: "-rw-r--r--", path: "/opt/\u00e9\\x" },
    ]);
    expect(() => listing(...tarListing([["-rw-r--r--", "usr/bin/n\\nl"]]))).toThrow("has a newline in its name");
    expect(() => listing(...tarListing([["-rw-r--r--", "usr/bin/n\\q"]]))).toThrow("unknown escape");
  });

  test("tar_reader_on_a_real_archive", () => {
    const dir = mkdtempSync(join(tmpdir(), "image-tar-"));
    const tar = (args: readonly string[]): void => {
      const result = spawnSync("tar", args, { cwd: join(dir, "root"), encoding: "utf8" });
      if (result.status !== 0) throw new Error(`tar failed: ${result.stderr}`);
    };
    try {
      const info = join(dir, "root", "var", "lib", "dpkg", "info");
      mkdirSync(info, { recursive: true });
      mkdirSync(join(dir, "root", "usr", "bin"), { recursive: true });
      writeFileSync(join(dir, "root", "x"), "x", { mode: 0o755 });
      linkSync(join(dir, "root", "x"), join(dir, "root", "usr", "bin", "dpkg"));
      writeFileSync(join(info, "a b.list"), "y", { mode: 0o755 });
      linkSync(join(info, "a b.list"), join(info, "x.postinst"));
      writeFileSync(join(dir, "root", "var", "lib", "dpkg", "status"), "Package: x\n");
      // Explicit order, so each hard link is archived as the link and not as the file it points to.
      tar([
        "-cf",
        join(dir, "fs.tar"),
        "x",
        "usr/bin/dpkg",
        "var/lib/dpkg/status",
        "var/lib/dpkg/info/a b.list",
        "var/lib/dpkg/info/x.postinst",
      ]);
      const filesystem = readTar(join(dir, "fs.tar"));
      expect(packageManagers(filesystem.entries)).toEqual(["/usr/bin/dpkg"]);
      expect(databaseProblems("node", filesystem)).toEqual([
        "/var/lib/dpkg/info/a b.list has an execute or special mode bit",
        "/var/lib/dpkg/info/x.postinst is not on the node list",
      ]);
      writeFileSync(join(dir, "root", "n\nl"), "z");
      tar(["-cf", join(dir, "newline.tar"), "n\nl"]);
      expect(() => readTar(join(dir, "newline.tar"))).toThrow("has a newline in its name");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("package_database_reader", () => {
    const line = (mode: string, path: string): readonly [string, string, string?] => {
      const [name = "", target] = path.split(" -> ");
      return target === undefined ? [mode, name] : [mode, name, ` -> ${target}`];
    };
    const files = (rows: readonly (readonly [string, string, string?])[]): Entry[] => listing(...tarListing(rows));
    const dpkg = [
      line("drwxr-xr-x", "var/lib/dpkg/"),
      line("-rw-r--r--", "var/lib/dpkg/status"),
      line("-rw-r--r--", "var/lib/dpkg/info/tar.list"),
      line("-rwxr-xr-x", "var/lib/dpkg/info/tar.postinst"),
      line("-rwxr-xr-x", "var/lib/dpkg/info/tar.md5sums"),
      line("lrwxrwxrwx", "var/lib/dpkg/alternatives/x -> /tmp/x"),
      line("-rw-r--r--", "var/lib/dpkg/info/tzdata.config"),
    ];
    const status = (text: string): Filesystem => ({ entries: files(dpkg), text: () => text });
    expect(databaseProblems("node", status("Package: tar\n"))).toEqual([
      "/var/lib/dpkg/info/tar.postinst is not on the node list",
      "/var/lib/dpkg/info/tar.md5sums has an execute or special mode bit",
      "/var/lib/dpkg/alternatives/x is not on the node list",
      "/var/lib/dpkg/info/tzdata.config is not on the node list",
    ]);
    expect(databaseProblems("node", { entries: files(dpkg.slice(0, 3)), text: () => "" })).toEqual([
      "/var/lib/dpkg/status names no package",
    ]);
    const apk = [line("-rw-r--r--", "lib/apk/db/installed"), line("-rw-r--r--", "lib/apk/db/scripts.tar.gz")];
    expect(databaseProblems("edge", { entries: files(apk), text: () => "C:x\nP:musl\n" })).toEqual([]);
    expect(
      databaseProblems("edge", { entries: files([...apk, line("-rw-r--r--", "lib/apk/db/x")]), text: () => "" }),
    ).toEqual(["/lib/apk/db/x is not on the edge list", "/lib/apk/db/installed names no package"]);
    // P1.29g: inert data carries no execute, setuid, setgid or sticky bit, whichever letter tar prints for it.
    for (const mode of [
      "-rwxr-xr-x",
      "-rwsr--r--",
      "-rwSr--r--",
      "-rw-r-sr--",
      "-rw-r-Sr--",
      "-rw-r--r-t",
      "-rw-r--r-T",
    ]) {
      const special = [...apk, line(mode, "lib/apk/db/triggers")];
      expect(databaseProblems("edge", { entries: files(special), text: () => "P:musl\n" }), mode).toEqual([
        "/lib/apk/db/triggers has an execute or special mode bit",
      ]);
    }
    // A hard link in the database is no plain data file, whatever it links to.
    const linked = [...apk, ["hrw-r--r--", "lib/apk/db/triggers", " link to lib/apk/db/installed"] as const];
    expect(databaseProblems("edge", { entries: files(linked), text: () => "P:musl\n" })).toEqual([
      "/lib/apk/db/triggers is not on the edge list",
    ]);
    expect(databaseProblems("postgres", { entries: [], text: () => "" })).toEqual([
      "the postgres kind has no package-database list",
    ]);
  });

  test("kind_problems_reader", () => {
    expect(kindProblems("postgres", [], () => [])).toEqual(["the postgres kind has no Dockerfile"]);
    expect(
      kindProblems("node", ["a", "b"], (file) => (file === "b" ? ["/usr/bin/apt is a package manager"] : [])),
    ).toEqual(["b: /usr/bin/apt is a package manager"]);
    // A Dockerfile that fails to build is a finding, not a skip.
    const dir = mkdtempSync(join(tmpdir(), "image-broken-"));
    try {
      writeFileSync(join(dir, "Dockerfile"), "FROM scratch\nRUN false\n");
      const problems = kindProblems("node", [join(dir, "Dockerfile")], (file) => [build(file, dir)]);
      expect(problems).toEqual([expect.stringContaining("build failed")]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
      expect(kindProblems(kind, files, (file) => imageProblems(kind, file))).toEqual([]);
    }, 1_200_000);
  }
});
