// P1.29: what the development stack's compose file must say, read with the preflight's own parser (no Docker). The
// running stack is P1.29t's; Compose's own reading of this file is compared in compose-parse.test.ts
// (preflight_matches_compose_config walks every compose*.yaml).
import { spawnSync } from "node:child_process";
import { lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync, type Stats, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { c26 } from "./preflight/checks/build.ts";
import { networkTableProblems, parseNetworkTable } from "./preflight/checks/networks.ts";
import { c9 } from "./preflight/checks/secrets.ts";
import type { Outcome } from "./preflight/checks/types.ts";
import { type Compose, parseCompose, type Service } from "./preflight/compose-parse.ts";
import { loadInputs } from "./preflight/inputs.ts";

const DEPLOYMENT = import.meta.dirname;
const read = (file: string): string => readFileSync(join(DEPLOYMENT, file), "utf8");
const FILE = "compose.dev.yaml";
const dev = (): Compose => parseCompose(read(FILE), FILE);
const service = (compose: Compose, name: string): Service => {
  const found = compose.services.find((s) => s.name === name);
  if (found === undefined) throw new Error(`no ${name} service`);
  return found;
};

/** The images built here (P1.29 item 6): a service names one of these or a lock entry, never anything else. */
const OWN_IMAGES = new Set(["web", "edge", "migrate", "postgres"]);
const NODE_DOCKERFILES = new Set(["deployment/images/node-app.Dockerfile", "deployment/images/migrate.Dockerfile"]);

/** A Compose memory size in MiB (the parser admits only `<n>m` and `<n>g`). */
const mebibytes = (size: string): number => Number(size.slice(0, -1)) * (size.endsWith("g") ? 1024 : 1);

/** Why a service's limits are missing or its Node heap could outgrow its memory limit (findings F-32). */
function limitProblems(s: Service, nodeBuilt: boolean): string[] {
  const { memLimit, cpus, pidsLimit } = s.hardening;
  const problems: string[] = [];
  if (memLimit === null) problems.push(`${s.name} has no mem_limit`);
  if (cpus === null) problems.push(`${s.name} has no cpus`);
  if (pidsLimit === null) problems.push(`${s.name} has no pids_limit`);
  if (!nodeBuilt || memLimit === null) return problems;
  const options = s.environment.find(([key]) => key === "NODE_OPTIONS")?.[1];
  const heap =
    options !== undefined && "literal" in options ? /--max-old-space-size=(\d+)/.exec(options.literal) : null;
  if (heap === null) problems.push(`${s.name} sets no --max-old-space-size`);
  else if (Number(heap[1]) > 0.75 * mebibytes(memLimit)) problems.push(`${s.name}'s heap is over 75 % of mem_limit`);
  return problems;
}
const nodeBuilt = (s: Service): boolean =>
  s.build !== null &&
  NODE_DOCKERFILES.has(join("deployment", s.build.context, s.build.dockerfile).replace(/^\.\.\//, ""));

describe("compose.dev.yaml (P1.29)", () => {
  test("compose_dev_name_pinned", () => {
    // Vault note compose-overlay-must-pin-project-name: an overlay never lands in another env's project.
    expect(dev().name).toBe("unset-dev");
  });

  test("compose_images_match_lock", () => {
    const lock = JSON.parse(read("images/bases.lock.json")) as Record<
      string,
      { ref: string; tag: string; digest: string }
    >;
    const locked = new Set(Object.values(lock).map((b) => `${b.ref}:${b.tag}@${b.digest}`));
    // Every compose file under deployment/ (P1.29 item 6), not only this one: a second file would add services too.
    const files = readdirSync(DEPLOYMENT, { recursive: true, encoding: "utf8" }).filter(
      (entry) => /(^|\/)compose[^/]*\.ya?ml$/.test(entry) && !entry.includes("node_modules"),
    );
    expect(files).toContain(FILE);
    for (const file of files) {
      for (const s of parseCompose(read(file), file).services) {
        if (s.image !== null) expect(locked.has(s.image) || OWN_IMAGES.has(s.image), `${file} ${s.name}`).toBe(true);
        // Until P1.27s publishes signed images, every service is built here from a scanned Dockerfile.
        expect(s.build, `${file} ${s.name}`).not.toBeNull();
      }
    }
  });

  test("compose_postgres_never_root", () => {
    const user = service(dev(), "postgres").hardening.user;
    expect(user).toBe("999:999");
    expect(user?.split(":").some((part) => part === "0" || part === "root")).toBe(false);
  });

  test("compose_postgres_tmpfs_for_socket", () => {
    const tmpfs = service(dev(), "postgres").tmpfs;
    expect(tmpfs.map((t) => t.target).sort()).toEqual(["/tmp", "/var/run/postgresql"]);
    for (const { target, options } of tmpfs) {
      expect(options?.split(","), target).toEqual(expect.arrayContaining(["uid=999", "gid=999"]));
    }
  });

  test("compose_dev_networks_match_table", () => {
    // P1.30t's comparison, so this test and the deploy gate's C17 judge alike.
    const table = parseNetworkTable(read("networks.dev.json"), "networks.dev.json");
    expect(networkTableProblems(dev(), table)).toEqual([]);
  });

  test("compose_dev_hardening", () => {
    for (const s of dev().services) {
      const h = s.hardening;
      expect(h.capDrop, s.name).toEqual(["ALL"]);
      expect(h.capAdd, s.name).toEqual([]);
      expect(h.securityOpt, s.name).toEqual(["no-new-privileges:true"]);
      expect(h.readOnly, s.name).toBe(true);
      // Every service names its numeric non-root user: a mounted secret is owned by that uid (C9 record (vi)).
      expect(h.user, s.name).toMatch(/^[1-9][0-9]*:[1-9][0-9]*$/);
      expect(h.restart, s.name).toBe(s.name === "migrate" ? "no" : "unless-stopped");
      expect(
        s.tmpfs.some((t) => t.target === "/tmp"),
        s.name,
      ).toBe(true);
    }
  });

  test("compose_dev_limits", () => {
    for (const s of dev().services) expect(limitProblems(s, nodeBuilt(s)), s.name).toEqual([]);
    expect(
      dev()
        .services.filter(nodeBuilt)
        .map((s) => s.name),
    ).toEqual(["migrate", "web"]);
    // Fixtures: a Node service without a heap cap, and one at 90 % of its limit, both fail.
    const web = service(dev(), "web");
    const without = { ...web, environment: web.environment.filter(([key]) => key !== "NODE_OPTIONS") };
    expect(limitProblems(without, true)).toEqual(["web sets no --max-old-space-size"]);
    const ninety: Service = {
      ...web,
      environment: [["NODE_OPTIONS", { literal: "--max-old-space-size=461" }]],
      hardening: { ...web.hardening, memLimit: "512m" },
    };
    expect(limitProblems(ninety, true)).toEqual(["web's heap is over 75 % of mem_limit"]);
  });

  test("postgres_only_on_internal_networks", () => {
    const compose = dev();
    const internal = new Set(compose.networks.filter((n) => n.internal).map((n) => n.name));
    const postgres = service(compose, "postgres");
    expect(postgres.networks.length).toBeGreaterThan(0);
    for (const network of postgres.networks) expect(internal.has(network), network).toBe(true);
    expect(postgres.ports).toEqual([]);
  });

  test("compose_dev_only_edge_publishes", () => {
    // The edge, the only service that may publish, joins in P1.29a; until then nothing does.
    for (const s of dev().services) expect(s.ports, s.name).toEqual([]);
  });

  test("compose_dev_secrets_have_one_reader_uid", () => {
    // C9 record (vi), architecture 2026-10-12-c9-secret-file-owner: each mounted secret file is owned by the one uid
    // that reads it, so no secret is mounted by services running as different uids, and none is mounted by nobody.
    const compose = dev();
    const readers = new Map<string, Set<string>>();
    for (const s of compose.services) {
      for (const name of s.secrets) readers.set(name, (readers.get(name) ?? new Set()).add(s.hardening.user ?? ""));
    }
    for (const [name, users] of readers) expect([...users], name).toHaveLength(1);
    expect(compose.secretFiles).toHaveLength(readers.size);
  });

  test("compose_dev_secrets_live_beside_the_checkout", () => {
    // Architecture record 2026-10-12-p127u-bind-ancestors-and-build-context (b): postgres builds from the repository
    // root, so a secrets folder inside the checkout sits in a build context. `file:` resolves from this file's folder.
    const checkout = resolve(DEPLOYMENT, "..");
    const folders = new Set(dev().secretFiles.map((file) => dirname(resolve(DEPLOYMENT, file))));
    expect([...folders]).toEqual([join(dirname(checkout), "unset-dev-secrets")]);
    for (const folder of folders) expect(relative(checkout, folder).startsWith(".."), folder).toBe(true);
  });

  test("compose_dev_env_files_live_beside_the_checkout", () => {
    // Architecture record 2026-10-12-p127u-bind-ancestors-and-build-context, Amendment 2 item 1: an env file under the
    // checkout sits in postgres's root build context, so every env file the stack reads lives in unset-dev-env/, a
    // sibling of the checkout; the checkout keeps only *.example.env templates (Amendment 3), and git ignores no env
    // file there, so a stray live one shows up instead of looking safe.
    const checkout = resolve(DEPLOYMENT, "..");
    const envFolder = join(dirname(checkout), "unset-dev-env");
    const scripts = (
      JSON.parse(readFileSync(join(checkout, "package.json"), "utf8")) as { scripts: Record<string, string> }
    ).scripts;
    for (const name of ["dev:up", "dev:down"]) {
      const file = /--interpolation-env (\S+)/.exec(scripts[name] ?? "")?.[1];
      expect(file, name).toBeDefined();
      expect(resolve(checkout, file ?? ""), name).toBe(join(envFolder, "dev-public.env"));
    }
    for (const s of dev().services) {
      for (const file of s.envFiles) expect(dirname(resolve(DEPLOYMENT, file)), s.name).toBe(envFolder);
    }
    // The stack's own folders only: deployment/env holds templates, and Compose would load a `.env` beside this file.
    const live = readdirSync(join(DEPLOYMENT, "env")).filter((entry) => !entry.endsWith(".example.env"));
    const envFiles = [...live.map((entry) => `env/${entry}`), ...readdirSync(DEPLOYMENT).filter((e) => e === ".env")];
    expect(envFiles).toEqual([]);
  });

  test("git_ignores_no_env_or_secrets_file", () => {
    // Architecture record 2026-10-12-p127u-bind-ancestors-and-build-context, Amendment 2: gitignore nothing that would
    // make a stray env or secrets file look safe. A stray file under the checkout sits in postgres's root build context
    // and is copied by `COPY . .`, so it must show in `git status`. git check-ignore is the probe: it applies every
    // .gitignore in the checkout as git does (git-check-ignore(1), --no-index so tracking does not matter). Exit 1
    // means none of the paths is ignored. The user's own global excludes file is set aside: it is not the repo's.
    const strays = [
      ".env",
      ".env.local",
      "deployment/.env",
      "deployment/.env.production",
      "deployment/env/dev-public.env",
      "deployment/env/postgres.env",
      "deployment/web.env",
      "secrets/postgres_password",
      "deployment/secrets/postgres_password",
      "unset-dev-secrets/postgres_password",
    ];
    const probe = spawnSync(
      "git",
      ["-c", "core.excludesFile=/dev/null", "check-ignore", "--no-index", "--verbose", "--", ...strays],
      { cwd: resolve(DEPLOYMENT, ".."), encoding: "utf8" },
    );
    expect({ status: probe.status, ignored: probe.stdout }).toEqual({ status: 1, ignored: "" });
  });

  test("compose_dev_binds_are_read_only_and_state_is_a_named_volume", () => {
    // Architecture record 2026-10-12-p127u-bind-ancestors-and-build-context, Amendment 1: writable service state is a
    // named volume under Docker's root-owned data root, never a bind; a bind kept is deploy-owned, read-only content.
    // The postgres:18 image's VOLUME is /var/lib/postgresql, PGDATA beneath it (docker-library/postgres
    // 18/trixie/Dockerfile:189-192).
    const compose = dev();
    for (const s of compose.services) {
      for (const m of s.mounts.filter((mount) => mount.type === "bind"))
        expect(m.readOnly, `${s.name} ${m.target}`).toBe(true);
    }
    expect(service(compose, "postgres").mounts).toContainEqual(
      expect.objectContaining({ type: "volume", source: "pgdata", target: "/var/lib/postgresql" }),
    );
  });

  test("dev_down_never_removes_volumes", () => {
    const scripts = (
      JSON.parse(readFileSync(join(DEPLOYMENT, "..", "package.json"), "utf8")) as {
        scripts: Record<string, string>;
      }
    ).scripts;
    expect(scripts["dev:down"]).toBeDefined();
    expect(scripts["dev:down"]).not.toMatch(/(^|\s)(-v|--volumes)(\s|=|$)/);
  });
});

/**
 * C9 and C26 as the preflight runs them on this checkout's compose.dev.yaml, the stack's folders beside it as the
 * runbook lays them out (docs/human/runbooks/dev-stack-secrets.md). The file stats are injected, so the result does not
 * depend on the runner's own owners and modes: the deploy user owns the checkout, root owns its parents, and the two
 * sibling folders hold what the runbook puts there. The Dockerfiles and the compose file are the real ones.
 */
describe("compose.dev.yaml under the preflight's C9 and C26 (P1.29)", () => {
  const CHECKOUT = resolve(DEPLOYMENT, "..");
  const SECRETS = join(dirname(CHECKOUT), "unset-dev-secrets");
  const ENV = join(dirname(CHECKOUT), "unset-dev-env");
  const ENV_FILE = join(ENV, "dev-public.env");
  const DEPLOY_UID = 4242;
  const DEV = 0x7fff0001;
  /** Each mounted secret, owned by the uid of the one service that reads it (C9). */
  const SECRET_OWNERS: Record<string, number> = {
    pg_superuser_password: 999,
    pg_migrator_password: 999,
    pg_tap_password: 999,
    migrate_pg_password: 65532,
    pg_web_password: 65532,
    pg_api_password: 65532,
    pg_indexer_password: 65532,
  };
  /** A stat of `kind` with this mode and owner; a copy of a real one, so the methods are Node's. */
  const made = (kind: "dir" | "file", mode: number, uid: number, ino: number): Stats =>
    Object.assign(lstatSync(DEPLOYMENT), {
      mode: (kind === "dir" ? 0o040000 : 0o100000) | mode,
      uid,
      size: kind === "dir" ? 4096 : 24,
      nlink: kind === "dir" ? 2 : 1,
      dev: DEV,
      ino,
    });
  const virtual = new Map<string, Stats>([
    [SECRETS, made("dir", 0o700, DEPLOY_UID, 1)],
    [ENV, made("dir", 0o700, DEPLOY_UID, 2)],
    [ENV_FILE, made("file", 0o600, DEPLOY_UID, 3)],
    ...Object.entries(SECRET_OWNERS).map(([name, uid], at): [string, Stats] => [
      join(SECRETS, name),
      made("file", 0o400, uid, 10 + at),
    ]),
  ]);
  const inCheckout = (path: string) => path === CHECKOUT || path.startsWith(`${CHECKOUT}/`);
  const aboveCheckout = (path: string) => path === "/" || CHECKOUT.startsWith(`${path}/`);
  /** The real entry inside the checkout, as the deploy user's with no group or other write. */
  const real = (read: (path: string) => Stats, path: string): Stats | null => {
    try {
      const info = read(path);
      return Object.assign(info, { uid: DEPLOY_UID, mode: info.mode & ~0o022 });
    } catch {
      return null;
    }
  };
  const look = (read: (path: string) => Stats) => (path: string) =>
    virtual.get(path) ??
    (inCheckout(path) ? real(read, path) : aboveCheckout(path) ? made("dir", 0o755, 0, 100 + path.length) : null);
  const realpath = (path: string) => {
    if (virtual.has(path) || aboveCheckout(path)) return path;
    if (!inCheckout(path)) return null;
    try {
      return realpathSync.native(path);
    } catch {
      return null;
    }
  };

  /** C9's and C26's outcomes for compose.dev.yaml's text after `edit`. */
  const outcomes = async (edit: (text: string) => string = (text) => text): Promise<Outcome[]> => {
    const file = join(DEPLOYMENT, FILE);
    const { inputs } = loadInputs(["--env", "dev", "--compose", file, "--interpolation-env", ENV_FILE], {
      root: CHECKOUT,
      run: async () => ({ code: 1, stdout: "", stderr: "" }),
      readText: (path) => (path === file ? edit(read(FILE)) : null),
      readEnv: (path) => (path === ENV_FILE ? { text: read("env/dev-public.example.env"), id: `${DEV}:3` } : null),
      lstat: look(lstatSync),
      stat: look(statSync),
      realpath,
      readlink: (path) => readlinkSync(path),
      statfs: () => ({ type: 0xef53 }),
      uid: DEPLOY_UID,
      environment: {},
    });
    const signal = new AbortController().signal;
    return [await c9.run(inputs, signal), await c26.run(inputs, signal)];
  };

  test("c9_and_c26_pass_on_the_dev_stack", async () => {
    expect(await outcomes()).toEqual([
      { pass: true, reason: "1 files, 7 mounted secrets" },
      { pass: true, reason: "ok" },
    ]);
  });

  test("c9_and_c26_refuse_the_dev_stacks_folders_in_reach", async () => {
    const bind = (source: string) => (text: string) =>
      text.replace(
        "      - ./postgres/init:/docker-entrypoint-initdb.d:ro\n",
        `      - ./postgres/init:/docker-entrypoint-initdb.d:ro\n      - ${source}:/srv:ro\n`,
      );
    expect((await outcomes(bind("../../unset-dev-secrets")))[0]).toEqual({
      pass: false,
      reason: "postgres binds a path that reaches the secrets folder",
    });
    expect((await outcomes(bind("../../unset-dev-env")))[0]).toEqual({
      pass: false,
      reason: "postgres binds a path that reaches an env file or the env folder",
    });
    const context = (text: string) => text.replace("      context: ..\n", "      context: .\n");
    expect((await outcomes(context))[1]).toEqual({
      pass: false,
      reason: "postgres builds from a Dockerfile the images workflow does not scan",
    });
  });
});
