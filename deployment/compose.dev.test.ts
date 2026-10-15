// P1.29, P1.29a: what the development stack's compose file must say, read with the preflight's own parser (no Docker). The
// running stack is P1.29t's; Compose's own reading of this file is compared in compose-parse.test.ts
// (preflight_matches_compose_config walks every compose*.yaml).
import { spawnSync } from "node:child_process";
import { lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync, type Stats, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { VENDOR_IMAGES } from "./images/vendor.ts";
import { c26 } from "./preflight/checks/build.ts";
import { edgeSitesDir } from "./preflight/checks/edge.ts";
import { VENDOR_IMAGES as PREFLIGHT_VENDOR_IMAGES } from "./preflight/checks/images.ts";
import { networkTableProblems, parseNetworkTable, pdsNeighbours } from "./preflight/checks/networks.ts";
import { c9 } from "./preflight/checks/secrets.ts";
import type { Outcome } from "./preflight/checks/types.ts";
import { type Compose, parseCompose, parseStrictData, type Service, TOKEN_READER } from "./preflight/compose-parse.ts";
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
/** A Node service: one built from our Node image, or the PDS, which runs Node too (findings F-32 covers both). */
const runsNode = (s: Service): boolean => nodeBuilt(s) || s.name === "pds";

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
    for (const file of files) {
      for (const s of parseCompose(read(file), file).services) {
        if (s.image !== null) expect(locked.has(s.image) || OWN_IMAGES.has(s.image), `${file} ${s.name}`).toBe(true);
        // Until P1.27s publishes signed images, every service is built here from a scanned Dockerfile, except a
        // run-only image, named exactly as its lock entry, which the mirror workflow scans (P1.29a).
        if (s.build === null) {
          expect(runOnly.has(s.image ?? "") || (file === FILE && isTokenReaderNode(s)), `${file} ${s.name}`).toBe(true);
        }
      }
    }
  });

  test("node_base_runs_unbuilt_only_for_the_token_reader", () => {
    const reader = service(dev(), TOKEN_READER);
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
    const reader = service(dev(), TOKEN_READER);
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
    // The PDS keeps its database at /home/node/pds/account.sqlite, so the reader finds it at /data/pds.
    expect(service(dev(), "pds").mounts).toContainEqual(
      expect.objectContaining({ type: "volume", source: "pdsdata", target: "/home/node" }),
    );
    expect(readFileSync(join(DEPLOYMENT, "..", "tests/support/pds-email-token-read.ts"), "utf8")).toContain(
      'const ACCOUNT_DB = "/data/pds/account.sqlite";',
    );
  });

  test("pds_token_reader_only_in_the_dev_file", () => {
    // Never in a non-dev compose file, and no other service carries a profile (the record, point 1).
    const files = readdirSync(DEPLOYMENT, { recursive: true, encoding: "utf8" }).filter(
      (entry) => /(^|\/)compose[^/]*\.ya?ml$/.test(entry) && !entry.includes("node_modules"),
    );
    for (const file of files) {
      for (const s of parseCompose(read(file), file).services) {
        const allowed = file === FILE && s.name === TOKEN_READER;
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
    for (const s of dev().services) expect(limitProblems(s, runsNode(s)), s.name).toEqual([]);
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

  test("postgres_only_on_internal_networks", () => {
    const compose = dev();
    const internal = new Set(compose.networks.filter((n) => n.internal).map((n) => n.name));
    const postgres = service(compose, "postgres");
    expect(postgres.networks.length).toBeGreaterThan(0);
    for (const network of postgres.networks) expect(internal.has(network), network).toBe(true);
    expect(postgres.ports).toEqual([]);
  });

  test("web_only_on_internal_networks", () => {
    // web has no way out: every network it joins is internal (architecture 02:05Z option C; verify-895 N2).
    const compose = dev();
    const internal = new Set(compose.networks.filter((n) => n.internal).map((n) => n.name));
    const web = service(compose, "web");
    expect(web.networks.length).toBeGreaterThan(0);
    for (const network of web.networks) expect(internal.has(network), network).toBe(true);
    expect(web.ports).toEqual([]);
  });

  test("compose_dev_only_edge_publishes", () => {
    // Only the edge publishes, 80 and 443 on loopback (P1.29a); the homelab's own address is P1.34's.
    for (const s of dev().services) {
      if (s.name === "edge") continue;
      expect(s.ports, s.name).toEqual([]);
    }
    expect(service(dev(), "edge").ports).toEqual([
      { hostIp: "127.0.0.1", published: "80", target: "80" },
      { hostIp: "127.0.0.1", published: "443", target: "443" },
    ]);
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
/**
 * A setting that turns a PDS protection off or puts it in development mode. The one exemption, by exact name and value,
 * is the confirmation-link switch C16 requires (architecture record 2026-10-13-p129a-pds-and-edge-in-compose,
 * Amendment 2; plan section 5.3).
 */
const switchesProtectionOff = (name: string, value: string): boolean => {
  if (name === "PDS_EMAIL_DISABLE_CONFIRMATION_LINK" && value === "true") return false;
  return name.includes("DEV_MODE") || (name.startsWith("PDS_") && name.includes("DISABLE"));
};

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
    // Alex, "Allow pinned" (2026-10-07T13:00:19Z): Bluesky's image, by the lock's exact ref, tag and digest.
    const pds = readLock().pds;
    expect(pds).toBeDefined();
    expect(service(dev(), "pds").image).toBe(`${pds?.ref}:${pds?.tag}@${pds?.digest}`);
    expect(service(dev(), "pds").build).toBeNull();
  });

  test("pds_env_pinned", () => {
    // Step book P1.29 "Services": every PDS setting written out, never left to a default, and the dangerous ones absent.
    const env = envOf(service(dev(), "pds"));
    expect(Object.fromEntries(env)).toEqual({
      PDS_HOSTNAME: "${PDS_HOSTNAME}",
      PDS_SERVICE_HANDLE_DOMAINS: "${PDS_SERVICE_HANDLE_DOMAINS}",
      PDS_PORT: "3000",
      PDS_DATA_DIRECTORY: "/home/node/pds",
      PDS_BLOBSTORE_DISK_LOCATION: "/home/node/pds/blocks",
      PDS_DID_PLC_URL: "https://plc.directory",
      PDS_INVITE_REQUIRED: "true",
      PDS_CRAWLERS: "",
      PDS_RATE_LIMITS_ENABLED: "false",
      PDS_EMAIL_DISABLE_CONFIRMATION_LINK: "true",
      LOG_ENABLED: "false",
      NODE_OPTIONS: "--max-old-space-size=768",
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
    expect(mailLogProblems(envOf(service(dev(), "pds")))).toEqual([]);
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
    const env = envOf(pds);
    for (const name of ["PDS_DATA_DIRECTORY", "PDS_BLOBSTORE_DISK_LOCATION"]) {
      expect(env.get(name)?.startsWith("/home/node/"), name).toBe(true);
    }
  });

  test("no_pds_disable_or_dev_mode_variable", () => {
    // Architecture record 2026-10-13-p129a-pds-and-edge-in-compose ("Also"), the fail-closed twin of F-25: no
    // PDS_DISABLE_SSRF_PROTECTION, no PDS_DEV_MODE and no other PDS switch that turns a protection off, in this file's
    // services or in any env template a stack copies from.
    const templates = readdirSync(join(DEPLOYMENT, "env")).filter((file) => file.endsWith(".example.env"));
    expect(templates).toContain("pds.example.env");
    const settings: [string, string][] = [
      ...dev().services.flatMap((s) => [...envOf(s)]),
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

  test("edge_answers_for_the_app_and_pds_hosts", () => {
    // Architecture record 2026-10-13-p129a-pds-and-edge-in-compose, Amendment 1: the PDS reaches both hosts (it fetches
    // the app's client metadata) through the edge's aliases on the network they share, never extra_hosts or a fixed
    // address; web reaches them the same way on the app network, which the PDS is never on (architecture 2026-10-15
    // 02:05Z, option C). compose-parse refuses aliases anywhere else or with other values
    // (aliases_only_on_the_edges_edge_and_app_networks_with_its_two_hosts).
    const raw = parseStrictData(read(FILE), FILE) as { services: Record<string, Record<string, unknown>> };
    const hosts = { aliases: ["${APP_HOST}", "${PDS_HOSTNAME}"] };
    expect(raw.services.edge?.networks).toEqual({ edge: hosts, app: hosts });
    expect(service(dev(), "pds").networks).toContain("edge");
    expect(service(dev(), "pds").networks).not.toContain("app");
    expect(service(dev(), "web").networks).toEqual(["db", "app"]);
    expect(read("env/dev-public.example.env")).toMatch(/^APP_HOST=\S+$/m);
  });

  test("edge_serves_the_repository_sites", () => {
    // C18's own reading of the mount: a read-only bind of deployment/edge/sites at the directory the image imports.
    const compose = dev();
    const resolved: Compose = {
      ...compose,
      services: compose.services.map((s) => ({
        ...s,
        mounts: s.mounts.map((m) =>
          m.type === "bind" && m.source !== null ? { ...m, source: resolve(DEPLOYMENT, m.source) } : m,
        ),
      })),
    };
    expect(edgeSitesDir(resolved, join(DEPLOYMENT, "edge"))).toEqual({
      dir: realpathSync.native(join(DEPLOYMENT, "edge", "sites")),
    });
    const edge = envOf(service(compose, "edge"));
    expect(Object.fromEntries(edge)).toEqual({
      PDS_HOST: "${PDS_HOSTNAME}",
      PDS_UPSTREAM: "pds:3000",
      ACME_EMAIL: "${EDGE_ACME_EMAIL}",
    });
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
    [join(ENV, "pds.env"), made("file", 0o600, DEPLOY_UID, 4)],
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
  /** The preflight's inputs for compose.dev.yaml's text after `edit`, with the real base lock and no deploy lock. */
  const devInputs = (edit: (text: string) => string = (text) => text) => {
    const file = join(DEPLOYMENT, FILE);
    const { inputs } = loadInputs(["--env", "dev", "--compose", file, "--interpolation-env", ENV_FILE], {
      root: CHECKOUT,
      run: async () => ({ code: 1, stdout: "", stderr: "" }),
      readText: (path) => (path === file ? edit(read(FILE)) : path === BASES ? readFileSync(BASES, "utf8") : null),
      readEnv: (path) =>
        path === ENV_FILE
          ? { text: read("env/dev-public.example.env"), id: `${DEV}:3` }
          : path === join(ENV, "pds.env")
            ? { text: read("env/pds.example.env"), id: `${DEV}:4` }
            : null,
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
    const webOnEdge = (text: string) => text.replace("    networks: [db, app]\n", "    networks: [db, app, edge]\n");
    expect(pdsNeighbours(devInputs(webOnEdge))).toEqual(["web shares a network with the pds"]);
    const renamed = (text: string) =>
      text.replace("\n  pds:\n", "\n  relay:\n").replace("depends_on:\n      pds:", "depends_on:\n      relay:");
    // Renamed, the PDS is still known by its image.
    expect(pdsNeighbours(devInputs((text) => webOnEdge(renamed(text))))).toEqual(["web shares a network with the pds"]);
  });

  test("c9_and_c26_pass_on_the_dev_stack", async () => {
    expect(await outcomes()).toEqual([
      { pass: true, reason: "2 files, 7 mounted secrets" },
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
