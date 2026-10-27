// P1.29, P1.29a: what the development stack's compose file must say, read with the preflight's own parser (no Docker). The
// running stack is P1.29t's; Compose's own reading of this file is compared in compose-parse.test.ts
// (preflight_matches_compose_config walks every compose*.yaml).
import { spawnSync } from "node:child_process";
import { lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync, type Stats, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { DEV_EDGE_ADDRESS, DEV_LISTENER, DEV_PROXY_ADDRESS } from "./edge/caddyfile.ts";
import { VENDOR_IMAGES } from "./images/vendor.ts";
import { c26 } from "./preflight/checks/build.ts";
import { c18, edgeZones } from "./preflight/checks/edge.ts";
import { VENDOR_IMAGES as PREFLIGHT_VENDOR_IMAGES } from "./preflight/checks/images.ts";
import { networkTableProblems, parseNetworkTable, pdsNeighbours } from "./preflight/checks/networks.ts";
import { c32 } from "./preflight/checks/placeholders.ts";
import { c9 } from "./preflight/checks/secrets.ts";
import { switchesProtectionOff } from "./preflight/checks/settings.ts";
import { fail, type Outcome, pass } from "./preflight/checks/types.ts";
import {
  type Compose,
  type Hardening,
  parseCompose,
  parseStrictData,
  type Service,
  TOKEN_READER,
} from "./preflight/compose-parse.ts";
import { loadInputs } from "./preflight/inputs.ts";
import { SecretMap } from "./preflight/secret-map.ts";

const DEPLOYMENT = import.meta.dirname;
const read = (file: string): string => readFileSync(join(DEPLOYMENT, file), "utf8");
const FILE = "compose.dev.yaml";
const dev = (): Compose => parseCompose(read(FILE), FILE);
/** The local stack's file, which alone carries the token reader (P1.34d item 11). */
/** newt_edge's fixed subnet and the two addresses on it (ADR 0030 Decision 2, P1.37v); .1 is the bridge's gateway. */
const NEWT_SUBNET = "10.250.37.0/29";
const NEWT_ADDRESS = "10.250.37.2";
const EDGE_ADDRESS = "10.250.37.3";
const LOCAL = "compose.local.yaml";
/** The staging file built from the checkout (P1.37y, ADR 0036): dev's services, five of them built, the rest dev's images. */
const SOURCE = "compose.dev.source.yaml";
const local = (): Compose => parseCompose(read(LOCAL), LOCAL);
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
/** The published images built from those Dockerfiles, as the deploy lock names them (P2.26b). */
const nodePublished = (s: Service): boolean =>
  s.image !== null && ["web", "migrate"].some((name) => readDeployLock()[name]?.ref === s.image);
/** A Node service: one built from our Node image or running it, or the PDS, which runs Node too (findings F-32). */
const runsNode = (s: Service): boolean => nodeBuilt(s) || nodePublished(s) || s.name === "pds";

/** A service's limits, by their Compose keys, as both compose files write them. */
type LimitRow = { mem_limit: string; cpus: number; pids_limit: number };
/** The one table, beside networks.dev.json, that pins every service's limits by value in both files (P1.35r I-1). */
const LIMITS = "limits.dev.json";
const readLimits = (): Record<string, LimitRow> => JSON.parse(read(LIMITS)) as Record<string, LimitRow>;

const LIMIT_KEYS = ["mem_limit", "cpus", "pids_limit"] as const;
/** Each limit of `compose` that differs from its table row or is missing, and each service the table has no row for. */
function limitsDrift(table: Record<string, LimitRow>, compose: Compose): string[] {
  return compose.services.flatMap((s) => {
    const row = Object.hasOwn(table, s.name) ? table[s.name] : undefined;
    if (row === undefined) return [`${s.name} has no row in ${LIMITS}`];
    const written = { mem_limit: s.hardening.memLimit, cpus: s.hardening.cpus, pids_limit: s.hardening.pidsLimit };
    return LIMIT_KEYS.filter((key) => written[key] !== row[key]).map(
      (key) => `${s.name}: ${key} is ${written[key] ?? "missing"}, ${LIMITS} says ${row[key]}`,
    );
  });
}
/** A copy of `compose` with `name`'s hardening changed. */
const limited = (compose: Compose, name: string, change: Partial<Hardening>): Compose => ({
  ...compose,
  services: compose.services.map((s) => (s.name === name ? { ...s, hardening: { ...s.hardening, ...change } } : s)),
});

/** One deploy-lock entry (deployment/images.lock.json; scripts/ci/verify-images.ts LockEntry). */
type DeployEntry = { ref: string; origin: "first-party" | "upstream"; upstreamSource?: string; verify: string };
const readDeployLock = (): Record<string, DeployEntry> =>
  JSON.parse(read("images.lock.json")) as Record<string, DeployEntry>;

type LockEntry = { ref: string; tag: string; digest: string; stage: string; buildStage: boolean };
const readLock = (): Record<string, LockEntry> =>
  JSON.parse(read("images/bases.lock.json")) as Record<string, LockEntry>;
/**
 * A lock entry run as shipped: a vendor image (deployment/images/vendor.ts) locked as a runtime image no Dockerfile
 * builds on (record 2026-10-07-p129-migrate-image-and-run-only-images, point 2). The runtime bases we harden in our own
 * Dockerfiles, caddy and postgres, are never one (Codex on #774).
 */
const runOnlyImages = (): Set<string> =>
  new Set(
    Object.values(readLock())
      .filter((b) => VENDOR_IMAGES.has(b.ref) && b.stage === "runtime" && !b.buildStage)
      .map((b) => `${b.ref}:${b.tag}@${b.digest}`),
  );

/**
 * The locked Node runtime base, run as shipped by the token reader alone, under the tools profile with no network
 * (architecture record 2026-10-13-p129h-local-token-reader, Amendment 1 point 3). Every other Node service is built
 * from our Dockerfiles.
 */
const isTokenReaderNode = (s: Service): boolean => {
  const node = readLock().node;
  return (
    s.name === TOKEN_READER &&
    s.build === null &&
    s.image === `${node?.ref}:${node?.tag}@${node?.digest}` &&
    s.profiles.length === 1 &&
    s.profiles[0] === "tools" &&
    s.networkMode === "none" &&
    s.networks.length === 0
  );
};

describe("compose.dev.yaml (P1.29)", () => {
  test("compose_dev_name_pinned", () => {
    // Vault note compose-overlay-must-pin-project-name: an overlay never lands in another env's project.
    expect(dev().name).toBe("unset-dev");
  });

  test("compose_images_match_lock", () => {
    const locked = new Set(Object.values(readLock()).map((b) => `${b.ref}:${b.tag}@${b.digest}`));
    const runOnly = runOnlyImages();
    // Every compose file under deployment/ (P1.29 item 6), not only this one: a second file would add services too.
    const files = readdirSync(DEPLOYMENT, { recursive: true, encoding: "utf8" }).filter(
      (entry) => /(^|\/)compose[^/]*\.ya?ml$/.test(entry) && !entry.includes("node_modules"),
    );
    expect(files).toContain(FILE);
    // compose.dev.yaml runs only deploy-lock images (compose_dev_images_by_digest); every other file builds here. The
    // source file keeps dev's image for what it does not build (compose.dev.source.test.ts holds the rest).
    const devImages = new Map(dev().services.map((s) => [s.name, s.image]));
    for (const file of files.filter((f) => f !== FILE)) {
      for (const s of parseCompose(read(file), file).services) {
        if (file === SOURCE && s.build === null) {
          expect(s.image, `${file} ${s.name}`).toBe(devImages.get(s.name));
          continue;
        }
        if (s.image !== null) expect(locked.has(s.image) || OWN_IMAGES.has(s.image), `${file} ${s.name}`).toBe(true);
        // Every service is built here from a scanned Dockerfile, except a run-only image, named exactly as its lock
        // entry, which the mirror workflow scans (P1.29a).
        if (s.build === null) {
          expect(runOnly.has(s.image ?? "") || (file === LOCAL && isTokenReaderNode(s)), `${file} ${s.name}`).toBe(
            true,
          );
        }
      }
    }
  });

  test("compose_dev_images_by_digest", () => {
    // P2.26b: the dev stack builds nothing; each service runs exactly the deploy lock's entry of its name, by digest,
    // and the lock names nothing the stack does not run.
    const deploy = readDeployLock();
    for (const s of dev().services) {
      expect([s.build, s.image], s.name).toEqual([null, deploy[s.name]?.ref]);
      expect(s.image, s.name).toMatch(/^ghcr\.io\/undefined6799\/(?:unset|mirror)\/[a-z0-9-]+@sha256:[0-9a-f]{64}$/);
    }
    expect(Object.keys(deploy).sort()).toEqual(
      dev()
        .services.map((s) => s.name)
        .sort(),
    );
    // A mirror entry keeps its upstream digest (mirror.yml copies by digest) and names the base lock's upstream image.
    const bases = new Set(Object.values(readLock()).map((b) => `${b.ref}:${b.tag}@${b.digest}`));
    for (const [name, entry] of Object.entries(deploy).filter(([, e]) => e.origin === "upstream")) {
      expect(bases.has(entry.upstreamSource ?? ""), name).toBe(true);
      expect(entry.ref.split("@")[1], name).toBe(entry.upstreamSource?.split("@")[1]);
    }
  });

  test("node_base_runs_unbuilt_only_for_the_token_reader", () => {
    const reader = service(local(), TOKEN_READER);
    expect(isTokenReaderNode(reader)).toBe(true);
    // Red fixtures (Amendment 1 point 3): the same image on another service, without the profile, or with a network.
    expect(isTokenReaderNode({ ...reader, name: "web" })).toBe(false);
    expect(isTokenReaderNode({ ...reader, profiles: [] })).toBe(false);
    expect(isTokenReaderNode({ ...reader, networkMode: null, networks: ["db"] })).toBe(false);
    expect(isTokenReaderNode({ ...reader, networkMode: "host" })).toBe(false);
    expect(isTokenReaderNode({ ...reader, image: `${reader.image?.split("@")[0]}@sha256:${"0".repeat(64)}` })).toBe(
      false,
    );
  });

  test("pds_token_reader_reads_only_the_pds_volume", () => {
    // The record, point 1: the volume read-only and the one reader script read-only; no env file, no env, no secret.
    const reader = service(local(), TOKEN_READER);
    expect(reader.mounts).toEqual([
      { type: "volume", source: "pdsdata", target: "/data", readOnly: true },
      { type: "bind", source: "../tests/support/pds-email-token-read.ts", target: "/reader/read.ts", readOnly: true },
    ]);
    expect([reader.envFiles, reader.environment, reader.secrets, reader.ports, reader.dependsOn]).toEqual([
      [],
      [],
      [],
      [],
      [],
    ]);
    // Amendment 2, B1: the token on its stdout reaches no log driver.
    expect(reader.logging).toBe("none");
    // The PDS keeps its database at /home/node/account.sqlite, the volume root, so the reader finds it at /data.
    expect(service(local(), "pds").mounts).toContainEqual(
      expect.objectContaining({ type: "volume", source: "pdsdata", target: "/home/node" }),
    );
    expect(readFileSync(join(DEPLOYMENT, "..", "tests/support/pds-email-token-read.ts"), "utf8")).toContain(
      'const ACCOUNT_DB = "/data/account.sqlite";',
    );
  });

  test("pds_token_reader_only_in_the_local_file", () => {
    // Only in compose.local.yaml (local-plc Amendment 6, Q2; P1.34d item 11), and no other service carries a profile
    // (the record, point 1).
    const files = readdirSync(DEPLOYMENT, { recursive: true, encoding: "utf8" }).filter(
      (entry) => /(^|\/)compose[^/]*\.ya?ml$/.test(entry) && !entry.includes("node_modules"),
    );
    for (const file of files) {
      for (const s of parseCompose(read(file), file).services) {
        const allowed = file === LOCAL && s.name === TOKEN_READER;
        expect(s.name === TOKEN_READER && !allowed, `${file} ${s.name}`).toBe(false);
        expect(s.profiles.length > 0 && !allowed, `${file} ${s.name}`).toBe(false);
      }
    }
  });

  test("preflight_vendor_images_match", () => {
    // The preflight keeps its own copy of the vendor list, since it may not import deployment/images/ (P1.27l): C2
    // under --env local admits exactly what this file's run-only rule admits.
    expect([...PREFLIGHT_VENDOR_IMAGES].sort()).toEqual([...VENDOR_IMAGES].sort());
  });

  test("run_only_image_is_exactly_a_runtime_lock_entry", () => {
    // Architecture record 2026-10-13-p129a-pds-and-edge-in-compose, point 2: an image with no build must equal a
    // `stage: runtime` lock entry with `buildStage: false` byte for byte.
    const lock = readLock();
    const exact = (key: string) => `${lock[key]?.ref}:${lock[key]?.tag}@${lock[key]?.digest}`;
    const runOnly = runOnlyImages();
    expect(runOnly.has(exact("pds"))).toBe(true);
    const otherDigest = `sha256:${"0".repeat(64)}`;
    for (const image of [
      `${lock.pds?.ref}:${lock.pds?.tag}@${otherDigest}`,
      `${lock.pds?.ref}:${lock.pds?.tag}`,
      `${lock.pds?.ref}@${lock.pds?.digest}`,
      ` ${exact("pds")}`,
      exact("caddy-builder"),
      exact("node"),
      // Codex on #774: buildStage false means no Dockerfile stage builds on the entry, not that we run it as shipped,
      // so the runtime bases we harden in our own Dockerfiles must never stand in for their builds.
      exact("caddy"),
      exact("postgres"),
    ]) {
      expect(runOnly.has(image), image).toBe(false);
    }
  });

  test("compose_postgres_never_root", () => {
    const user = service(dev(), "postgres").hardening.user;
    expect(user).toBe("999:999");
    expect(user?.split(":").some((part) => part === "0" || part === "root")).toBe(false);
  });

  test("compose_postgres_keeps_the_default_superuser", () => {
    // P1.11y: pg_hba.conf lets only the OS user postgres in over the socket, by peer, and the entrypoint's init psql
    // connects as POSTGRES_USER (docker-entrypoint.sh, pinned 18-trixie), so any other superuser name would stop the
    // first init after initdb (Codex on #1189). Each stack sets only the password file, and reads no env file.
    for (const compose of [dev(), local()]) {
      const postgres = service(compose, "postgres");
      expect(postgres.envFiles).toEqual([]);
      expect(postgres.environment).toEqual([
        ["POSTGRES_PASSWORD_FILE", { literal: "/run/secrets/pg_superuser_password" }],
      ]);
    }
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
    // Both files' services, so a local-only one (the token reader) is pinned too (verify-903 M2).
    for (const s of [...dev().services, ...local().services]) {
      const h = s.hardening;
      expect(h.capDrop, s.name).toEqual(["ALL"]);
      // Only the edge binds below 1024 (80 and 443), as its non-root user (P1.28 setcap; plan section 8).
      expect(h.capAdd, s.name).toEqual(s.name === "edge" ? ["NET_BIND_SERVICE"] : []);
      expect(h.securityOpt, s.name).toEqual(["no-new-privileges:true"]);
      expect(h.readOnly, s.name).toBe(true);
      // Every service names its numeric non-root user: a mounted secret is owned by that uid (C9 record (vi)).
      expect(h.user, s.name).toMatch(/^[1-9][0-9]*:[1-9][0-9]*$/);
      // A one-off run (migrate, and the token reader under `compose run`) never restarts.
      expect(h.restart, s.name).toBe(s.name === "migrate" || s.name === TOKEN_READER ? "no" : "unless-stopped");
      expect(
        s.tmpfs.some((t) => t.target === "/tmp"),
        s.name,
      ).toBe(true);
    }
  });

  test("compose_dev_limits", () => {
    for (const s of [...dev().services, ...local().services]) {
      expect(limitProblems(s, runsNode(s)), s.name).toEqual([]);
    }
    expect(
      dev()
        .services.filter(runsNode)
        .map((s) => s.name),
    ).toEqual(["migrate", "pds", "web"]);
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

  test("compose_limits_match_table", () => {
    // P1.35r I-1: the compose tests checked only that each limit is there, so a raised one let a service starve the
    // host. Every service's mem_limit, cpus and pids_limit, in both files, is the table's, and every row is used.
    const table = readLimits();
    expect(limitsDrift(table, dev()), FILE).toEqual([]);
    expect(limitsDrift(table, local()), LOCAL).toEqual([]);
    const services = new Set([...dev().services, ...local().services].map((s) => s.name));
    expect(Object.keys(table).filter((name) => !services.has(name))).toEqual([]);
  });

  const { [TOKEN_READER]: _reader, ...withoutReader } = readLimits();
  test.each([
    {
      name: "pids_limit 4096 on the reader",
      table: readLimits(),
      compose: limited(local(), TOKEN_READER, { pidsLimit: 4096 }),
      problem: `${TOKEN_READER}: pids_limit is 4096, ${LIMITS} says 32`,
    },
    {
      name: "mem_limit raised on web",
      table: readLimits(),
      compose: limited(dev(), "web", { memLimit: "1g" }),
      problem: `web: mem_limit is 1g, ${LIMITS} says 512m`,
    },
    {
      name: "cpus removed from edge",
      table: readLimits(),
      compose: limited(local(), "edge", { cpus: null }),
      problem: `edge: cpus is missing, ${LIMITS} says 0.5`,
    },
    {
      name: "a service missing from the table",
      table: withoutReader,
      compose: local(),
      problem: `${TOKEN_READER} has no row in ${LIMITS}`,
    },
  ])("a_limit_off_the_table_is_named: $name", ({ table, compose, problem }) => {
    expect(limitsDrift(table, compose)).toContain(problem);
  });

  test("postgres_only_on_internal_networks", () => {
    const compose = dev();
    const internal = new Set(compose.networks.filter((n) => n.internal).map((n) => n.name));
    const postgres = service(compose, "postgres");
    expect(postgres.networks.length).toBeGreaterThan(0);
    for (const network of postgres.networks) expect(internal.has(network), network).toBe(true);
    expect(postgres.ports).toEqual([]);
  });

  test("web_leaves_only_through_its_own_egress", () => {
    // web's one way out is web_egress, a network no other service joins, and every request on it goes through
    // net-guard (ADR 0022, replacing architecture 02:05Z option C's "no way out" for web; verify-895 N2).
    const compose = dev();
    const internal = new Set(compose.networks.filter((n) => n.internal).map((n) => n.name));
    const web = service(compose, "web");
    expect(web.networks.length).toBeGreaterThan(0);
    expect(web.networks.filter((network) => !internal.has(network))).toEqual(["web_egress"]);
    const members = compose.services.filter((s) => s.networks.includes("web_egress")).map((s) => s.name);
    expect(members).toEqual(["web"]);
    expect(web.ports).toEqual([]);
  });

  test("compose_dev_publishes_nothing", () => {
    // ADR 0030 Decision 2 and ADR 0031 Decision 2 (P1.37v): under dev no service publishes, the edge included; Newt
    // reaches the edge on newt_edge. compose.local.yaml keeps the edge's loopback publish (compose.local.test.ts).
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

/** A service's environment as written: a literal's text, or `${NAME}` for a value taken from the interpolation file. */
const envOf = (s: Service): Map<string, string> =>
  new Map(s.environment.map(([key, value]) => [key, "ref" in value ? `\${${value.ref}}` : value.literal]));

/** The settings an env template writes, comments and blank lines left out. */
const envSettings = (text: string): [string, string][] =>
  text
    .split("\n")
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]);
/** Pino's levels at info or above, and silent (P1.30 C12): debug and trace would log mail tokens (below). */
const LOG_LEVELS = new Set(["info", "warn", "error", "fatal", "silent"]);
const SMTP = ["PDS_EMAIL_SMTP_URL", "PDS_MODERATION_EMAIL_SMTP_URL", "PDS_MODERATION_EMAIL_ADDRESS"];

/**
 * Why mail could reach the PDS's logs. With no SMTP URL the PDS's mailer sends nothing and logs the whole message, its
 * recipient and its tokens, at debug level: @atproto/pds 0.5.37 dist/mailer/index.js:80 ("No SMTP URL has been
 * configured. Intended to send email") and dist/mailer/moderation.js:17. Re-read on every PDS bump; if that log moves to
 * info, the rule becomes LOG_ENABLED=false alone (record 2026-10-07-pds-mail-se7-and-local-verification, point 1).
 */
function mailLogProblems(env: Map<string, string>): string[] {
  if (SMTP.every((name) => env.has(name))) return [];
  const problems: string[] = [];
  if (env.get("LOG_ENABLED") !== "false") problems.push("mail is unset but LOG_ENABLED is not exactly false");
  const level = env.get("LOG_LEVEL");
  if (level !== undefined && !LOG_LEVELS.has(level)) problems.push("mail is unset but LOG_LEVEL is not allowlisted");
  return problems;
}

describe("compose.dev.yaml, the PDS and the edge (P1.29a)", () => {
  test("pds_runs_the_locked_image", () => {
    // Alex, "Allow pinned" (2026-10-07T13:00:19Z): Bluesky's image, by the lock's exact ref, tag and digest. Since
    // P2.24y the stack runs the ADR 0027 recipe published from it: the recipe's final stage is that exact image with
    // only its oauth-provider-ui dist replaced, and the deploy lock names the published recipe as first-party.
    const pds = readLock().pds;
    expect(pds).toBeDefined();
    const recipe = readFileSync(join(import.meta.dirname, "pds", "Dockerfile"), "utf8");
    expect(recipe.match(/^FROM \S+/gm)?.at(-1)).toBe(`FROM ${pds?.ref}:${pds?.tag}@${pds?.digest}`);
    const entry = readDeployLock().pds;
    expect(entry?.origin).toBe("first-party");
    expect(entry?.ref).toMatch(/^ghcr\.io\/undefined6799\/unset\/pds@sha256:[0-9a-f]{64}$/);
    expect(service(dev(), "pds").image).toBe(entry?.ref);
    expect(service(dev(), "pds").build).toBeNull();
    expect(service(local(), "pds").build).toEqual({ context: "./pds", dockerfile: "Dockerfile" });
  });

  test("pds_env_pinned", () => {
    // Step book P1.29 "Services": every PDS setting written out, never left to a default, and the dangerous ones absent.
    const env = envOf(service(dev(), "pds"));
    expect(Object.fromEntries(env)).toEqual({
      PDS_HOSTNAME: "${PDS_HOSTNAME}",
      PDS_SERVICE_HANDLE_DOMAINS: "${PDS_SERVICE_HANDLE_DOMAINS}",
      PDS_PORT: "3000",
      PDS_DATA_DIRECTORY: "/home/node",
      PDS_BLOBSTORE_DISK_LOCATION: "/home/node/blocks",
      PDS_BLOB_UPLOAD_LIMIT: "5242880",
      PDS_DID_PLC_URL: "https://plc.directory",
      PDS_INVITE_REQUIRED: "true",
      PDS_CRAWLERS: "",
      PDS_RATE_LIMITS_ENABLED: "false",
      PDS_EMAIL_DISABLE_CONFIRMATION_LINK: "true",
      PDS_EMAIL_FROM_ADDRESS: "noreply@staging.unset.sh",
      PDS_MODERATION_EMAIL_ADDRESS: "moderation@staging.unset.sh",
      LOG_ENABLED: "false",
      NODE_OPTIONS: "--max-old-space-size=768",
    });
    // The local PDS differs only by the one dev root it trusts (P1.34d items 5 and 11; verify-903 M1) and by sending no
    // mail, so it has no from addresses (P1.36g; C11 and C19 refuse them under local). Both publish to plc.directory
    // (ADR 0023).
    const {
      PDS_EMAIL_FROM_ADDRESS: _from,
      PDS_MODERATION_EMAIL_ADDRESS: _moderation,
      ...shared
    } = Object.fromEntries(env);
    expect(Object.fromEntries(envOf(service(local(), "pds")))).toEqual({
      ...shared,
      NODE_EXTRA_CA_CERTS: "/etc/unset-dev-trust/root.pem",
    });
  });

  test("pds_env_file_holds_only_its_secrets", () => {
    // The env file carries what the PDS cannot take from /run/secrets, and nothing that could shadow a pinned value
    // (compose.dev.yaml's literals win over env_file anyway; this keeps the template honest).
    const names = read("env/pds.example.env")
      .split("\n")
      .filter((line) => line !== "" && !line.startsWith("#"))
      .map((line) => line.slice(0, line.indexOf("=")));
    expect(names).toEqual([
      "PDS_JWT_SECRET",
      "PDS_ADMIN_PASSWORD",
      "PDS_PLC_ROTATION_KEY_K256_PRIVATE_KEY_HEX",
      "PDS_RECOVERY_DID_KEY",
      "PDS_EMAIL_SMTP_URL",
      "PDS_MODERATION_EMAIL_SMTP_URL",
    ]);
    expect(service(dev(), "pds").envFiles).toEqual(["../../unset-dev-env/pds.env"]);
  });

  test("pds_rate_limits_disabled_explicitly", () => {
    // Plan section 5.2: the PDS sees only the edge's address, so its per-IP limit is off, set explicitly, with no
    // bypass (book edit 2026-10-07-p128-rate-limit-test-to-p129). P1.30 C7 and C8 check the deployed env.
    const env = envOf(service(dev(), "pds"));
    expect(env.get("PDS_RATE_LIMITS_ENABLED")).toBe("false");
    expect([...env.keys()].filter((name) => name.startsWith("PDS_RATE_LIMIT_BYPASS_"))).toEqual([]);
  });

  test("pds_mail_unset_only_with_logging_off", () => {
    // Both files' PDS (P1.34d item 14): the preflight no longer checks this under local, where mail is refused.
    for (const file of [FILE, LOCAL]) {
      expect(mailLogProblems(envOf(service(parseCompose(read(file), file), "pds"))), file).toEqual([]);
    }
    // Under dev mail is required (P1.36g): the SMTP URLs come from pds.env, so compose and the template together name
    // every mail setting, and preflight C11 and C19 fail a dev stack without them.
    const template = read("env/pds.example.env")
      .split("\n")
      .filter((line) => line !== "" && !line.startsWith("#"))
      .map((line): [string, string] => [line.slice(0, line.indexOf("=")), "x"]);
    const devMail = new Map([...envOf(service(dev(), "pds")), ...template]);
    expect([...SMTP, "PDS_EMAIL_FROM_ADDRESS"].filter((name) => !devMail.has(name))).toEqual([]);
    const off = new Map([["LOG_ENABLED", "false"]]);
    for (const level of ["info", "warn", "error", "fatal", "silent"]) {
      expect(mailLogProblems(new Map([...off, ["LOG_LEVEL", level]])), level).toEqual([]);
    }
    for (const level of ["debug", "trace", "DEBUG", "Info", "10", ""]) {
      expect(mailLogProblems(new Map([...off, ["LOG_LEVEL", level]])), level).toEqual([
        "mail is unset but LOG_LEVEL is not allowlisted",
      ]);
    }
    for (const enabled of ["true", "", "False", "0"]) {
      expect(mailLogProblems(new Map([["LOG_ENABLED", enabled]])), enabled).toEqual([
        "mail is unset but LOG_ENABLED is not exactly false",
      ]);
    }
    expect(mailLogProblems(new Map())).toEqual(["mail is unset but LOG_ENABLED is not exactly false"]);
    // One SMTP name unset is enough; with all three set the rule does not apply (C11, C12 and C19 take over).
    const partial = new Map([["PDS_EMAIL_SMTP_URL", "smtps://mail.example.test"]]);
    expect(mailLogProblems(partial)).toEqual(["mail is unset but LOG_ENABLED is not exactly false"]);
    expect(mailLogProblems(new Map(SMTP.map((name) => [name, "x"])))).toEqual([]);
  });

  test("pds_data_is_its_users_named_volume", () => {
    // A fresh named volume takes the owner of the directory it mounts over: /home/node is the node user's (uid 1000,
    // nodejs/docker-node 24/alpine3.23/Dockerfile:5-6), so the PDS can write its data there without running as root.
    const pds = service(dev(), "pds");
    expect(pds.hardening.user).toBe("1000:1000");
    expect(pds.mounts).toEqual([{ type: "volume", source: "pdsdata", target: "/home/node", readOnly: false }]);
    // The data directory is the volume root itself: better-sqlite3 opens a file but never creates its directory, and
    // only the mount point exists in a fresh volume (the first CI start of the stack crashed on /home/node/pds).
    const env = envOf(pds);
    expect(env.get("PDS_DATA_DIRECTORY")).toBe("/home/node");
    expect(env.get("PDS_BLOBSTORE_DISK_LOCATION")?.startsWith("/home/node/")).toBe(true);
  });

  test("no_pds_disable_or_dev_mode_variable", () => {
    // Architecture record 2026-10-13-p129a-pds-and-edge-in-compose ("Also"), the fail-closed twin of F-25: no
    // PDS_DISABLE_SSRF_PROTECTION, no PDS_DEV_MODE and no other PDS switch that turns a protection off, in either
    // compose file's services (verify-903 M1) or in any env template a stack copies from.
    const templates = readdirSync(join(DEPLOYMENT, "env")).filter((file) => file.endsWith(".example.env"));
    expect(templates).toContain("pds.example.env");
    const settings: [string, string][] = [
      ...[...dev().services, ...local().services].flatMap((s) => [...envOf(s)]),
      ...templates.flatMap((file) => envSettings(read(join("env", file)))),
    ];
    expect(settings.map(([name]) => name)).toContain("PDS_HOSTNAME");
    expect(settings.filter(([name, value]) => switchesProtectionOff(name, value))).toEqual([]);
    const off: [string, string][] = [
      ["PDS_DISABLE_SSRF_PROTECTION", "true"],
      ["PDS_DISABLE_SSRF_PROTECTION", "false"],
      ["PDS_DEV_MODE", "true"],
      ["DEV_MODE", "1"],
      ["PDS_EMAIL_DISABLE_CONFIRMATION_LINK", "false"],
      ["PDS_EMAIL_DISABLE_CONFIRMATION_LINK", "TRUE"],
      ["PDS_EMAIL_DISABLE_CONFIRMATION_LINK", "1"],
      ["PDS_EMAIL_DISABLE_CONFIRMATION_LINK", "${X}"],
      ["PDS_EMAIL_DISABLE_CONFIRMATION_LINKS", "true"],
      ["PDS_X_DISABLE_Y", "true"],
    ];
    for (const [name, value] of off) expect(switchesProtectionOff(name, value), `${name}=${value}`).toBe(true);
    const on: [string, string][] = [
      ["PDS_EMAIL_DISABLE_CONFIRMATION_LINK", "true"],
      ["PDS_HOSTNAME", "${PDS_HOSTNAME}"],
      ["PDS_INVITE_REQUIRED", "true"],
      ["LOG_ENABLED", "false"],
    ];
    for (const [name, value] of on) expect(switchesProtectionOff(name, value), `${name}=${value}`).toBe(false);
  });

  test("no_service_answers_for_the_app_or_pds_host", () => {
    // ADR 0031 Decision 3 (P1.37v): under dev the edge carries no aliases, so the PDS and web resolve both staging names
    // through public DNS to Pangolin; and web has no internal host for net-guard, so every host it fetches must resolve
    // to public unicast addresses. The PDS is still never on the app network (architecture 2026-10-15 02:05Z, option C).
    const raw = parseStrictData(read(FILE), FILE) as { services: Record<string, Record<string, unknown>> };
    expect(raw.services.edge?.networks).toEqual({ edge: null, app: null, newt_edge: { ipv4_address: EDGE_ADDRESS } });
    expect(service(dev(), "pds").networks).toEqual(["edge", "pds_egress"]);
    expect(service(dev(), "web").networks).toEqual(["db", "app", "web_egress"]);
    expect(service(dev(), "web").environment.map(([key]) => key)).not.toContain("NETGUARD_INTERNAL_HOSTS");
  });

  test("no_dev_service_trusts_a_dev_root", () => {
    // ADR 0031 Decision 3: no NODE_EXTRA_CA_CERTS anywhere on staging, so no staging service trusts a root of ours.
    for (const s of dev().services) {
      expect(
        s.environment.map(([key]) => key),
        s.name,
      ).not.toContain("NODE_EXTRA_CA_CERTS");
      expect(
        s.mounts.map((m) => m.target),
        s.name,
      ).not.toContain("/etc/unset-dev-trust");
    }
  });

  test("edge_serves_the_dev_sites_and_leaf", () => {
    // P1.36c (ADR 0032 Decisions 1 and 3; book P1.38e shape (b)): three read-only file binds, dev/app.caddy and
    // dev/pds.caddy by name where the image imports sites and dev/tls.caddy over the shipped (tls).
    const edge = service(dev(), "edge");
    expect(edge.mounts.filter((m) => m.type === "bind")).toEqual([
      { type: "bind", source: "./edge/dev/app.caddy", target: "/etc/caddy/sites/enabled/app.caddy", readOnly: true },
      { type: "bind", source: "./edge/dev/pds.caddy", target: "/etc/caddy/sites/enabled/pds.caddy", readOnly: true },
      { type: "bind", source: "./edge/dev/tls.caddy", target: "/etc/caddy/snippets/tls.caddy", readOnly: true },
    ]);
    expect(Object.fromEntries(envOf(edge))).toEqual({
      PDS_HOST: "${PDS_HOSTNAME}",
      PDS_UPSTREAM: "pds:3000",
      ACME_EMAIL: "${EDGE_ACME_EMAIL}",
      APP_HOST: "${APP_HOST}",
      APP_UPSTREAM: "web:8080",
    });
  });

  test("c18_reads_this_files_dev_edge", () => {
    // C18's own reading of this file under dev, as the deploy runs it: the lock's edge image in place of the build, the
    // binds resolved from deployment/, and the edge's env with the ruled staging names. It passes since P1.37v dropped
    // the ports, and a loopback publish put back fails.
    const ref = "registry.example.test/edge@sha256:" + "0".repeat(64);
    const compose = dev();
    const deployed = (ports: Compose["services"][number]["ports"] = []): Compose => ({
      ...compose,
      services: compose.services.map((s) =>
        s.name !== "edge"
          ? s
          : {
              ...s,
              image: ref,
              ports: [...s.ports, ...ports],
              mounts: s.mounts.map((m) =>
                m.type === "bind" && m.source !== null ? { ...m, source: resolve(DEPLOYMENT, m.source) } : m,
              ),
            },
      ),
    });
    const env = new SecretMap([
      ["PDS_HOST", "staging.unset.ac"],
      ["PDS_UPSTREAM", "pds:3000"],
      ["ACME_EMAIL", "edge@example.test"],
      ["APP_HOST", "staging.unset.sh"],
      ["APP_UPSTREAM", "web:8080"],
    ]);
    const edgeDir = join(DEPLOYMENT, "edge");
    expect(edgeZones(deployed(), edgeDir, env, ref, "dev")).toEqual(pass());
    const loopback = [{ hostIp: "127.0.0.1", published: "443", target: "443" }];
    expect(edgeZones(deployed(loopback), edgeDir, env, ref, "dev")).toEqual(
      fail("the edge publishes a port under dev"),
    );
  });

  test("dev_leaf_and_key_reach_only_the_edge", () => {
    // ADR 0032 Decision 1: the leaf's key is a C9 file secret beside the checkout, and only the edge mounts it.
    const compose = dev();
    for (const s of compose.services) {
      const leaf = s.secrets.filter((name) => name.startsWith("dev_tls_"));
      expect(leaf, s.name).toEqual(s.name === "edge" ? ["dev_tls_cert", "dev_tls_key"] : []);
    }
    const raw = parseStrictData(read(FILE), FILE) as { secrets: Record<string, { file: string }> };
    expect(raw.secrets.dev_tls_cert).toEqual({ file: "../../unset-dev-secrets/dev_tls_cert" });
    expect(raw.secrets.dev_tls_key).toEqual({ file: "../../unset-dev-secrets/dev_tls_key" });
  });

  test("scheme_comes_from_configuration", () => {
    // ADR 0031 Decision 2, kept by ADR 0032 Decision 2: web never takes its scheme or host from a request. Its public
    // URLs are https from configuration (C29 refuses plain http outside local), its cookies are Secure, and no server
    // code reads a forwarded scheme or host; the edge sets X-Forwarded-Proto https itself (snippets/upstream.caddy).
    const web = new Map(envOf(service(dev(), "web")));
    expect([web.get("PUBLIC_ORIGIN"), web.get("MEDIA_ORIGIN")]).toEqual([
      "${WEB_PUBLIC_ORIGIN}",
      "${WEB_MEDIA_ORIGIN}",
    ]);
    const example = read("env/dev-public.example.env");
    for (const key of ["WEB_PUBLIC_ORIGIN", "WEB_MEDIA_ORIGIN"])
      expect(example).toMatch(new RegExp(`^${key}=https://`, "m"));
    const sources = ["shared/http", "interfaces/http"].flatMap((dir) =>
      readdirSync(join(DEPLOYMENT, "..", dir), { recursive: true, encoding: "utf8" })
        .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith("test-env.ts"))
        .map((f) => [`${dir}/${f}`, readFileSync(join(DEPLOYMENT, "..", dir, f), "utf8")] as const),
    );
    expect(sources.length).toBeGreaterThan(10);
    for (const [file, text] of sources) {
      expect(text, file).not.toMatch(/x-forwarded-(?:proto|host|scheme)|["'`]forwarded["'`]|\.encrypted\b/i);
    }
    // Every cookie attribute string web writes, wherever it lives (the session, the theme, and sign-in-state.ts's
    // nonce, signed-out, target and issuer cookies), is Secure and HttpOnly.
    const attributes = sources.flatMap(([file, text]) =>
      [...text.matchAll(/"(Path=[^"]*)"/g)].map((match) => [file, match[1] as string] as const),
    );
    expect(attributes.map(([file]) => file)).toEqual(
      expect.arrayContaining([
        "interfaces/http/session-cookie.ts",
        "interfaces/http/prefs/theme.ts",
        "interfaces/http/routes/sign-in-state.ts",
      ]),
    );
    expect(attributes.length).toBeGreaterThanOrEqual(5);
    for (const [file, text] of attributes) {
      expect(text.split("; "), `${file}: ${text}`).toEqual(expect.arrayContaining(["Secure", "HttpOnly"]));
    }
    // The PDS half: @atproto/pds 0.5.37 makes its public URL `https://${hostname}` unless the hostname is localhost
    // (dist/config/config.js:10-13), and it trusts X-Forwarded-Proto from private addresses (dist/index.js:178), which
    // the edge sets to https itself. So its hostname comes from configuration, is never localhost, and nothing in its
    // env names a plain-http URL.
    const pds = new Map(envOf(service(dev(), "pds")));
    expect(pds.get("PDS_HOSTNAME")).toBe("${PDS_HOSTNAME}");
    expect(example).toMatch(/^PDS_HOSTNAME=(?!localhost$)\S+$/m);
    const pdsEnv = [...pds.values(), read("env/pds.example.env")].join("\n");
    expect(pdsEnv).not.toMatch(/http:\/\//i);
    expect(read("edge/snippets/upstream.caddy")).toMatch(/^\t\theader_up X-Forwarded-Proto https$/m);
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
    web_seal_keyring: 65532,
    web_oauth_client_keys: 65532,
    dev_tls_cert: 65532,
    dev_tls_key: 65532,
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
    [join(ENV, "pds.env"), made("file", 0o600, DEPLOY_UID, 4)],
    [join(ENV, "newt.env"), made("file", 0o600, DEPLOY_UID, 5)],
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

  const BASES = join(CHECKOUT, "deployment/images/bases.lock.json");
  const DEPLOY_LOCK = join(CHECKOUT, "deployment/images.lock.json");
  const lockFile = (path: string) => (path === BASES || path === DEPLOY_LOCK ? readFileSync(path, "utf8") : null);
  /** The preflight's inputs for a compose file's text after `edit`, with the real base and deploy locks. */
  const inputsFor = (name: string, flags: string[], edit: (text: string) => string = (text) => text) => {
    const file = join(DEPLOYMENT, name);
    const { inputs } = loadInputs(["--env", "dev", "--compose", file, "--interpolation-env", ENV_FILE, ...flags], {
      root: CHECKOUT,
      run: async () => ({ code: 1, stdout: "", stderr: "" }),
      readText: (path) => (path === file ? edit(read(name)) : lockFile(path)),
      // Each env file as the reader's fstat of it: the virtual file C9 judges (P1.34r).
      readEnv: (path) => {
        const file = virtual.get(path);
        const example = { [ENV_FILE]: "dev-public", [join(ENV, "pds.env")]: "pds", [join(ENV, "newt.env")]: "newt" }[
          path
        ];
        return file === undefined || example === undefined ? null : { text: read(`env/${example}.example.env`), file };
      },
      lstat: look(lstatSync),
      stat: look(statSync),
      realpath,
      readlink: (path) => readlinkSync(path),
      statfs: () => ({ type: 0xef53 }),
      uid: DEPLOY_UID,
      environment: {},
    });
    return inputs;
  };
  const devInputs = (edit?: (text: string) => string) => inputsFor(FILE, [], edit);
  /** compose.dev.source.yaml under --source (P1.37y). */
  const sourceInputs = (edit?: (text: string) => string) => inputsFor(SOURCE, ["--source"], edit);
  /** C9's and C26's outcomes for compose.dev.yaml's text after `edit`. */
  const outcomes = async (edit?: (text: string) => string): Promise<Outcome[]> => {
    const inputs = devInputs(edit);
    const signal = new AbortController().signal;
    return [await c9.run(inputs, signal), await c26.run(inputs, signal)];
  };

  test("compose_dev_pds_neighbours_pass", () => {
    // verify-895 F2: the same neighbour check C17 runs at deploy, on the real file, so CI refuses what C17 would. The
    // PDS is known by the base lock's image and the edge by its Dockerfile (P1.35o, architecture 03:05Z F3).
    expect(pdsNeighbours(devInputs())).toEqual([]);
    const webOnEdge = (text: string) =>
      text.replace("    networks: [db, app, web_egress]\n", "    networks: [db, app, web_egress, edge]\n");
    expect(pdsNeighbours(devInputs(webOnEdge))).toEqual(["web shares a network with the pds"]);
    const renamed = (text: string) =>
      text.replace("\n  pds:\n", "\n  relay:\n").replace("depends_on:\n      pds:", "depends_on:\n      relay:");
    // Renamed, the PDS is still known by its image.
    expect(pdsNeighbours(devInputs((text) => webOnEdge(renamed(text))))).toEqual(["web shares a network with the pds"]);
  });

  test("source_stack_pds_and_edge_are_known_by_their_dockerfiles", async () => {
    // Codex on #1309 (P1.37y): under --source the PDS and the edge build, so C17 and C18 know them by the Dockerfile,
    // not the lock's image. The real source file passes both; a renamed built PDS is still a PDS.
    const inputs = sourceInputs();
    expect(inputs.compose.services.find((s) => s.name === "pds")?.build).not.toBeNull();
    expect(pdsNeighbours(inputs)).toEqual([]);
    const webOnEdge = (text: string) =>
      text.replace("    networks: [db, app, web_egress]\n", "    networks: [db, app, web_egress, edge]\n");
    const renamed = (text: string) =>
      text.replace("\n  pds:\n", "\n  relay:\n").replace("depends_on:\n      pds:", "depends_on:\n      relay:");
    expect(pdsNeighbours(sourceInputs((text) => webOnEdge(renamed(text))))).toEqual([
      "web shares a network with the pds",
    ]);
    // C18 on the built edge: the lock's ref is not consulted, the dev site rules still are.
    const signal = new AbortController().signal;
    const c18Outcome = await c18.run(inputs, signal);
    expect(c18Outcome.reason).not.toMatch(/edge image|not built from/);
    const env = new SecretMap([
      ["PDS_HOST", "staging.unset.ac"],
      ["PDS_UPSTREAM", "pds:3000"],
      ["ACME_EMAIL", "edge@example.test"],
      ["APP_HOST", "staging.unset.sh"],
      ["APP_UPSTREAM", "web:8080"],
    ]);
    const compose: Compose = {
      ...inputs.compose,
      services: inputs.compose.services.map((s) =>
        s.name !== "edge"
          ? s
          : {
              ...s,
              mounts: s.mounts.map((m) =>
                m.type === "bind" && m.source !== null ? { ...m, source: resolve(DEPLOYMENT, m.source) } : m,
              ),
            },
      ),
    };
    expect(edgeZones(compose, join(DEPLOYMENT, "edge"), env, undefined, "dev", true)).toEqual(pass());
    const ref = "registry.example.test/edge@sha256:" + "0".repeat(64);
    expect(edgeZones(compose, join(DEPLOYMENT, "edge"), env, ref, "dev")).toEqual(
      fail("the edge service does not run the lock's edge image"),
    );
  });

  test("c32_passes_on_the_dev_stack", async () => {
    // P1.38d on this file: Alex's legal values (P1.36c) leave no "[to fill:" value for staging to serve, and a token
    // put back fails.
    const signal = new AbortController().signal;
    expect(await c32.run(devInputs(), signal)).toEqual({ pass: true, reason: "ok" });
    const token = (text: string) =>
      text.replace("SUPPORT_EMAIL: support@staging.unset.sh", 'SUPPORT_EMAIL: "[to fill: SUPPORT_EMAIL]"');
    expect((await c32.run(devInputs(token), signal)).pass).toBe(false);
  });

  test("c9_and_c26_pass_on_the_dev_stack", async () => {
    expect(await outcomes()).toEqual([
      { pass: true, reason: "3 files, 11 mounted secrets" },
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
    // The dev stack builds nothing since P2.26b, so a build put back from the wrong context is the case.
    const postgres = `    image: ${readDeployLock().postgres?.ref}\n`;
    const context = (text: string) =>
      text.replace(postgres, "    build:\n      context: .\n      dockerfile: deployment/images/postgres.Dockerfile\n");
    expect((await outcomes(context))[1]).toEqual({
      pass: false,
      reason: "postgres builds from a Dockerfile the images workflow does not scan",
    });
  });
});

describe("Newt in front of the edge (P1.37v; ADR 0030 Decision 2, ADR 0031)", () => {
  type RawNetworks = Record<string, { ipv4_address?: string } | null>;
  const raw = () => parseStrictData(read(FILE), FILE) as { services: Record<string, { networks?: RawNetworks }> };

  test("newt_edge_is_internal_with_only_newt_and_the_edge", () => {
    const network = dev().networks.find((n) => n.name === "newt_edge");
    expect(network).toEqual({ name: "newt_edge", internal: true, subnet: NEWT_SUBNET });
    const members = dev().services.filter((s) => s.networks.includes("newt_edge"));
    expect(members.map((s) => s.name).sort()).toEqual(["edge", "newt"]);
    expect(service(dev(), "newt").networks).toEqual(["newt_egress", "newt_edge"]);
  });

  test("compose_addresses_are_the_edge_configs", () => {
    // The cross reds (P1.37v): the address the edge's dev sites bind and its one trusted proxy, both in
    // deployment/edge (P1.36b, P1.36j), are exactly the addresses this file gives the edge and Newt on newt_edge; the
    // trusted listener is the dev sites' https listener; every zone keys on the client address behind Newt.
    expect([DEV_EDGE_ADDRESS, DEV_PROXY_ADDRESS]).toEqual([EDGE_ADDRESS, NEWT_ADDRESS]);
    expect(DEV_LISTENER).toBe(`${EDGE_ADDRESS}:443`);
    const caddyfile = read("edge/Caddyfile");
    expect(caddyfile).toContain(`\tservers ${EDGE_ADDRESS}:443 {\n\t\ttrusted_proxies static ${NEWT_ADDRESS}/32\n`);
    for (const site of ["app.caddy", "pds.caddy"]) {
      expect(read(`edge/dev/${site}`).match(/^\tbind .*$/gm), site).toEqual([`\tbind ${EDGE_ADDRESS}`]);
    }
    const limits = read("edge/snippets/ratelimit.caddy");
    expect(limits.match(/^\t+key .*$/gm)?.every((line) => line.trim() === "key {client_ip}")).toBe(true);
  });

  test("newt_and_the_edge_have_fixed_addresses_inside_the_subnet", () => {
    // The edge binds its own address (P1.36b) and trusts Newt's alone as a proxy (P1.36j), so both are fixed, distinct,
    // inside the subnet, and neither the network, gateway nor broadcast address.
    const networks = raw().services;
    expect(networks.newt?.networks?.newt_edge).toEqual({ ipv4_address: NEWT_ADDRESS });
    expect(networks.edge?.networks?.newt_edge).toEqual({ ipv4_address: EDGE_ADDRESS });
    const [base = "", bits = ""] = NEWT_SUBNET.split("/");
    const toInt = (ip: string) => ip.split(".").reduce((n, octet) => n * 256 + Number(octet), 0);
    const first = toInt(base);
    const last = first + 2 ** (32 - Number(bits)) - 1;
    for (const address of [NEWT_ADDRESS, EDGE_ADDRESS]) {
      expect(toInt(address), address).toBeGreaterThan(first + 1);
      expect(toInt(address), address).toBeLessThan(last);
    }
    expect(NEWT_ADDRESS).not.toBe(EDGE_ADDRESS);
    // No other service names a fixed address on any network.
    for (const [name, spec] of Object.entries(networks)) {
      if (name === "newt" || name === "edge") continue;
      const attachments = spec.networks !== undefined && !Array.isArray(spec.networks) ? spec.networks : {};
      for (const attachment of Object.values(attachments)) expect(attachment?.ipv4_address, name).toBeUndefined();
    }
  });

  test("newt_runs_as_shipped_with_no_listener_and_no_host_access", () => {
    const newt = service(dev(), "newt");
    expect(newt.image).toBe(`ghcr.io/undefined6799/mirror/newt@${readLock().newt?.digest}`);
    expect(readDeployLock().newt?.upstreamSource).toMatch(/^docker\.io\/fosrl\/newt:1\.18\.1@sha256:[0-9a-f]{64}$/);
    expect(newt.build).toBeNull();
    expect(newt.hardening).toMatchObject({
      readOnly: true,
      capDrop: ["ALL"],
      capAdd: [],
      securityOpt: ["no-new-privileges:true"],
      user: "65532:65532",
    });
    expect([newt.ports, newt.mounts, newt.secrets]).toEqual([[], [], []]);
    expect(newt.envFiles).toEqual(["../../unset-dev-env/newt.env"]);
    // Every setting a literal: no SSH, no client access, no Docker socket, no metrics or pprof listener, and its saved
    // credentials on its tmpfs (newt 1.18.1 newtconfig/newtconfig.go:452-503, websocket/config.go:26-51).
    expect(Object.fromEntries(newt.environment)).toEqual({
      CONFIG_FILE: { literal: "/tmp/newt.json" },
      DISABLE_SSH: { literal: "true" },
      DISABLE_CLIENTS: { literal: "true" },
      NEWT_METRICS_PROMETHEUS_ENABLED: { literal: "false" },
      NEWT_PPROF_ENABLED: { literal: "false" },
      LOG_LEVEL: { literal: "WARN" },
    });
  });
});
