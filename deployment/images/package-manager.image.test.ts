// P1.29n: every image kind's built image has no package manager (architecture record
// 2026-10-07-p129-migrate-image-and-run-only-images, amendment 6, step B; step book record
// 2026-10-07-p129e-p129n-p129p-image-outcome-checks). The recipe rules in images.test.ts are a fast pre-check; this is
// the deciding check on what ships: each image is built, its filesystem exported, and every file or link whose name is
// a package manager's fails, wherever it sits. One `<kind>_image_has_no_package_manager` test runs for each kind in
// kinds.json (P1.29m), so no kind goes unchecked. It builds images, so it lives in an *.image.test.ts file (P1.28r).
// P1.29p: the same exported filesystem pins each kind's privileges. Every setuid or setgid file and every extended
// attribute (a file capability is `security.capability`) is on the kind's exact list, and a kind with no list fails.
import { spawnSync } from "node:child_process";
import {
  closeSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
const built = new Map<string, string>();

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

/**
 * Builds a Dockerfile with its context once per run; the image id. A failed build fails the test, so no kind passes
 * unbuilt.
 */
function build(dockerfile: string, context: string): string {
  const key = `${dockerfile}\0${context}`;
  const cached = built.get(key);
  if (cached !== undefined) return cached;
  const result = docker(["build", "-q", "-f", dockerfile, context]);
  if (result.code !== 0) throw new Error(`${dockerfile} build failed: ${result.err.slice(-2000)}`);
  built.set(key, result.out.trim());
  return result.out.trim();
}

/**
 * One archive member: the mode `tar -tv` prints for it, its absolute path, and its extended attributes, each as
 * `<name>` from a listing and `<name>=<hex value>` once readTar has read the values.
 */
type Entry = { mode: string; path: string; xattrs: string[] };
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

/** A member name as an absolute path: `./a/`, `/a` and `a` are all `/a`. */
const absolute = (name: string): string => name.replace(/^\.?\/?/, "/").replace(/\/$/, "");

/** The line GNU tar 1.35 prints under a member for each extended attribute with `-tvv --xattrs`: `  x: <size> <name>`. */
const XATTR_LINE = /^ {2}x: \d+ (\S+)$/;

/**
 * Every member of a listing, its mode from the `tar -tv` line and its name from the `tar -tf` line at the same index
 * (P1.29g): a hard link's verbose line ends in its target, and a name may hold spaces, so no name is cut from a verbose
 * line. An attribute line belongs to the member above it (P1.29p). Fails closed when the lists differ in length, a
 * verbose line does not hold its name, a name holds a newline, or an indented line is no attribute line.
 */
function listing(verbose: string, names: string): Entry[] {
  const members: { line: string; xattrs: string[] }[] = [];
  for (const line of verbose.split("\n").filter((text) => text !== "")) {
    if (!/^\s/.test(line)) {
      members.push({ line, xattrs: [] });
      continue;
    }
    const xattr = XATTR_LINE.exec(line)?.[1];
    const member = members.at(-1);
    if (xattr === undefined || member === undefined) throw new Error(`tar printed ${line.trim()} outside a member`);
    member.xattrs.push(xattr);
  }
  const quoted = names.split("\n").filter((line) => line !== "");
  if (members.length !== quoted.length)
    throw new Error(`tar listed ${members.length} modes but ${quoted.length} names`);
  return quoted.map((name, at) => {
    const { line, xattrs } = members[at] ?? { line: "", xattrs: [] };
    if (!line.includes(` ${name}`)) throw new Error(`tar line ${at + 1} does not list ${name}`);
    const path = memberName(name);
    if (path.includes("\n")) throw new Error(`tar member ${name} has a newline in its name`);
    return { mode: line.slice(0, 10), path: absolute(path), xattrs };
  });
}

/** A PAX extended header's records, `<length> <key>=<value>\n` each (POSIX.1-2008 pax, "pax Extended Header"). */
function paxRecords(data: Buffer): Map<string, Buffer> {
  const records = new Map<string, Buffer>();
  for (let at = 0; at < data.length; ) {
    const space = data.indexOf(0x20, at);
    const length = Number(data.subarray(at, Math.max(space, at)).toString("latin1"));
    const end = at + length;
    const equals = data.indexOf(0x3d, space);
    if (space < 0 || !Number.isSafeInteger(length) || equals < 0 || equals >= end || data[end - 1] !== 0x0a) {
      throw new Error(`tar has a malformed PAX record at byte ${at}`);
    }
    records.set(data.subarray(space + 1, equals).toString("utf8"), data.subarray(equals + 1, end - 1));
    at = end;
  }
  return records;
}

/** A NUL-terminated ustar header field as text. */
const field = (header: Buffer, at: number, length: number): string =>
  header
    .subarray(at, at + length)
    .toString("utf8")
    .split("\0")[0] ?? "";

/** A header's type and its data's size, which a PAX `size` record overrides; an unread type or a bad size throws. */
function headerFields(header: Buffer, pax: Map<string, Buffer>, at: number): { type: string; size: number } {
  const type = String.fromCharCode(header[156] ?? 0);
  const size = Number(pax.get("size")?.toString("latin1") ?? Number.parseInt(field(header, 124, 12), 8));
  if (!Number.isSafeInteger(size) || size < 0) throw new Error(`tar header at byte ${at} has no size`);
  if (!/^[0-7x\0]$/.test(type)) throw new Error(`tar header at byte ${at} has type ${type}`);
  return { type, size };
}

/**
 * Every member header of a tar file, as its name and the PAX records written before it (Docker's export is Go
 * archive/tar's PAX format). Fails closed on a header this reader does not read: a GNU long name or a global PAX header.
 */
function* paxMembers(tar: string): Generator<{ name: string; pax: Map<string, Buffer> }> {
  const fd = openSync(tar, "r");
  try {
    const header = Buffer.alloc(512);
    let pax = new Map<string, Buffer>();
    for (let at = 0; readSync(fd, header, 0, 512, at) === 512 && header.some((byte) => byte !== 0); ) {
      const { type, size } = headerFields(header, pax, at);
      const data = Buffer.alloc(type === "x" ? size : 0);
      readSync(fd, data, 0, data.length, at + 512);
      at += 512 + Math.ceil(size / 512) * 512;
      if (type === "x") pax = paxRecords(data);
      else {
        const prefix = field(header, 345, 155);
        yield { name: pax.get("path")?.toString("utf8") ?? `${prefix && `${prefix}/`}${field(header, 0, 100)}`, pax };
        pax = new Map();
      }
    }
  } finally {
    closeSync(fd);
  }
}

/**
 * Every extended attribute's value in a tar file, as hex by path and name: each is a PAX record `SCHILY.xattr.<name>`
 * before its member, which `tar -tvv --xattrs` names but never prints.
 */
function xattrValues(tar: string): Map<string, Map<string, string>> {
  const values = new Map<string, Map<string, string>>();
  for (const { name, pax } of paxMembers(tar)) {
    for (const [key, value] of pax) {
      if (!key.startsWith("SCHILY.xattr.")) continue;
      const path = absolute(name);
      values.set(path, (values.get(path) ?? new Map()).set(key.slice("SCHILY.xattr.".length), value.toString("hex")));
    }
  }
  return values;
}

/**
 * A listing's entries with each attribute's value from the PAX headers, as `<name>=<hex>`. Two readers, one archive:
 * GNU tar names each attribute and the PAX headers hold its value, and they must agree member by member.
 */
function withValues(entries: readonly Entry[], values: ReadonlyMap<string, ReadonlyMap<string, string>>): Entry[] {
  const valued = entries.map((entry) => {
    const own = values.get(entry.path);
    const xattrs = entry.xattrs.map((name) => {
      const value = own?.get(name);
      if (value === undefined) throw new Error(`tar lists ${name} on ${entry.path} but no PAX header holds it`);
      return `${name}=${value}`;
    });
    if (xattrs.length !== (own?.size ?? 0)) throw new Error(`tar and the PAX headers disagree on ${entry.path}`);
    return { ...entry, xattrs };
  });
  const unlisted = [...values.keys()].find((path) => !entries.some((entry) => entry.path === path));
  if (unlisted !== undefined) throw new Error(`a PAX header gives ${unlisted} attributes but tar lists no such member`);
  return valued;
}

/**
 * An exported image's tar file as a filesystem; tar is GNU tar, whose listings quote names by `--quoting-style` and
 * print every extended attribute with `-tvv --xattrs --xattrs-include=*` (GNU tar 1.35 manual, "Extended File
 * Attributes"), so no attribute is filtered out before the privilege check reads it.
 */
function readTar(tar: string): Filesystem {
  const list = (flags: readonly string[]): string => {
    const listed = spawnSync("tar", [...flags, "--quoting-style=escape", "-f", tar], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
    if (listed.status !== 0) throw new Error(`tar failed: ${listed.stderr.slice(-2000)}`);
    return listed.stdout;
  };
  const text = (path: string): string =>
    spawnSync("tar", ["-xOf", tar, path.slice(1)], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).stdout ?? "";
  const entries = listing(list(["-tvv", "--xattrs", "--xattrs-include=*"]), list(["-t"]));
  return { entries: withValues(entries, xattrValues(tar)), text };
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
 * Each kind's privileges, exactly (P1.29p, record 2026-10-07-p129e-p129n-p129p-image-outcome-checks): a setuid or
 * setgid file as `<path> setuid` or `<path> setgid`, and every extended attribute as `<path> <name>=<hex value>`. A
 * directory's setgid or sticky bit grants nothing to a process (it sets a new file's group, or who may delete in it),
 * so only its attributes count.
 */
const PRIVILEGES_BY_KIND = new Map<string, readonly string[]>([
  // edge/Dockerfile:26 `setcap cap_net_bind_service=+ep`: VFS_CAP_REVISION_2 with the effective flag, then permitted
  // bit 10 (CAP_NET_BIND_SERVICE) alone, and nothing inheritable (linux/capability.h).
  ["edge", ["/usr/bin/caddy security.capability=0100000200040000000000000000000000000000"]],
  // node-app.Dockerfile and migrate.Dockerfile remove every setuid and setgid file the Debian base ships.
  ["node", []],
]);

/** Every privilege in a listing: setuid and setgid files, and every member's extended attributes. */
function privileges(entries: readonly Entry[]): string[] {
  return entries.flatMap(({ mode, path, xattrs }) => {
    const file = !mode.startsWith("d");
    return [
      ...(file && /[sS]/.test(mode.charAt(3)) ? [`${path} setuid`] : []),
      ...(file && /[sS]/.test(mode.charAt(6)) ? [`${path} setgid`] : []),
      ...xattrs.map((xattr) => `${path} ${xattr}`),
    ];
  });
}

/** Every privilege a kind's image holds off its list, and every listed one it lacks; a kind with no list fails. */
function privilegeProblems(kind: string, entries: readonly Entry[]): string[] {
  const listed = PRIVILEGES_BY_KIND.get(kind);
  if (listed === undefined) return [`the ${kind} kind has no privilege list`];
  const held = privileges(entries);
  return [
    ...held
      .filter((privilege) => !listed.includes(privilege))
      .map((privilege) => `${privilege} is not on the ${kind} list`),
    ...listed
      .filter((privilege) => !held.includes(privilege))
      .map((privilege) => `${privilege} is listed but not held`),
  ];
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

/** Builds one Dockerfile and lists its privilege problems. */
function imagePrivilegeProblems(kind: string, file: string): string[] {
  const image = build(join(DEPLOYMENT, file), contextOf(file));
  return inspect(image, (filesystem) => privilegeProblems(kind, filesystem.entries));
}

describe("image package managers", () => {
  afterAll(() => {
    for (const image of new Set(built.values())) docker(["rmi", "-f", image]);
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
      { mode: "-rw-r--r--", path: "/opt/\u00e9\\x", xattrs: [] },
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

  test("privilege_reader", () => {
    // P1.29p: each `  x:` line names an attribute of the member above it; any other indented line fails closed.
    const [verbose, names] = tarListing([
      ["-rwxr-xr-x", "usr/bin/caddy"],
      ["-rw-r--r--", "etc/x"],
    ]);
    const lines = verbose.split("\n");
    const withXattr = [lines[0], "  x: 20 security.capability", lines[1], ""].join("\n");
    expect(listing(withXattr, names).map(({ xattrs }) => xattrs)).toEqual([["security.capability"], []]);
    expect(() => listing(`  x: 20 security.capability\n${verbose}`, names)).toThrow("outside a member");
    expect(() => listing([lines[0], "  a: user::rwx", lines[1]].join("\n"), names)).toThrow("outside a member");
    expect(() => listing([lines[0], "  x: 2 ", lines[1]].join("\n"), names)).toThrow("outside a member");
    const entry = (mode: string, path: string, xattrs: string[] = []): Entry => ({ mode, path, xattrs });
    const entries = [
      entry("-rwsr-xr-x", "/usr/bin/su"),
      entry("-rwSr--r--", "/usr/bin/a"),
      entry("-rwxr-sr-x", "/usr/bin/chage"),
      entry("hrwsr-sr-x", "/usr/bin/b"),
      entry("drwxrwsr-x", "/var/mail"),
      entry("drwxrwxrwt", "/tmp"),
      entry("-rw-r--r-T", "/etc/t"),
      entry("-rwxr-xr-x", "/usr/bin/caddy", ["security.capability=01"]),
      entry("drwxr-xr-x", "/app", ["user.x=00"]),
    ];
    expect(privileges(entries)).toEqual([
      "/usr/bin/su setuid",
      "/usr/bin/a setuid",
      "/usr/bin/chage setgid",
      "/usr/bin/b setuid",
      "/usr/bin/b setgid",
      "/usr/bin/caddy security.capability=01",
      "/app user.x=00",
    ]);
    const caddy = "/usr/bin/caddy security.capability=0100000200040000000000000000000000000000";
    expect(privilegeProblems("node", entries.slice(0, 1))).toEqual(["/usr/bin/su setuid is not on the node list"]);
    expect(privilegeProblems("edge", entries.slice(7, 8))).toEqual([
      "/usr/bin/caddy security.capability=01 is not on the edge list",
      `${caddy} is listed but not held`,
    ]);
    expect(privilegeProblems("edge", [entry("-rwxr-xr-x", "/usr/bin/caddy", [caddy.split(" ")[1] ?? ""])])).toEqual([]);
    expect(privilegeProblems("postgres", [])).toEqual(["the postgres kind has no privilege list"]);
  });

  test("pax_xattr_reader_on_a_real_archive", () => {
    // A ustar header with its checksum (POSIX.1-2008 pax, "ustar Interchange Format"), then the data padded to 512.
    const block = (name: string, type: string, data: Buffer, mode = "0000755"): Buffer => {
      const header = Buffer.alloc(512);
      header.write(name, 0);
      header.write(`${mode}\0`, 100);
      header.write("0000000\0", 108);
      header.write("0000000\0", 116);
      header.write(`${data.length.toString(8).padStart(11, "0")}\0`, 124);
      header.write("00000000000\0", 136);
      header.write(type, 156);
      header.write("ustar\0" + "00", 257);
      header.write("        ", 148);
      const sum = header.reduce((total, byte) => total + byte, 0);
      header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
      return Buffer.concat([header, data, Buffer.alloc((512 - (data.length % 512)) % 512)]);
    };
    const record = (key: string, value: Buffer): Buffer => {
      const body = Buffer.concat([Buffer.from(` ${key}=`), value, Buffer.from("\n")]);
      let length = body.length + 1;
      while (String(length).length + body.length !== length) length += 1;
      return Buffer.concat([Buffer.from(String(length)), body]);
    };
    const capability = Buffer.from("0100000200040000000000000000000000000000", "hex");
    const pax = block("PaxHeaders/caddy", "x", record("SCHILY.xattr.security.capability", capability));
    const file = block("usr/bin/caddy", "0", Buffer.from("x"));
    const dir = mkdtempSync(join(tmpdir(), "image-pax-"));
    const archive = (name: string, ...blocks: Buffer[]): string => {
      writeFileSync(join(dir, name), Buffer.concat([...blocks, Buffer.alloc(1024)]));
      return join(dir, name);
    };
    try {
      const filesystem = readTar(archive("cap.tar", pax, file, block("etc/x", "0", Buffer.from("y"), "0004755")));
      expect(filesystem.entries).toEqual([
        { mode: "-rwxr-xr-x", path: "/usr/bin/caddy", xattrs: [`security.capability=${capability.toString("hex")}`] },
        { mode: "-rwsr-xr-x", path: "/etc/x", xattrs: [] },
      ]);
      expect(privilegeProblems("edge", filesystem.entries)).toEqual(["/etc/x setuid is not on the edge list"]);
      // Headers this reader does not read fail closed rather than hide a member's attributes.
      const long = block("././@LongLink", "L", Buffer.from("usr/bin/caddy\0"));
      expect(() => readTar(archive("long.tar", long, pax, file))).toThrow("has type L");
      const global = block("pax_global_header", "g", record("SCHILY.xattr.user.x", Buffer.from("x")));
      expect(() => readTar(archive("global.tar", global, file))).toThrow("has type g");
      // GNU tar refuses this header too; the PAX reader refuses it on its own.
      const broken = block("PaxHeaders/caddy", "x", Buffer.from("99 SCHILY.xattr.user.x=x\n"));
      expect(() => xattrValues(archive("broken.tar", broken, file))).toThrow("malformed PAX record");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("privileges_fixture_image", () => {
    // P1.29p done-when (record 2026-10-08-p129f-corpus-gaps): one extra setuid file, from the COPY --chmod the text
    // rule refuses, fails the built-image check even when that rule is bypassed.
    const dir = mkdtempSync(join(tmpdir(), "image-setuid-"));
    try {
      writeFileSync(join(dir, "x"), "x");
      writeFileSync(join(dir, "Dockerfile"), 'FROM scratch\nCOPY --chmod=4755 x /app/x\nCMD ["/app/x"]\n');
      const image = build(join(dir, "Dockerfile"), dir);
      expect(inspect(image, (filesystem) => privilegeProblems("node", filesystem.entries))).toEqual([
        "/app/x setuid is not on the node list",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 300_000);

  // Architecture notes under amendment 7: the kind map itself is iterated, a kind with no Dockerfile fails, and a
  // failed build fails, so no kind passes by being skipped.
  for (const kind of new Set(KIND_BY_FINAL_ENTRY.values())) {
    test(`${kind}_image_has_no_package_manager`, () => {
      const files = dockerfiles.filter((file) => kindOf(readFileSync(join(DEPLOYMENT, file), "utf8")) === kind);
      expect(kindProblems(kind, files, (file) => imageProblems(kind, file))).toEqual([]);
    }, 1_200_000);

    // P1.29p: each kind's built images hold exactly its listed privileges; a kind with no list fails.
    test(`${kind}_image_privileges_match_list`, () => {
      const files = dockerfiles.filter((file) => kindOf(readFileSync(join(DEPLOYMENT, file), "utf8")) === kind);
      expect(kindProblems(kind, files, (file) => imagePrivilegeProblems(kind, file))).toEqual([]);
    }, 1_200_000);
  }
});
