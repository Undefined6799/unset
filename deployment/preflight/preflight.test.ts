// P1.30, P1.30s and P1.30t: the deploy preflight against fixture stacks written to a temporary directory (git keeps no file modes, and
// C9 needs 0600). The doubles are the child-process runner, the preflight's one unmanaged dependency (TE-1), and an
// lstat that fakes only what a test cannot set up: file owners other than its own uid, and the temporary directory's
// own parents (P1.30o, P1.27a).

import { execFileSync } from "node:child_process";
import type { Stats } from "node:fs";
import {
  chmodSync,
  cpSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { type Check, fail, type Inputs, missing, pass } from "./checks/types.ts";
import { type Deps, preflight, type Run } from "./index.ts";

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes: number[]): string {
  let value = bytes.reduce((n, b) => n * 256n + BigInt(b), 0n);
  let text = "";
  for (; value > 0n; value /= 58n) text = BASE58[Number(value % 58n)] + text;
  return text;
}
/** A compressed secp256k1 did:key built here, so no key-shaped string sits in the file. */
const RECOVERY_KEY = `did:key:z${base58([0xe7, 0x01, 0x02, ...Array.from({ length: 32 }, (_, i) => i + 1)])}`;
const digest = (c: string) => `sha256:${c.repeat(64)}`;
const EDGE = `ghcr.io/undefined6799/edge@${digest("a")}`;
const PDS = `ghcr.io/undefined6799/mirror/pds@${digest("b")}`;
const WEB = `ghcr.io/undefined6799/web@${digest("d")}`;
const CANARY = "canary-7f3c-never-printed";
const EDGE_DIR = join(import.meta.dirname, "..", "edge");
const REPO = join(import.meta.dirname, "..", "..");

const PDS_ENV: Record<string, string> = {
  PDS_RECOVERY_DID_KEY: RECOVERY_KEY,
  PDS_INVITE_REQUIRED: "true",
  PDS_CRAWLERS: "",
  PDS_ADMIN_PASSWORD: `${CANARY}-${"x".repeat(16)}`,
  PDS_RATE_LIMITS_ENABLED: "false",
  PDS_EMAIL_SMTP_URL: "smtps://mail.example.test:465",
  LOG_ENABLED: "false",
  PDS_SERVICE_HANDLE_DOMAINS: ".pds.example.test",
  PDS_EMAIL_DISABLE_CONFIRMATION_LINK: "true",
  PDS_MODERATION_EMAIL_SMTP_URL: "smtps://mail.example.test:465",
  PDS_MODERATION_EMAIL_ADDRESS: "moderation@example.test",
};
const COMPOSE = `name: unset-prod
services:
  edge:
    image: ${EDGE}
    cap_drop: [ALL]
    cap_add: [NET_BIND_SERVICE]
    ports: ["80:80", "443:443", "127.0.0.1:2019:2019"]
    volumes:
      - ./edge/sites/enabled:/etc/caddy/sites/enabled:ro
    environment:
      PDS_HOST: pds.example.test
      PDS_UPSTREAM: pds:3000
      ACME_EMAIL: edge@example.test
  pds:
    image: ${PDS}
    env_file: ../../unset-dev-env/pds.env
    environment:
      PDS_HOSTNAME: pds.example.test
  web:
    image: ${WEB}
    user: "65532:65532"
    secrets: [db_password]
    environment:
      FINGERPRINT_CHECK: arachnid
secrets:
  db_password:
    file: ../../unset-dev-secrets/db_password
`;
const LOCK = {
  edge: { ref: EDGE, origin: "first-party", verify: "cosign-key" },
  pds: { ref: PDS, origin: "upstream", upstreamSource: "docker.io/example/pds", verify: "cosign-key" },
  web: { ref: WEB, origin: "first-party", verify: "cosign-key" },
};
const DEV = COMPOSE.replace("name: unset-prod", "name: unset-dev");
const DEV_ENV = { PDS_SERVICE_HANDLE_DOMAINS: ".0x40.space" };
const IDS = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10", "C11", "C12"].concat([
  "C13",
  "C14",
  "C15",
  "C16",
  "C17",
  "C18",
  "C19",
  "C20",
  "C21",
  "C22",
  "C23",
  "C24",
  "C25",
  "C26",
  "C27",
]);

type Stack = {
  compose?: string;
  pdsEnv?: Record<string, string | null>;
  lock?: object | null;
  dotEnv?: string;
  report?: string;
  /** The network table, written as both networks.dev.json and networks.prod.json: an object, raw text, or none. */
  networks?: object | string | null;
  /** Extra enabled edge sites, by file name. */
  sites?: Record<string, string>;
  /** Extra files under the root, by repository-relative path (Dockerfiles a build names, P1.30y). */
  files?: Record<string, string>;
};
/** The all-good stack's table: every service on Compose's implicit default network. */
const TABLE = { default: { internal: false, members: ["edge", "pds", "web"] } };
const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** The stack's secrets folder: `unset-dev-secrets` beside the checkout, as the compose file names it. */
const secretsOf = (root: string) => join(dirname(root), "unset-dev-secrets");
/** The folder of the env files Compose reads: `unset-dev-env` beside the checkout. */
const envOf = (root: string) => join(dirname(root), "unset-dev-env");

/** Writes a stack (the all-good one unless overridden) and returns its root and compose path. */
function stack({
  compose = COMPOSE,
  pdsEnv = {},
  lock = LOCK,
  dotEnv,
  report,
  networks = TABLE,
  sites,
  files,
}: Stack = {}) {
  // The checkout and, beside it, the deploy user's secrets folder (P1.27u: never inside the checkout, which C26's
  // root-context builds would send to the daemon).
  const base = mkdtempSync(join(tmpdir(), "preflight-"));
  dirs.push(base);
  const root = join(base, "repo");
  mkdirSync(join(root, "deployment"), { recursive: true });
  mkdirSync(secretsOf(root));
  mkdirSync(envOf(root), { mode: 0o700 });
  chmodSync(envOf(root), 0o700);
  const secret = (path: string, text: string) => {
    writeFileSync(join(root, path), text);
    chmodSync(join(root, path), 0o600);
  };
  const env = Object.entries({ ...PDS_ENV, ...pdsEnv }).flatMap(([k, v]) => (v === null ? [] : [`${k}=${v}\n`]));
  // The env files Compose reads (P1.27u): beside the checkout too, in their own 0700 folder, never in a build context.
  writeFileSync(join(envOf(root), "pds.env"), env.join(""));
  chmodSync(join(envOf(root), "pds.env"), 0o600);
  // A mounted secret (P1.30o): mode 0400 in the deploy user's 0700 directory; fakeFs reads it as owned by web's uid.
  writeFileSync(join(secretsOf(root), "db_password"), `${CANARY}\n`);
  chmodSync(join(secretsOf(root), "db_password"), 0o400);
  chmodSync(secretsOf(root), 0o700);
  // C9 judges every parent of the secrets folder and of each bind source, so the fixture sets its own modes whatever
  // the umask.
  for (const dir of [root, join(root, "deployment")]) chmodSync(dir, 0o755);
  if (dotEnv !== undefined) secret("deployment/.env", dotEnv);
  if (lock !== null) writeFileSync(join(root, "deployment/images.lock.json"), JSON.stringify(lock));
  writeFileSync(join(root, "deployment/cosign.pub"), "public key fixture\n");
  writeFileSync(join(root, "deployment/compose.yaml"), compose);
  // The shipped edge config, with the PDS site enabled the way an environment enables it (C18).
  const edge = join(root, "deployment/edge");
  for (const part of ["Caddyfile", "snippets", "sites"])
    cpSync(join(EDGE_DIR, part), join(edge, part), { recursive: true });
  mkdirSync(join(edge, "sites/enabled"));
  // C9 judges every bind source and its parents too (P1.27u), so these get fixed modes whatever the umask.
  for (const dir of [edge, join(edge, "sites"), join(edge, "sites/enabled")]) chmodSync(dir, 0o755);
  symlinkSync(join(edge, "sites/pds.caddy"), join(edge, "sites/enabled/pds.caddy"));
  for (const [name, text] of Object.entries(sites ?? {})) writeFileSync(join(edge, "sites/enabled", name), text);
  for (const env of ["dev", "prod"]) {
    if (networks === null) continue;
    const table = typeof networks === "string" ? networks : JSON.stringify(networks);
    writeFileSync(join(root, `deployment/networks.${env}.json`), table);
  }
  if (report !== undefined) {
    mkdirSync(join(root, "docs/human/retirement"), { recursive: true });
    writeFileSync(join(root, "docs/human/retirement/retirement-check.json"), report);
  }
  for (const [path, text] of Object.entries(files ?? {})) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return { root, file: join(root, "deployment/compose.yaml") };
}

type Answer = { code: number; stdout: string; stderr: string; missing?: boolean };
type Answers = { verify?: { code: number; stderr: string }; mediaType?: string; ntp?: Answer; chrony?: Answer };
const ok = (stdout: string): Answer => ({ code: 0, stdout, stderr: "" });
const notInstalled: Answer = { code: 1, stdout: "", stderr: "run failed", missing: true };
const SYNCED = ok("yes\n");
const TRACKING = (offset: string) => ok(`Stratum         : 3\nSystem time     : ${offset} seconds fast of NTP time\n`);

/** The process runner double: verify-images passes, every manifest is an OCI index, the clock is synchronised, and
 * every call is recorded. */
function fakeRun(answers: Answers = {}) {
  const calls: string[][] = [];
  const run: Run = async (file, args) => {
    calls.push([file, ...args]);
    if (file === "timedatectl") return answers.ntp ?? SYNCED;
    if (file === "chronyc") return answers.chrony ?? TRACKING("0.000006523");
    if (file === "docker") {
      const mediaType = answers.mediaType ?? "application/vnd.oci.image.index.v1+json";
      return { code: 0, stdout: JSON.stringify({ mediaType }), stderr: "" };
    }
    return { code: 0, stdout: "", stderr: "", ...answers.verify };
  };
  return { run, calls };
}

/** web's uid in the all-good compose, which owns its mounted secret (P1.30o). */
const WEB_UID = 65532;
/**
 * The real lstat with three changes a test cannot make for real (P1.30o, P1.27a):
 * - a directory above the stack's temporary folder reads as that folder itself (mkdtemp's 0700, the test's uid),
 *   because its own parents (often /tmp, sticky and world writable) are not the stack's to judge;
 * - a file inside an unset-dev-secrets/ directory reads as owned by `owner`, since a test cannot chown to another uid;
 * - a path named in `uids` reads as owned by that uid.
 */
function fakeFs(root: string, owner = WEB_UID, uids: Record<string, number> = {}): Pick<Deps, "lstat"> {
  const lstat = (path: string): Stats | null => {
    let info: Stats;
    try {
      const base = dirname(root);
      info = lstatSync(base.startsWith(`${path}/`) || path === "/" ? base : path);
    } catch {
      return null;
    }
    const uid = uids[path] ?? (dirname(path).endsWith("/unset-dev-secrets") ? owner : info.uid);
    return Object.assign(Object.create(Object.getPrototypeOf(info)), info, { uid });
  };
  return { lstat };
}
/** The real stat, or null where there is nothing. */
const statOrNull = (path: string): Stats | null => {
  try {
    return statSync(path);
  } catch {
    return null;
  }
};
/** A stat or lstat that reads the test user's own entries as uid 4242 and `rootOwned` as root's, under any uid. */
const as4242 =
  (read: Deps["lstat"], rootOwned: string) =>
  (path: string): Stats | null => {
    const info = read?.(path) ?? null;
    if (info === null) return null;
    const uid = path === rootOwned ? 0 : info.uid === process.getuid?.() ? 4242 : info.uid;
    return Object.assign(Object.create(Object.getPrototypeOf(info)), info, { uid });
  };
async function check(s: Stack = {}, env = "prod", deps: Partial<Deps> = {}) {
  const { root, file } = stack(s);
  return preflight(["--env", env, "--compose", file], {
    root,
    run: fakeRun().run,
    ...fakeFs(root),
    ...deps,
  });
}
const failed = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL")).map((l) => l.split(" ")[1]);
async function expectOnly(id: string, s: Stack, env = "prod", deps: Partial<Deps> = {}) {
  const result = await check(s, env, deps);
  expect(failed(result.lines)).toEqual([id]);
  expect(result.code).toBe(1);
  return result.lines.find((l) => l.startsWith(`FAIL ${id}`));
}

describe("preflight", () => {
  test("preflight_all_good_passes", async () => {
    const result = await check();
    expect(result.lines.map((l) => l.split(" ").slice(0, 2).join(" "))).toEqual(IDS.map((id) => `PASS ${id}`));
    expect(result.code).toBe(0);
  });

  test("c1_project_name_fails", async () => {
    await expectOnly("C1", { compose: COMPOSE.replace("name: unset-prod", "name: unset-dev") });
    await expectOnly("C1", { compose: COMPOSE.replace("name: unset-prod\n", "") });
  });

  test("c2_image_not_ours_or_unlocked_fails", async () => {
    // Not the lock's edge ref, so C18 fails too (P1.30w), and C25, because the edge adds a capability (P1.30x).
    for (const image of [
      `docker.io/library/caddy@${digest("a")}`,
      "ghcr.io/undefined6799/edge:latest",
      `ghcr.io/undefined6799/edge@${digest("c")}`,
    ]) {
      const result = await check({ compose: COMPOSE.replace(EDGE, image) });
      expect(failed(result.lines), image).toEqual(["C2", "C18", "C25"]);
      expect(result.code, image).toBe(1);
    }
  });

  test("missing_input_fails_check_not_run", async () => {
    const result = await check({ lock: null });
    expect(result.lines.find((l) => l.startsWith("FAIL C2"))).toMatch(/^FAIL C2 input missing: .*images\.lock\.json$/);
    // C18 reads the lock's edge ref (P1.30w), and C25 does for the edge's cap_add (P1.30x), so both fail closed with
    // the lock too, and without the edge entry alone.
    expect(failed(result.lines)).toEqual(["C2", "C3", "C4", "C5", "C18", "C25"]);
    expect(result.code).toBe(1);
    const { edge: _, ...noEdge } = LOCK;
    const unlisted = (await check({ lock: noEdge })).lines;
    expect(failed(unlisted)).toEqual(["C2", "C18", "C25"]);
    expect(unlisted).toContain("FAIL C18 input missing: the lock's edge entry");
  });

  test("c3_c4_signature_fails", async () => {
    const edge = fakeRun({ verify: { code: 1, stderr: "edge: signature does not verify: bad\n" } });
    expect(await expectOnly("C3", {}, "prod", { run: edge.run })).toContain("edge: signature does not verify");
    const pds = fakeRun({ verify: { code: 1, stderr: "pds: signature does not verify: bad\n" } });
    await expectOnly("C4", {}, "prod", { run: pds.run });
    // A failure that names no entry (a spawn error) fails both.
    const both = await check({}, "prod", { run: fakeRun({ verify: { code: 1, stderr: "" } }).run });
    expect(failed(both.lines)).toEqual(["C3", "C4"]);
  });

  test("c5_platform_manifest_fails", async () => {
    const { run } = fakeRun({ mediaType: "application/vnd.oci.image.manifest.v1+json" });
    await expectOnly("C5", {}, "prod", { run });
  });

  test("network_check_times_out_and_fails", async () => {
    const run: Run = (_file, _args, signal) =>
      new Promise((done) => signal.addEventListener("abort", () => done({ code: 1, stdout: "", stderr: "" })));
    const result = await check({}, "prod", { run, timeoutMs: 20 });
    // C4 shares C3's verifier run, so it fails on that run's aborted answer rather than its own clock.
    expect(failed(result.lines)).toEqual(["C3", "C4", "C5", "C24"]);
    const timedOut = result.lines.filter((l) => l.endsWith("timed out")).map((l) => l.split(" ")[1]);
    expect(timedOut).toEqual(["C3", "C5", "C24"]);
  });

  test("c6_recovery_key_fails", async () => {
    expect(await expectOnly("C6", { pdsEnv: { PDS_RECOVERY_DID_KEY: null } })).toContain("cannot be added");
    // An Ed25519 did:key (multicodec 0xed): a valid did:key, but not a type the PDS accepts for rotation.
    const ed25519 = `did:key:z${base58([0xed, 0x01, ...Array.from({ length: 32 }, (_, i) => i + 1)])}`;
    await expectOnly("C6", { pdsEnv: { PDS_RECOVERY_DID_KEY: ed25519 } });
    await expectOnly("C6", { pdsEnv: { PDS_RECOVERY_DID_KEY: "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa" } });
  });

  test("c7_settings_fail", async () => {
    await expectOnly("C7", { pdsEnv: { PDS_INVITE_REQUIRED: "false" } });
    await expectOnly("C7", { pdsEnv: { PDS_ADMIN_PASSWORD: "short" } });
    await expectOnly("C7", { compose: DEV, pdsEnv: { ...DEV_ENV, PDS_CRAWLERS: "https://bsky.network" } }, "dev");
    await expectOnly("C7", { compose: DEV, pdsEnv: { ...DEV_ENV, PDS_CRAWLERS: null } }, "dev");
  });

  test("c7_pds_rate_limits_enabled_fails", async () => {
    await expectOnly("C7", { pdsEnv: { PDS_RATE_LIMITS_ENABLED: "true" } });
    await expectOnly("C7", { pdsEnv: { PDS_RATE_LIMITS_ENABLED: "False" } });
  });

  test("c7_pds_rate_limits_unset_fails", async () => {
    expect(await expectOnly("C7", { pdsEnv: { PDS_RATE_LIMITS_ENABLED: null } })).toBe(
      "FAIL C7 PDS_RATE_LIMITS_ENABLED does not turn the PDS's own limits off",
    );
  });

  test("c8_any_bypass_var_fails", async () => {
    for (const [name, value] of [
      ["PDS_RATE_LIMIT_BYPASS_KEY", "k"],
      ["PDS_RATE_LIMIT_BYPASS_IPS", "198.51.100.2"],
      ["PDS_RATE_LIMIT_BYPASS_IPS", "198.51.100.4"],
      ["PDS_RATE_LIMIT_BYPASS_IPS", "198.51.100.0/24"],
      ["PDS_RATE_LIMIT_BYPASS_IPS", ""],
    ] as const) {
      expect(await expectOnly("C8", { pdsEnv: { [name]: value } })).toBe(`FAIL C8 ${name} is set in pds`);
    }
    // In any service, not only the PDS.
    const edgeEnv = COMPOSE.replace("      ACME_EMAIL: edge@example.test", "$&\n      PDS_RATE_LIMIT_BYPASS_KEY: x");
    await expectOnly("C8", { compose: edgeEnv });
  });

  // P1.30o: files Compose itself reads keep the deploy user's 0600 (architecture record 2026-10-12-c9-secret-file-owner).
  test("c9_compose_read_file_fails", async () => {
    for (const env of ["dev", "prod"]) {
      const { root, file } = stack(env === "dev" ? { compose: DEV, pdsEnv: DEV_ENV } : {});
      const run = (deps: Partial<Deps> = {}) =>
        preflight(["--env", env, "--compose", file], {
          root,
          run: fakeRun().run,
          ...fakeFs(root),
          ...deps,
        });
      const pdsEnv = join(envOf(root), "pds.env");
      for (const mode of [0o644, 0o400]) {
        chmodSync(pdsEnv, mode);
        expect((await run()).lines).toContain(`FAIL C9 ${pdsEnv} must have exactly owner read and write permissions`);
      }
      chmodSync(pdsEnv, 0o600);
      expect(failed((await run()).lines)).toEqual([]);
      // An env file owned by root, which C9's walk allows, is still not the deploy user's. Whoever runs the test
      // reads as deploy user 4242, so this holds as root and as CI's runner alike.
      const other = await run({
        uid: 4242,
        lstat: as4242(fakeFs(root).lstat, pdsEnv),
        stat: as4242(statOrNull, pdsEnv),
      });
      expect(other.lines.filter((l) => l.includes(" C9 "))).toEqual([
        `FAIL C9 ${pdsEnv} is not owned by the deploy user`,
      ]);
    }
    const absent = await check({ compose: COMPOSE.replace("secrets/db_password", "secrets/absent") });
    expect(failed(absent.lines)).toEqual(["C9"]);
    // Every file Compose reads is judged hop by hop too, and a second hard link would carry it past C26's path test
    // (Amendment 6).
    const { root, file } = stack();
    const pdsEnv = join(envOf(root), "pds.env");
    const run = (uids: Record<string, number> = {}) =>
      preflight(["--env", "prod", "--compose", file], { root, run: fakeRun().run, ...fakeFs(root, WEB_UID, uids) });
    linkSync(pdsEnv, join(dirname(root), "pds.env.copy"));
    expect((await run()).lines).toContain(`FAIL C9 ${pdsEnv} has more than one hard link`);
    rmSync(join(dirname(root), "pds.env.copy"));
    expect((await run({ [envOf(root)]: 2000 })).lines).toContain(
      `FAIL C9 ${pdsEnv} lies on a path that another user can change`,
    );
    renameSync(pdsEnv, join(envOf(root), "real.env"));
    symlinkSync("real.env", pdsEnv);
    expect(failed((await run()).lines)).toEqual([]);
    expect((await run({ [pdsEnv]: 2000 })).lines).toContain(
      `FAIL C9 ${pdsEnv} lies on a path that another user can change`,
    );
  });

  // P1.34p: no file Compose reads values or secrets from sits inside the project directory, where the checkout's
  // committed fixtures live; the reason names no path.
  test("c9_secret_inputs_outside_project", async () => {
    const inside = "FAIL C9 an env or secret file is inside the Compose project directory";
    const fixture = { "deployment/edge/edge.test.env": "EDGE_HOST=edge.example.test\n" };
    const envInside = COMPOSE.replace("../../unset-dev-env/pds.env", "edge/edge.test.env");
    expect((await check({ compose: envInside, files: fixture })).lines).toContain(inside);
    // The same file reached through a link that lives outside the project.
    const viaLink = stack({ files: fixture });
    symlinkSync(join(viaLink.root, "deployment/edge/edge.test.env"), join(envOf(viaLink.root), "dev.env"));
    writeFileSync(viaLink.file, COMPOSE.replace("../../unset-dev-env/pds.env", "../../unset-dev-env/dev.env"));
    const linked = await preflight(["--env", "prod", "--compose", viaLink.file], {
      root: viaLink.root,
      run: fakeRun().run,
      ...fakeFs(viaLink.root),
    });
    expect(linked.lines).toContain(inside);
    // A mounted secret inside the project.
    const secretInside = COMPOSE.replace("../../unset-dev-secrets/db_password", "edge/edge.test.env");
    expect((await check({ compose: secretInside, files: fixture })).lines).toContain(inside);
    // A real env file beside the checkout passes.
    const { root, file } = stack();
    writeFileSync(join(envOf(root), "dev.env"), readFileSync(join(envOf(root), "pds.env")));
    chmodSync(join(envOf(root), "dev.env"), 0o600);
    writeFileSync(file, COMPOSE.replace("../../unset-dev-env/pds.env", "../../unset-dev-env/dev.env"));
    const beside = await preflight(["--env", "prod", "--compose", file], { root, run: fakeRun().run, ...fakeFs(root) });
    expect(failed(beside.lines)).toEqual([]);
  });

  // P1.34p Amendment 2, item 1: a bind may not reach the env folder or any file Compose reads values from.
  test("c9_bind_reaching_env_inputs_fails", async () => {
    const reach = "FAIL C9 edge binds a path that reaches an env file or the env folder";
    const bind = (source: string) =>
      COMPOSE.replace("./edge/sites/enabled:/etc/caddy/sites/enabled:ro", `${source}:/srv/x:ro`);
    for (const source of ["../../unset-dev-env", "../../unset-dev-env/pds.env"]) {
      expect((await check({ compose: bind(source) })).lines, source).toContain(reach);
    }
    // Through a link that lives inside the project: judged where it resolves.
    const { root, file } = stack({ compose: bind("./envlink") });
    symlinkSync(envOf(root), join(root, "deployment/envlink"));
    const linked = await preflight(["--env", "prod", "--compose", file], { root, run: fakeRun().run, ...fakeFs(root) });
    expect(linked.lines).toContain(reach);
    // The project directory holds a non-empty .env, so binding it reaches that file.
    expect((await check({ compose: bind("."), dotEnv: "HOST_NAME=pds.example.test\n" })).lines).toContain(reach);
    // Another file in the env folder: no env file is under it, but it lies inside the env folder.
    const other = stack({ compose: bind("../../unset-dev-env/notes") });
    writeFileSync(join(envOf(other.root), "notes"), "not read by Compose\n");
    const inFolder = await preflight(["--env", "prod", "--compose", other.file], {
      root: other.root,
      run: fakeRun().run,
      ...fakeFs(other.root),
    });
    expect(inFolder.lines).toContain(reach);
  });

  // P1.34p Amendment 2, item 2: an env file is read only as a regular file, and only as the file C9 then judges.
  test("c9_env_file_read_safely", { timeout: 10_000 }, async () => {
    const { root, file } = stack();
    const pdsEnv = join(envOf(root), "pds.env");
    rmSync(pdsEnv);
    execFileSync("mkfifo", ["-m", "600", pdsEnv]);
    // A FIFO with no writer would block a plain read for ever; the preflight stops instead.
    const fifo = await preflight(["--env", "prod", "--compose", file], { root, run: fakeRun().run, ...fakeFs(root) });
    expect(fifo).toEqual({ code: 2, lines: [`ERROR ${pdsEnv} is not a regular file`] });
    // A file swapped after it was read: C9 sees another (dev, ino) than the one the values came from.
    const swapped = stack();
    const swappedEnv = join(envOf(swapped.root), "pds.env");
    const readEnv = (path: string) => (path === swappedEnv ? { text: readFileSync(path, "utf8"), id: "0:0" } : null);
    const result = await preflight(["--env", "prod", "--compose", swapped.file], {
      root: swapped.root,
      run: fakeRun().run,
      ...fakeFs(swapped.root),
      readEnv,
    });
    expect(result.lines).toContain(`FAIL C9 ${swappedEnv} changed after the preflight read it`);
  });

  // P1.34p Amendment 2, item 3: FUSE (FUSE_SUPER_MAGIC, linux/magic.h) is refused beside procfs.
  test("c9_fuse_refused", async () => {
    const FUSE = 0x65735546;
    const { root, file } = stack();
    const onFuse = (where: string) =>
      preflight(["--env", "prod", "--compose", file], {
        root,
        run: fakeRun().run,
        ...fakeFs(root),
        statfs: (path) => ({ type: path === where ? FUSE : 0xef53 }),
      });
    for (const where of [secretsOf(root), dirname(secretsOf(root))]) {
      expect((await onFuse(where)).lines, where).toContain("FAIL C9 the secrets folder is on FUSE");
    }
    expect((await onFuse(envOf(root))).lines).toContain(
      `FAIL C9 ${join(envOf(root), "pds.env")} lies on a path through a FUSE file system`,
    );
    expect((await onFuse(join(root, "deployment/edge/sites/enabled"))).lines).toContain(
      "FAIL C9 edge binds a path through a FUSE file system",
    );
  });

  // P1.30o: a mounted secret is mode 0400, owned by the one uid that mounts it, in a 0700 directory of the deploy user.
  test("c9_mounted_secret_owner_and_mode", async () => {
    const path = (root: string) => join(secretsOf(root), "db_password");
    const { root, file } = stack();
    const run = (owner = WEB_UID) =>
      preflight(["--env", "prod", "--compose", file], { root, run: fakeRun().run, ...fakeFs(root, owner) });
    expect(failed((await run()).lines)).toEqual([]);
    const deployUid = process.getuid?.() ?? -1;
    expect((await run(deployUid)).lines).toContain(
      `FAIL C9 ${path(root)} is not owned by uid ${WEB_UID}, the user of web`,
    );
    for (const mode of [0o600, 0o440, 0o404, 0o4400]) {
      chmodSync(path(root), mode);
      expect((await run()).lines).toContain(`FAIL C9 ${path(root)} must have mode 0400`);
    }
  });

  test("c9_secrets_directory_locked", async () => {
    const { root, file } = stack();
    const dir = secretsOf(root);
    const run = (uids: Record<string, number> = {}) =>
      preflight(["--env", "prod", "--compose", file], { root, run: fakeRun().run, ...fakeFs(root, WEB_UID, uids) });
    const locked = `FAIL C9 ${dir} must be a directory with mode 0700 owned by the deploy user`;
    // Group or other access, and the setgid or sticky bit, on the folder itself.
    for (const mode of [0o755, 0o710, 0o2700, 0o1700]) {
      chmodSync(dir, mode);
      expect((await run()).lines).toContain(locked);
    }
    chmodSync(dir, 0o700);
    expect(failed((await run()).lines)).toEqual([]);
    // The folder owned by another user.
    expect((await run({ [dir]: 4242 })).lines).toContain(locked);
    // A parent another user could write, or owns, lets them swap the folder. The sticky bit does not make a shared
    // parent safe: others can still create entries in it (architecture, 2026-10-12, overruling P1.30o).
    const parent = "FAIL C9 parent 1 of the secrets folder can be changed by another user";
    const base = dirname(dir);
    for (const mode of [0o777, 0o775, 0o1777]) {
      chmodSync(base, mode);
      expect((await run()).lines).toContain(parent);
    }
    chmodSync(base, 0o700);
    expect((await run({ [base]: 4242 })).lines).toContain(parent);
    expect((await run({ [dirname(base)]: 4242 })).lines).toContain(
      "FAIL C9 parent 2 of the secrets folder can be changed by another user",
    );
    expect(failed((await run({ [dirname(base)]: 0 })).lines)).toEqual([]);
    // A secrets folder on procfs, known by its filesystem type (architecture, Amendment 2 of the P1.27u record).
    for (const onProc of [dir, base]) {
      const procfs = await preflight(["--env", "prod", "--compose", file], {
        root,
        run: fakeRun().run,
        ...fakeFs(root),
        statfs: (path) => ({ type: path === onProc ? 0x9fa0 : 0xef53 }),
      });
      expect(procfs.lines).toContain("FAIL C9 the secrets folder is on procfs");
    }
    // The walk reaches "/" itself.
    const depth = dir.split("/").length - 1;
    expect((await run({ "/": 4242 })).lines).toContain(
      `FAIL C9 parent ${depth} of the secrets folder can be changed by another user`,
    );
    const other = await check({}, "prod", { uid: 4242 });
    expect(other.lines.find((l) => l.startsWith("FAIL C9"))).toMatch(
      /must be a directory with mode 0700 owned by the deploy user$/,
    );
  });

  // P1.27a: the folder is judged where it really is. Docker resolves a bind source again at every start, so a link
  // anywhere on the path lets whoever controls its target swap the secret after the preflight passed.
  test("c9_secrets_path_has_no_links", async () => {
    const linkedFolder = stack();
    const dir = secretsOf(linkedFolder.root);
    renameSync(dir, `${dir}-real`);
    symlinkSync(`${dir}-real`, dir);
    const folder = await preflight(["--env", "prod", "--compose", linkedFolder.file], {
      root: linkedFolder.root,
      run: fakeRun().run,
      ...fakeFs(linkedFolder.root),
    });
    expect(folder.lines).toContain(`FAIL C9 ${dir} must be a directory with mode 0700 owned by the deploy user`);
    // A deploy-owned link above the folder, pointing into a tree another user controls.
    const linkedParent = stack({
      compose: COMPOSE.replace("../../unset-dev-secrets/", "../../linked/unset-dev-secrets/"),
    });
    const elsewhere = join(dirname(linkedParent.root), "elsewhere");
    mkdirSync(elsewhere, { mode: 0o700 });
    renameSync(secretsOf(linkedParent.root), join(elsewhere, "unset-dev-secrets"));
    symlinkSync(elsewhere, join(dirname(linkedParent.root), "linked"));
    const parent = await preflight(["--env", "prod", "--compose", linkedParent.file], {
      root: linkedParent.root,
      run: fakeRun().run,
      ...fakeFs(linkedParent.root),
    });
    expect(parent.lines).toContain("FAIL C9 parent 1 of the secrets folder is a link or not a directory");
  });

  test("c9_mounted_secret_readers", async () => {
    const pdsReads = (user: string) =>
      COMPOSE.replace(
        "    env_file: ../../unset-dev-env/pds.env",
        `    env_file: ../../unset-dev-env/pds.env\n${user}    secrets: [db_password]`,
      );
    const secret = (root: string) => join(secretsOf(root), "db_password");
    // Two services with different uids.
    const two = await check({ compose: pdsReads('    user: "1000:1000"\n') });
    expect(two.lines.find((l) => l.startsWith("FAIL C9"))).toMatch(/db_password is mounted by more than one uid$/);
    // A mounting service with no user: the image default is invisible to the preflight.
    const none = await check({ compose: pdsReads("") });
    expect(none.lines.find((l) => l.startsWith("FAIL C9"))).toMatch(
      /^FAIL C9 pds mounts .*db_password but sets no user$/,
    );
    // Declared but mounted by nobody.
    const unmounted = await check({ compose: COMPOSE.replace("    secrets: [db_password]\n", "") });
    expect(unmounted.lines.find((l) => l.startsWith("FAIL C9"))).toMatch(
      /db_password is declared but no service mounts it$/,
    );
    // A symlinked secret.
    const { root, file } = stack();
    rmSync(secret(root));
    writeFileSync(join(dirname(root), "real"), "x\n");
    symlinkSync(join(dirname(root), "real"), secret(root));
    const linked = await preflight(["--env", "prod", "--compose", file], {
      root,
      run: fakeRun().run,
      ...fakeFs(root),
    });
    expect(linked.lines).toContain(`FAIL C9 ${secret(root)} is empty, a link or not a file`);
    // P1.27a: a second hard link outside the locked folder reaches the same file.
    const hard = stack();
    linkSync(secret(hard.root), join(hard.root, "deployment/copy"));
    const twice = await preflight(["--env", "prod", "--compose", hard.file], {
      root: hard.root,
      run: fakeRun().run,
      ...fakeFs(hard.root),
    });
    expect(twice.lines).toContain(`FAIL C9 ${secret(hard.root)} has more than one hard link`);
  });

  // P1.27a (architecture, Amendment 2): secrets reach containers only through `secrets:`. A bind mount whose real
  // source is the secrets folder, lies inside it, or contains it would hand the files over with no owner check.
  test("c9_bind_mount_reaching_secrets_fails", async () => {
    const binding = (source: string) =>
      COMPOSE.replace(
        "    env_file: ../../unset-dev-env/pds.env",
        `    env_file: ../../unset-dev-env/pds.env\n    volumes:\n      - ${source}:/srv:ro`,
      );
    // "/" and a ".." chain that Compose resolves to "/" contain every folder (verifier on #689).
    for (const source of [
      "../../unset-dev-secrets",
      "../../unset-dev-secrets/db_password",
      "../..",
      "/",
      "../../../../../../../../../..",
    ]) {
      const result = await check({ compose: binding(source) });
      expect(result.lines.find((l) => l.startsWith("FAIL C9"))).toBe(
        "FAIL C9 pds binds a path that reaches the secrets folder",
      );
    }
    // A link elsewhere in the project that resolves into the folder.
    const { root, file } = stack({ compose: binding("./alias") });
    symlinkSync(secretsOf(root), join(root, "deployment/alias"));
    const linked = await preflight(["--env", "prod", "--compose", file], { root, run: fakeRun().run, ...fakeFs(root) });
    expect(linked.lines).toContain("FAIL C9 pds binds a path that reaches the secrets folder");
    const rooted = stack({ compose: binding("./rootlink") });
    symlinkSync("/", join(rooted.root, "deployment/rootlink"));
    const toRoot = await preflight(["--env", "prod", "--compose", rooted.file], {
      root: rooted.root,
      run: fakeRun().run,
      ...fakeFs(rooted.root),
    });
    expect(toRoot.lines).toContain("FAIL C9 pds binds a path that reaches the secrets folder");
    // A source C9 cannot resolve (EACCES, ELOOP) fails the check rather than falling back to the path as written.
    const denied = () => {
      throw Object.assign(new Error("denied"), { code: "EACCES" });
    };
    const unresolved = await check({ compose: binding("./edge/sites") }, "prod", { realpath: denied });
    expect(unresolved.lines).toContain("FAIL C9 check error");
    // A real self-loop with the default realpath: ELOOP must throw, not read as missing (P1.27u).
    const looped = stack({ compose: binding("./loop") });
    symlinkSync("loop", join(looped.root, "deployment/loop"));
    const loop = await preflight(["--env", "prod", "--compose", looped.file], {
      root: looped.root,
      run: fakeRun().run,
      ...fakeFs(looped.root),
    });
    expect(loop.lines).toContain("FAIL C9 check error");
    // A link whose target reads `x/..` after another link: the kernel follows x first and then takes its real parent;
    // Node's JavaScript realpathSync collapses `x/..` as text (path.resolve), so C9 asks realpath(3) (verifier B3).
    const viaParent = async (x: string, y: string, setUp: (deployment: string) => void = () => undefined) => {
      const s = stack({ compose: binding("./y") });
      const deployment = join(s.root, "deployment");
      symlinkSync(x, join(deployment, "x"));
      symlinkSync(y, join(deployment, "y"));
      setUp(deployment);
      return preflight(["--env", "prod", "--compose", s.file], { root: s.root, run: fakeRun().run, ...fakeFs(s.root) });
    };
    expect((await viaParent("/", "x/..")).lines).toContain("FAIL C9 pds binds a path that reaches the secrets folder");
    // An empty decoy where the text says the folder is; the kernel reaches the real one beside the checkout.
    const decoy = (d: string) => mkdirSync(join(d, "unset-dev-secrets"), { mode: 0o700 });
    expect((await viaParent("../../unset-dev-env", "x/../unset-dev-secrets", decoy)).lines).toContain(
      "FAIL C9 pds binds a path that reaches the secrets folder",
    );
    // A link the JavaScript resolver chases for ever: as text, `x/../imgs` is imgs itself, so it loops; the kernel
    // follows x to data/sub, takes its real parent and finds data/imgs. The bind is judged there and returns.
    const s = stack({ compose: binding("./imgs") });
    mkdirSync(join(s.root, "deployment/data/sub"), { recursive: true });
    mkdirSync(join(s.root, "deployment/data/imgs"));
    symlinkSync("data/sub", join(s.root, "deployment/x"));
    symlinkSync("x/../imgs", join(s.root, "deployment/imgs"));
    const chased = await preflight(["--env", "prod", "--compose", s.file], {
      root: s.root,
      run: fakeRun().run,
      ...fakeFs(s.root),
    });
    expect(failed(chased.lines)).not.toContain("C9");
    // A link the kernel itself cannot resolve (ELOOP) fails the check.
    const kernelLoop = stack({ compose: binding("./imgs") });
    mkdirSync(join(kernelLoop.root, "deployment/sub"));
    symlinkSync("sub/../imgs", join(kernelLoop.root, "deployment/imgs"));
    const loops = await preflight(["--env", "prod", "--compose", kernelLoop.file], {
      root: kernelLoop.root,
      run: fakeRun().run,
      ...fakeFs(kernelLoop.root),
    });
    expect(loops.lines).toContain("FAIL C9 check error");
    // A link into the folder whose target does not exist yet: Compose would create it there (P1.27u).
    const dangling = stack({ compose: binding("./dangle") });
    symlinkSync("../../unset-dev-secrets/newdir", join(dangling.root, "deployment/dangle"));
    const dangle = await preflight(["--env", "prod", "--compose", dangling.file], {
      root: dangling.root,
      run: fakeRun().run,
      ...fakeFs(dangling.root),
    });
    expect(dangle.lines).toContain("FAIL C9 pds binds a path that does not exist");
    // A sibling whose name only starts with the folder's name is not inside it.
    const sibling = stack({ compose: binding("../../unset-dev-secrets-old") });
    mkdirSync(`${secretsOf(sibling.root)}-old`, { mode: 0o755 });
    chmodSync(`${secretsOf(sibling.root)}-old`, 0o755);
    const old = await preflight(["--env", "prod", "--compose", sibling.file], {
      root: sibling.root,
      run: fakeRun().run,
      ...fakeFs(sibling.root),
    });
    expect(failed(old.lines)).toEqual([]);
    // A second name for the folder that no link explains (a host bind mount): matched by (dev, ino), both ways.
    const aliased = stack({ compose: binding("/srv/alias") });
    const folder = secretsOf(aliased.root);
    const asFolder = (path: string) => statSync(path === "/srv/alias" ? folder : path);
    const alias = await preflight(["--env", "prod", "--compose", aliased.file], {
      root: aliased.root,
      run: fakeRun().run,
      ...fakeFs(aliased.root),
      realpath: (path) => path,
      stat: (path) => (path === "/srv/alias" || path.startsWith(dirname(folder)) ? asFolder(path) : null),
    });
    expect(alias.lines).toContain("FAIL C9 pds binds a path that reaches the secrets folder");
    // Each layer alone must catch what it owns (P1.27u, the verifier's surviving mutants on #689).
    const aliasing = async (source: string, names: Record<string, string | null>) => {
      const s = stack({ compose: binding(source) });
      const real = secretsOf(s.root);
      const named = Object.fromEntries(
        Object.entries(names).map(([path, to]) => [
          path,
          to === null ? null : to.replace("PARENT", dirname(real)).replace("FOLDER", real),
        ]),
      );
      return preflight(["--env", "prod", "--compose", s.file], {
        root: s.root,
        run: fakeRun().run,
        ...fakeFs(s.root),
        realpath: (path) => path,
        stat: (path) => {
          const to = path in named ? named[path] : path;
          return to === null || to === undefined ? null : statSync(to);
        },
      });
    };
    const reaches = "FAIL C9 pds binds a path that reaches the secrets folder";
    // The folder's parent under another name: only the folder's ancestor line holds its identity.
    expect((await aliasing("/srv/up", { "/srv/up": "PARENT" })).lines).toContain(reaches);
    // A child, not there yet, under another name for the folder: only the source's ancestor line holds it.
    expect(
      (await aliasing("/srv/alias/newdir", { "/srv/alias": "FOLDER", "/srv/alias/newdir": null })).lines,
    ).toContain(reaches);
    // Path containment alone, with no identities to compare.
    for (const source of ["../../unset-dev-secrets", "../../unset-dev-secrets/db_password", "../..", "/"]) {
      const s = stack({ compose: binding(source) });
      const blind = await preflight(["--env", "prod", "--compose", s.file], {
        root: s.root,
        run: fakeRun().run,
        ...fakeFs(s.root),
        stat: (path) => (path.endsWith(".env") ? statSync(path) : null),
      });
      expect(blind.lines).toContain(reaches);
    }
    expect(failed((await check({ compose: binding("./edge/sites") })).lines)).toEqual([]);
  });

  // P1.27u (architecture record 2026-10-12-p127u-bind-ancestors-and-build-context, (a)): every bind source, read-only
  // or not, exists and sits where only root and the deploy user can change it, or another user could swap it later.
  test("c9_bind_source_path_locked", async () => {
    const binding = (source: string) =>
      COMPOSE.replace(
        "    env_file: ../../unset-dev-env/pds.env",
        `    env_file: ../../unset-dev-env/pds.env
    volumes:
      - ${source}:/srv:ro`,
      );
    const changeable = "FAIL C9 pds binds a path that another user can change";
    const run = async (
      source: string,
      setUp: (deployment: string) => Record<string, number> | undefined,
      deps: Partial<Deps> = {},
    ) => {
      const s = stack({ compose: binding(source) });
      const deployment = join(s.root, "deployment");
      mkdirSync(join(deployment, "data/shared"), { recursive: true });
      for (const dir of ["data", "data/shared"]) chmodSync(join(deployment, dir), 0o755);
      const uids = setUp(deployment) ?? {};
      return preflight(["--env", "prod", "--compose", s.file], {
        root: s.root,
        run: fakeRun().run,
        ...fakeFs(s.root, WEB_UID, uids),
        ...deps,
      });
    };
    expect(failed((await run("./data/shared", () => undefined)).lines)).toEqual([]);
    const otherOwner = await run("./data/shared", (d) => ({ [join(d, "data")]: 2000 }));
    expect(otherOwner.lines).toContain(changeable);
    // A service's own data folder (uid 999, often an unrelated host account) is refused as a bind source; the same
    // mount as a named volume passes (architecture, Amendment 1 of the record above).
    const serviceOwned = await run("./data/shared", (d) => ({ [join(d, "data/shared")]: 999 }));
    expect(serviceOwned.lines).toContain(changeable);
    const volume = COMPOSE.replace(
      "    env_file: ../../unset-dev-env/pds.env",
      "    env_file: ../../unset-dev-env/pds.env\n    volumes:\n      - pgdata:/srv",
    ).concat("volumes:\n  pgdata: {}\n");
    expect(failed((await check({ compose: volume })).lines)).toEqual([]);
    const sticky = await run("./data/shared", (d) => void chmodSync(join(d, "data"), 0o1777));
    expect(sticky.lines).toContain(changeable);
    const sourceItself = await run("./data/shared", (d) => void chmodSync(join(d, "data/shared"), 0o775));
    expect(sourceItself.lines).toContain(changeable);
    // A link on the path as written is followed through its real path, where a writable folder is caught.
    const throughLink = await run("./via/inner", (d) => {
      mkdirSync(join(d, "open/inner"), { recursive: true });
      chmodSync(join(d, "open"), 0o777);
      chmodSync(join(d, "open/inner"), 0o755);
      symlinkSync(join(d, "open"), join(d, "via"));
    });
    expect(throughLink.lines).toContain(changeable);
    // The link itself must be theirs as well.
    const foreignLink = await run("./via", (d) => {
      symlinkSync(join(d, "data/shared"), join(d, "via"));
      return { [join(d, "via")]: 2000 };
    });
    expect(foreignLink.lines).toContain(changeable);
    // Every hop between the path as written and its real path is judged too (Amendment 6): a deploy-owned link to a
    // link that another user owns, in a folder of theirs, which they re-point at the secrets folder after the run.
    const evil = (d: string) => {
      mkdirSync(join(d, "evil"));
      chmodSync(join(d, "evil"), 0o755);
      symlinkSync(join(d, "data/shared"), join(d, "evil/l"));
      return { [join(d, "evil")]: 2000, [join(d, "evil/l")]: 2000 };
    };
    const twoHops = await run("./cfg", (d) => {
      const uids = evil(d);
      symlinkSync(join(d, "evil/l"), join(d, "cfg"));
      return uids;
    });
    expect(twoHops.lines).toContain(changeable);
    // The same hop in the middle of the path.
    const midPath = await run("./d/shared", (d) => {
      const uids = evil(d);
      rmSync(join(d, "evil/l"));
      symlinkSync(join(d, "data"), join(d, "evil/l"));
      symlinkSync("evil/l", join(d, "d"));
      return uids;
    });
    expect(midPath.lines).toContain(changeable);
    // A clean chain of deploy-owned links, relative and absolute, passes; 40 hops pass and the 41st fails (Linux
    // follows at most 40, man7.org path_resolution(7)).
    const chain = (hops: number) => (d: string) => {
      symlinkSync(join(d, "data/shared"), join(d, "h0"));
      for (let i = 1; i < hops; i++) symlinkSync(`h${i - 1}`, join(d, `h${i}`));
      return undefined;
    };
    expect(failed((await run("./h2", chain(3))).lines)).toEqual([]);
    expect(failed((await run("./h39", chain(40))).lines)).toEqual([]);
    // The 41st hop: realpath's own ELOOP fails the check first; with realpath out of the way, the walk's limit holds.
    expect((await run("./h40", chain(41))).lines).toContain("FAIL C9 check error");
    expect((await run("./h40", chain(41), { realpath: (path) => path })).lines).toContain(
      "FAIL C9 pds binds a path through too many links",
    );
    // A file is not a folder to go on through: the kernel answers ENOTDIR for `file/..`.
    const throughFile = await run("./up", (d) => {
      writeFileSync(join(d, "data/f"), "x\n");
      symlinkSync("data/f/..", join(d, "up"));
    });
    expect(throughFile.lines).toContain("FAIL C9 pds binds a path that does not exist");
    // A trailing `/` or `/.` on a link target asks for a folder too (Codex on this PR).
    for (const target of ["data/f/", "data/f/."]) {
      const slash = await run("./up", (d) => {
        writeFileSync(join(d, "data/f"), "x\n");
        symlinkSync(target, join(d, "up"));
      });
      expect(slash.lines).toContain("FAIL C9 pds binds a path that does not exist");
    }
    // A group-writable file is changeable too, not only a folder.
    const openFile = await run("./data/f", (d) => {
      writeFileSync(join(d, "data/f"), "x\n");
      chmodSync(join(d, "data/f"), 0o664);
    });
    expect(openFile.lines).toContain(changeable);
    // A relative `..` in a link target goes up a folder.
    expect(failed((await run("./pp", (d) => void symlinkSync("data/shared/../shared", join(d, "pp")))).lines)).toEqual(
      [],
    );
    // Neither a socket, a device nor a FIFO is a bind source.
    const fifo = await run("./data/fifo", (d) => void execFileSync("mkfifo", ["-m", "0644", join(d, "data/fifo")]));
    expect(fifo.lines).toContain("FAIL C9 pds binds a path that is not a file or directory");
    expect((await run("./nowhere", () => undefined)).lines).toContain("FAIL C9 pds binds a path that does not exist");
    // /proc resolves in the preflight's own context, not the container's.
    const underProc = "FAIL C9 pds binds a path under /proc";
    for (const source of ["/proc/self/cwd", "/proc"]) {
      expect((await run(source, () => undefined)).lines).toContain(underProc);
    }
    // A link into /proc is refused by its target's name, even where statfs would not say procfs (Amendment 6).
    const notProc = { statfs: () => ({ type: 0xef53 }) };
    const intoProc = (target: (d: string) => string) => (d: string) => void symlinkSync(target(d), join(d, "p"));
    for (const target of [() => "/proc/self/cwd", (d: string) => `/proc/self/root${d}/data/shared`]) {
      expect((await run("./p", intoProc(target), notProc)).lines).toContain(underProc);
    }
    // procfs under another name is known by its filesystem type, wherever the walk enters it (Amendment 2).
    const PROC = 0x9fa0;
    const alias = await run(
      "./p",
      (d) => {
        mkdirSync(join(d, "data/pp"));
        chmodSync(join(d, "data/pp"), 0o755);
        symlinkSync("data/pp/self/cwd", join(d, "p"));
      },
      { statfs: (path) => ({ type: path.endsWith("/data/pp") ? PROC : 0xef53 }) },
    );
    expect(alias.lines).toContain(underProc);
    for (const onProc of ["/deployment/data/shared", "/deployment/data"]) {
      const statfs = (path: string) => ({ type: path.endsWith(onProc) ? PROC : 0xef53 });
      expect((await run("./data/shared", () => undefined, { statfs })).lines).toContain(underProc);
    }
    const throwing = {
      statfs: () => {
        throw Object.assign(new Error("denied"), { code: "EACCES" });
      },
    };
    expect((await run("./data/shared", () => undefined, throwing)).lines).toContain("FAIL C9 check error");
  });

  // P1.30o: every mounted secret shares one locked folder, so one directory check covers them all.
  test("c9_mounted_secrets_share_one_folder", async () => {
    const second = COMPOSE.replace("    secrets: [db_password]", "    secrets: [db_password, api_key]").replace(
      "    file: ../../unset-dev-secrets/db_password\n",
      "    file: ../../unset-dev-secrets/db_password\n  api_key:\n    file: ../../other/api_key\n",
    );
    const { root, file } = stack({ compose: second });
    mkdirSync(join(dirname(root), "other"), { mode: 0o700 });
    writeFileSync(join(dirname(root), "other/api_key"), "key\n", { mode: 0o400 });
    const result = await preflight(["--env", "prod", "--compose", file], { root, run: fakeRun().run, ...fakeFs(root) });
    expect(result.lines).toContain("FAIL C9 mounted secrets are not all in one directory");
  });

  test("c10_published_port_fails", async () => {
    await expectOnly("C10", { compose: COMPOSE.replace('"127.0.0.1:2019:2019"', '"2019:2019"') });
    const pdsPort = COMPOSE.replace(
      "    env_file: ../../unset-dev-env/pds.env",
      '    env_file: ../../unset-dev-env/pds.env\n    ports: ["127.0.0.1:443:3000"]',
    );
    await expectOnly("C10", { compose: pdsPort });
    const range = COMPOSE.replace(
      "    env_file: ../../unset-dev-env/pds.env",
      '    env_file: ../../unset-dev-env/pds.env\n    ports: ["0.0.0.0:3000:3000"]',
    );
    await expectOnly("C10", { compose: range });
  });

  test("c11_smtp_fails", async () => {
    await expectOnly("C11", { pdsEnv: { PDS_EMAIL_SMTP_URL: null } });
    await expectOnly("C11", { pdsEnv: { PDS_EMAIL_SMTP_URL: "smtp://mail.example.test:587" } });
    await expectOnly("C11", { pdsEnv: { PDS_EMAIL_SMTP_URL: "smtp://mailpit:1025" } });
    await expectOnly("C11", {
      pdsEnv: { PDS_EMAIL_SMTP_URL: "smtps://mail.example.test?tls.rejectUnauthorized=false" },
    });
    const tls = await check({ pdsEnv: { PDS_EMAIL_SMTP_URL: "smtp://mail.example.test:587?requireTLS=true" } });
    expect(failed(tls.lines)).toEqual([]);
    const mailpit = await check(
      { compose: DEV, pdsEnv: { ...DEV_ENV, PDS_EMAIL_SMTP_URL: "smtp://mailpit:1025" } },
      "dev",
    );
    expect(failed(mailpit.lines)).toEqual([]);
  });

  test("c12_log_enabled_fails", async () => {
    expect(await expectOnly("C12", { pdsEnv: { LOG_ENABLED: "true" } })).toContain("pds-debug-logging.md");
    // The reason names the key, never a value it can take, so the runner's scrub leaves it whole (P1.30j).
    for (const on of ["on", "off", "1", "yes", "no", "true"]) {
      expect(await expectOnly("C12", { pdsEnv: { LOG_ENABLED: on } }), on).toBe(
        "FAIL C12 LOG_ENABLED differs from the required literal; see docs/human/runbooks/pds-debug-logging.md",
      );
    }
    const unset = await check({ pdsEnv: { LOG_ENABLED: null } });
    expect(failed(unset.lines)).toEqual([]);
  });

  test("c12_log_level_outside_allowlist_fails", async () => {
    // LOG_LEVEL is absent or one of five levels; debug and trace log personal data even with logging off for requests.
    for (const level of ["debug", "trace", "INFO", ""]) {
      expect(await expectOnly("C12", { pdsEnv: { LOG_LEVEL: level } })).toBe(
        "FAIL C12 LOG_LEVEL is not one of the allowed levels",
      );
    }
    for (const level of ["info", "warn", "error", "fatal", "silent"]) {
      expect(failed((await check({ pdsEnv: { LOG_LEVEL: level } })).lines)).toEqual([]);
    }
  });

  test("environment_overrides_env_file_and_interpolates_dotenv", async () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Compose interpolation text, not a JS template.
    const compose = COMPOSE.replace("      PDS_HOSTNAME:", "      LOG_ENABLED: ${LOG}\n      PDS_HOSTNAME:");
    await expectOnly("C12", { compose, dotEnv: "LOG=true\n" });
    expect(failed((await check({ compose, dotEnv: "LOG=false\n" })).lines)).toEqual([]);
  });

  test("preflight_never_prints_secrets", async () => {
    const outputs = await Promise.all([
      check(),
      check({ pdsEnv: { PDS_ADMIN_PASSWORD: CANARY } }),
      check({ pdsEnv: { PDS_EMAIL_SMTP_URL: `smtp://user:${CANARY}@mail.example.test` } }),
      check({ pdsEnv: { PDS_MODERATION_EMAIL_SMTP_URL: `smtp://user:${CANARY}@mail.example.test` } }),
      check({ pdsEnv: { PDS_LEXICON_AUTHORITY_DID: CANARY, PDS_MOD_SERVICE_URL: CANARY } }),
      check({ pdsEnv: { PDS_RATE_LIMIT_BYPASS_KEY: CANARY } }),
      check({ pdsEnv: { PDS_RECOVERY_DID_KEY: CANARY } }),
      check({}, "prod", { checks: [{ id: "CX", run: () => Promise.reject(new Error(CANARY)) }] }),
    ]);
    for (const { lines } of outputs) expect(lines.join("\n")).not.toContain(CANARY);
  });

  // P1.30m (record 2026-10-12-p130m-preflight-withhold; architecture, end of 2026-10-12-c18-follow-ups): replacing a
  // value inside a reason leaked across maps, against fixed text and through the template, so the runner withholds a
  // whole reason that holds any value the run read, and prints no part of it.
  const WITHHELD = "reason withheld (it contained a configured value)";
  test("runner_withholds_a_reason_holding_any_configured_value", async () => {
    const quote = (text: (inputs: Inputs) => string, outcome = fail): Check => ({
      id: "CX",
      run: (inputs) => outcome(text(inputs)),
    });
    const read = (inputs: Inputs, service: string, name: string) =>
      inputs.serviceEnv.get(service)?.use(name, (v) => v) ?? "";
    // Two maps whose values overlap (N-A): naming the shorter one used to leave the longer one's tail.
    const overlap = COMPOSE.replace("      PDS_HOSTNAME: pds.example.test", "      A: shared-value").replace(
      "      FINGERPRINT_CHECK: arachnid",
      "      FINGERPRINT_CHECK: arachnid\n      B: shared-value-tail",
    );
    const both = quote((i) => `${read(i, "pds", "A")} ${read(i, "web", "B")}`);
    expect((await check({ compose: overlap }, "prod", { checks: [both] })).lines).toEqual([`FAIL CX ${WITHHELD}`]);
    // A value one check read and kept, printed by a later check (N-D), and an `.env` value no service names.
    let kept = "";
    const keep: Check = {
      id: "CK",
      run: (i) => {
        kept = read(i, "pds", "PDS_HOSTNAME");
        return pass();
      },
    };
    const later = quote(() => `host ${kept} is wrong`);
    expect((await check({}, "prod", { checks: [keep, later] })).lines).toEqual(["PASS CK ok", `FAIL CX ${WITHHELD}`]);
    const dotEnvOnly = quote(() => "token dotenv-only-value");
    expect((await check({ dotEnv: "TOKEN=dotenv-only-value\n" }, "prod", { checks: [dotEnvOnly] })).lines).toEqual([
      `FAIL CX ${WITHHELD}`,
    ]);
    // A missing input and a passing reason are withheld the same way; the verdicts and the exit code stand.
    const absent = quote((i) => read(i, "pds", "PDS_HOSTNAME"), missing);
    expect(await check({}, "prod", { checks: [absent] })).toEqual({
      code: 1,
      lines: [`FAIL CX input missing: ${WITHHELD}`],
    });
    const passing = quote((i) => read(i, "web", "FINGERPRINT_CHECK"), pass);
    expect(await check({}, "prod", { checks: [passing] })).toEqual({ code: 0, lines: [`PASS CX ${WITHHELD}`] });
    // A configured value inside the replacement text itself (Codex review on #627): the reason is left empty.
    const marked = { dotEnv: "TOKEN=dotenv-only-value\nMARK=withheld\nWORD=missing\n" };
    expect((await check(marked, "prod", { checks: [dotEnvOnly] })).lines).toEqual(["FAIL CX "]);
    const absentMarked = quote(() => "dotenv-only-value", missing);
    expect(await check(marked, "prod", { checks: [absentMarked] })).toEqual({ code: 1, lines: ["FAIL CX "] });
    expect(await check(marked, "prod", { checks: [dotEnvOnly] })).toEqual({ code: 1, lines: ["FAIL CX "] });
    // A value only the missing-input prefix holds empties that reason too (P1.30z rider).
    const prefixOnly = { dotEnv: "TOKEN=dotenv-only-value\nWORD=input\n" };
    expect(await check(prefixOnly, "prod", { checks: [absentMarked] })).toEqual({ code: 1, lines: ["FAIL CX "] });
  });

  test("password_probe_is_withheld_whole", async () => {
    // N-C: a password equal to a word of C7's own text used to come back as that text with the word renamed.
    const result = await check({ pdsEnv: { PDS_ADMIN_PASSWORD: "short" } });
    expect(result.code).toBe(1);
    expect(result.lines.filter((l) => l.startsWith("FAIL"))).toEqual([`FAIL C7 ${WITHHELD}`]);
    expect(result.lines.join("\n")).not.toContain("PDS_ADMIN_PASSWORD");
  });

  test("c18_sentinel_withheld_end_to_end", async () => {
    // The edge reader's own scrub (P1.30h) is the first layer; the runner withholds whatever still holds a value.
    const sentinel = "sentinelhost.example.test";
    const compose = COMPOSE.replace("      PDS_HOST: pds.example.test", `      PDS_HOST: ${sentinel}`);
    const result = await check({ compose, sites: { "probe.caddy": '"{$PDS_HOST}" {\n\trespond 204\n}\n' } });
    expect(failed(result.lines)).toContain("C18");
    expect(result.lines.join("\n")).not.toContain(sentinel);
  });

  test("preflight_no_skip_flag", async () => {
    const { root, file } = stack();
    for (const argv of [
      ["--env", "prod", "--compose", file, "--skip", "C3"],
      ["--env", "prod", "--compose", file, "C3"],
      ["--env", "staging", "--compose", file],
      ["--env", "prod"],
      // Compose resolves relative paths from --project-directory when given, which the preflight cannot see (P1.30z).
      ["--env", "prod", "--compose", file, "--project-directory", root],
      ["--env", "prod", "--compose", file, `--project-directory=${root}`],
      ["--env", "prod", "--compose", file, "--workdir", root],
      ["--env", "prod", "--compose", file, `--workdir=${root}`],
    ]) {
      expect((await preflight(argv, { root, run: fakeRun().run })).code).toBe(2);
    }
  });

  // P1.27a (architecture, Amendment 3): Compose resolves a relative --compose against $PWD, Node against the physical
  // cwd, so the two can name different trees. The preflight takes only an absolute, normal path, the one both use.
  test("compose_path_must_be_absolute_and_normal", async () => {
    const { root, file } = stack();
    const refused = { code: 2, lines: ["ERROR --compose must be an absolute, normalised path"] };
    // The usage line says so too (verifier on #689): cli.test.ts usage_names_absolute_paths.
    const dir = dirname(file);
    for (const path of [
      relative(process.cwd(), file),
      `${dir}/../deployment/compose.yaml`,
      `${dir}/./compose.yaml`,
      `${file}/`,
    ]) {
      expect(
        await preflight(["--env", "prod", "--compose", path], { root, run: fakeRun().run, ...fakeFs(root) }),
      ).toEqual(refused);
    }
    // A link on the path the caller names is walked, not resolved away: here another user's link, which the edge's
    // bind source then crosses as written.
    const linked = join(root, "via");
    symlinkSync(dir, linked);
    const viaLink = await preflight(["--env", "prod", "--compose", join(linked, "compose.yaml")], {
      root,
      run: fakeRun().run,
      ...fakeFs(root, WEB_UID, { [linked]: 2000 }),
    });
    expect(viaLink.lines).toContain("FAIL C9 edge binds a path that another user can change");
  });

  test("no_repository_script_passes_project_directory", () => {
    // Every script that runs `docker compose` gives it the file list the preflight read, and never moves the base
    // directory (architecture record 2026-10-12-preflight-project-directory, item 3). Docs and tests may name the flags.
    // `--workdir` is Compose's hidden, deprecated alias for the same option (cmd/compose/compose.go in 2.38.2, v5.3.1).
    // The match is a plain substring, so `docker run --workdir` or `docker compose run --workdir` in a script fails
    // too. That over-match is deliberate and fails closed: telling Compose's top-level flag from a subcommand's needs a
    // parse of every argv a script builds. A script that sets a container's working directory writes `-w`, which
    // Compose's top level does not take: both flags are StringVar with no shorthand (compose.go :229-230 in 2.38.2,
    // :231-232 in v5.3.1).
    const flags = [["--project", "directory"].join("-"), ["--work", "dir"].join("")];
    const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: REPO, encoding: "utf8" }).split("\0");
    const scripts = tracked.filter((path) => path !== "" && !/(^docs\/|\.md$|\.test\.ts$)/.test(path));
    const offenders = scripts.filter((path) => {
      const text = readFileSync(join(REPO, path), "latin1");
      return flags.some((flag) => text.includes(flag));
    });
    expect(offenders).toEqual([]);
  });

  test("preflight_check_throws_fails_closed", async () => {
    const throws: Check = {
      id: "CX",
      run: () => {
        throw new Error("boom");
      },
    };
    const result = await check({}, "prod", { checks: [throws] });
    expect(result).toEqual({ code: 1, lines: ["FAIL CX check error"] });
  });

  test("preflight_does_not_call_docker_compose_config", async () => {
    const { run, calls } = fakeRun();
    await check({}, "prod", { run });
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call).not.toContain("compose");
    expect(calls.map((call) => call.slice(0, 2))).toContainEqual(["docker", "buildx"]);
  });

  test("unreadable_env_file_cannot_run", async () => {
    const result = await check({
      compose: COMPOSE.replace("env_file: ../../unset-dev-env/pds.env", "env_file: absent.env"),
    });
    expect(result.code).toBe(2);
    expect(result.lines[0]).toMatch(/^ERROR cannot read .*absent\.env$/);
    const loose = await check({ pdsEnv: { PDS_HOSTNAME: '"quoted"' } });
    expect(loose.code).toBe(2);
  });

  test("volume_declared_in_another_compose_file_cannot_run", async () => {
    // Each file declares the named volumes it mounts (architecture, 2026-10-12): Compose would merge the files, the
    // preflight refuses, and the same empty declaration in both files is fine.
    const files: Record<string, string> = {
      "/s/a.yaml": "name: unset-prod\nservices:\n  edge:\n    image: x\nvolumes:\n  data: {}\n",
      "/s/b.yaml": "services:\n  pds:\n    image: x\n    volumes: [data:/data]\n",
    };
    const readText = (path: string) => files[path] ?? null;
    const argv = ["--env", "prod", "--compose", "/s/a.yaml", "--compose", "/s/b.yaml"];
    const split = await preflight(argv, { root: "/s", run: fakeRun().run, readText });
    expect(split).toEqual({ code: 2, lines: ["ERROR /s/b.yaml:4: volume data is not declared"] });
    files["/s/b.yaml"] += "volumes:\n  data: {}\n";
    expect((await preflight(argv, { root: "/s", run: fakeRun().run, readText })).lines[0]).not.toMatch(/^ERROR/);
  });

  test("secret_declared_in_two_compose_files_cannot_run", async () => {
    // P1.27a: Compose merges a secret name across files, the last file winning, and mounts the winner into services
    // from both files; the preflight would judge each file's own path. It refuses the name twice, as for networks.
    const declare = "secrets:\n  token:\n    file: secrets/token\n";
    const files: Record<string, string> = {
      "/s/a.yaml": `name: unset-prod\nservices:\n  edge:\n    image: x\n    secrets: [token]\n${declare}`,
      "/s/b.yaml": `services:\n  pds:\n    image: x\n${declare.replace("secrets/token", "other/token")}`,
    };
    const readText = (path: string) => files[path] ?? null;
    const argv = ["--env", "prod", "--compose", "/s/a.yaml", "--compose", "/s/b.yaml"];
    const result = await preflight(argv, { root: "/s", run: fakeRun().run, readText });
    expect(result).toEqual({ code: 2, lines: ["ERROR secret token is defined twice"] });
  });
});

const SENTINEL = "sentinel-5d2e-never-printed";
/** Every variable name a check quotes, so a check that starts reading a new one is covered without editing a list. */
function checkedNames(): string[] {
  const dir = join(import.meta.dirname, "checks");
  const names = new Set(Object.keys(PDS_ENV));
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
    for (const [, name] of readFileSync(join(dir, file), "utf8").matchAll(/"([A-Z][A-Z0-9_]{3,})"/g)) {
      if (name !== undefined) names.add(name);
    }
  }
  return [...names];
}
/** The all-good compose with `env` in both the pds and the web service's environment. */
function inEnvironment(env: Record<string, string>): string {
  const lines = Object.entries(env)
    .map(([k, v]) => `      ${k}: "${v}"`)
    .join("\n");
  return COMPOSE.replace("      PDS_HOSTNAME: pds.example.test", lines).replace(
    "      FINGERPRINT_CHECK: arachnid",
    lines,
  );
}

describe("preflight C13 to C24 (P1.30s)", () => {
  const withEnv = (lines: string) => COMPOSE.replace("      PDS_HOSTNAME: pds.example.test", lines);
  const host = (name: string) => withEnv(`      PDS_HOSTNAME: ${name}`);

  test("c13_lexicon_authority_did_fails", async () => {
    await expectOnly("C13", { pdsEnv: { PDS_LEXICON_AUTHORITY_DID: "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa" } });
    await expectOnly("C13", { pdsEnv: { PDS_LEXICON_AUTHORITY_DID: "" } });
  });

  test("c14_dev_mode_fails", async () => {
    await expectOnly("C14", { pdsEnv: { PDS_DEV_MODE: "true" } });
    await expectOnly("C14", { pdsEnv: { PDS_DEV_MODE: "1" } });
    expect(failed((await check({ pdsEnv: { PDS_DEV_MODE: "false" } })).lines)).toEqual([]);
  });

  test("c15_handle_domain_0x40_me_fails", async () => {
    await expectOnly("C15", { pdsEnv: { PDS_SERVICE_HANDLE_DOMAINS: ".pds.example.test,.0x40.me" } });
    await expectOnly("C15", { pdsEnv: { PDS_SERVICE_HANDLE_DOMAINS: null } });
    await expectOnly("C15", { compose: DEV, pdsEnv: { PDS_SERVICE_HANDLE_DOMAINS: ".pds.example.test" } }, "dev");
    expect(failed((await check({ compose: DEV, pdsEnv: DEV_ENV }, "dev")).lines)).toEqual([]);
  });

  test("c16_confirmation_link_required", async () => {
    await expectOnly("C16", { pdsEnv: { PDS_EMAIL_DISABLE_CONFIRMATION_LINK: null } });
    await expectOnly("C16", { pdsEnv: { PDS_EMAIL_DISABLE_CONFIRMATION_LINK: "false" } });
  });

  test("c19_moderation_mail_missing_fails", async () => {
    await expectOnly("C19", { pdsEnv: { PDS_MODERATION_EMAIL_SMTP_URL: null } });
    await expectOnly("C19", { pdsEnv: { PDS_MODERATION_EMAIL_ADDRESS: null } });
    await expectOnly("C19", { pdsEnv: { PDS_MODERATION_EMAIL_SMTP_URL: "smtp://mailpit:1025" } });
    const dev = { ...DEV_ENV, PDS_MODERATION_EMAIL_SMTP_URL: "smtp://mailpit:1025" };
    expect(failed((await check({ compose: DEV, pdsEnv: dev }, "dev")).lines)).toEqual([]);
  });

  test("c20_mod_service_set_fails", async () => {
    await expectOnly("C20", { pdsEnv: { PDS_MOD_SERVICE_URL: "https://mod.example.test" } });
    await expectOnly("C20", { pdsEnv: { PDS_MOD_SERVICE_DID: "did:web:mod.example.test" } });
    expect(failed((await check({ pdsEnv: { PDS_REPORT_SERVICE_URL: "https://r.example.test" } })).lines)).toEqual([]);
  });

  test("c21_part_a_incomplete_fails", async () => {
    const old = host("0x40.space");
    expect(await expectOnly("C21", { compose: old })).toMatch(/input missing: .*retirement-check\.json$/);
    await expectOnly("C21", { compose: old, report: '{"retirement_part_a_complete": false}' });
    await expectOnly("C21", { compose: old, report: '{"retirement_part_a_complete": "true"}' });
    // Duplicate keys are refused by the strict reader rather than read as the last one.
    const twice = '{"retirement_part_a_complete": false, "retirement_part_a_complete": true}';
    await expectOnly("C21", { compose: old, report: twice });
    const done = await check({ compose: old, report: '{"retirement_part_a_complete": true}' });
    expect(failed(done.lines)).toEqual([]);
  });

  test("c21_hostname_case_and_trailing_dot", async () => {
    // A hostname is case-insensitive and may end in one root dot, so these name the old host too.
    for (const name of ["0X40.space", "0x40.SPACE", "0x40.space."]) {
      expect(await expectOnly("C21", { compose: host(name) })).toMatch(/input missing: .*retirement-check\.json$/);
    }
    expect((await check({ compose: host("pds.0x40.space") })).lines).toContain(
      "PASS C21 skipped: PDS_HOSTNAME is unset or a different host",
    );
  });

  test("c15_subdomain_entry_refused", async () => {
    await expectOnly("C15", { pdsEnv: { PDS_SERVICE_HANDLE_DOMAINS: ".pds.example.test,x.0x40.me" } });
    await expectOnly("C15", { pdsEnv: { PDS_SERVICE_HANDLE_DOMAINS: ".x.0x40.me" } });
  });

  test("c22_non_integer_video_max_fails", async () => {
    for (const max of ["2e9", "-1", "0x10", "1.5"]) {
      const compose = withEnv(`      PDS_HOSTNAME: pds.example.test\n      VIDEO_MASTER_MAX_BYTES: "${max}"`);
      expect(await expectOnly("C22", { compose, pdsEnv: { PDS_BLOB_UPLOAD_LIMIT: "4000000000" } })).toBe(
        "FAIL C22 VIDEO_MASTER_MAX_BYTES is not an integer",
      );
    }
  });

  test("c23_no_service_sets_fingerprint_check", async () => {
    const compose = COMPOSE.replace("    environment:\n      FINGERPRINT_CHECK: arachnid\n", "");
    expect(await expectOnly("C23", { compose })).toBe(
      "FAIL C23 no service sets FINGERPRINT_CHECK to the real fingerprint service",
    );
  });

  test("c24_time_tool_exit_nonzero_fails", async () => {
    const exit = { code: 1, stdout: "", stderr: "" };
    expect(await expectOnly("C24", {}, "prod", { run: fakeRun({ ntp: exit }).run })).toBe(
      "FAIL C24 timedatectl failed",
    );
    expect(await expectOnly("C24", {}, "prod", { run: fakeRun({ chrony: exit }).run })).toBe(
      "FAIL C24 chronyc tracking failed",
    );
  });

  test("failure_reasons_never_contain_secret_values", async () => {
    // Every variable a check names gets the sentinel, alone and appended to its good value, in the PDS env file and
    // in the pds and web services' environment; with the passing stack too, no output line may hold it.
    const names = checkedNames();
    const each = (value: (name: string) => string) => Object.fromEntries(names.map((n) => [n, value(n)]));
    const alone = each(() => SENTINEL);
    const appended = each((n) => `${PDS_ENV[n] ?? ""}${SENTINEL}`);
    const passing = {
      PDS_ADMIN_PASSWORD: `${SENTINEL}-${"x".repeat(16)}`,
      PDS_EMAIL_SMTP_URL: `smtps://user:${SENTINEL}@mail.example.test:465`,
      PDS_MODERATION_EMAIL_SMTP_URL: `smtps://user:${SENTINEL}@mail.example.test:465`,
    };
    const good = await check({ pdsEnv: passing });
    expect(failed(good.lines)).toEqual([]);
    const bad = ["prod", "dev"].flatMap((env) =>
      [alone, appended].flatMap((pdsEnv) => [check({ pdsEnv }, env), check({ compose: inEnvironment(pdsEnv) }, env)]),
    );
    const outputs = await Promise.all(bad);
    expect(outputs.map(({ code }) => code)).toEqual(outputs.map(() => 1));
    for (const { lines } of [good, ...outputs]) expect(lines.join("\n")).not.toContain(SENTINEL);
  });

  test("c22_blob_limit_below_master_fails", async () => {
    const master = withEnv("      PDS_HOSTNAME: pds.example.test\n      VIDEO_MASTER_MAX_BYTES: 2000000000");
    await expectOnly("C22", { compose: master });
    await expectOnly("C22", { compose: master, pdsEnv: { PDS_BLOB_UPLOAD_LIMIT: "1999999999" } });
    expect(failed((await check({ compose: master, pdsEnv: { PDS_BLOB_UPLOAD_LIMIT: "2000000000" } })).lines)).toEqual(
      [],
    );
    expect((await check()).lines).toContain("PASS C22 skipped: VIDEO_MASTER_MAX_BYTES is unset");
  });

  test("c23_prod_fake_fingerprint_fails", async () => {
    // C23 names the key and the service, never a value it could hold, so its reason prints in full (P1.30m).
    expect(
      await expectOnly("C23", { compose: COMPOSE.replace("FINGERPRINT_CHECK: arachnid", "FINGERPRINT_CHECK: fake") }),
    ).toBe("FAIL C23 FINGERPRINT_CHECK in web is not the real fingerprint service");
    await expectOnly("C23", { compose: COMPOSE.replace("FINGERPRINT_CHECK: arachnid", "FAKE_FINGERPRINT_LIST: x") });
    const both = COMPOSE.replace(
      "FINGERPRINT_CHECK: arachnid",
      "FINGERPRINT_CHECK: arachnid\n      FAKE_FINGERPRINT_LIST: x",
    );
    await expectOnly("C23", { compose: both });
    const dev = await check(
      { compose: DEV.replace("FINGERPRINT_CHECK: arachnid", "FINGERPRINT_CHECK: fake"), pdsEnv: DEV_ENV },
      "dev",
    );
    expect(dev.lines).toContain("PASS C23 skipped: dev stage");
  });

  test("c24_clock_unsynchronised_fails", async () => {
    await expectOnly("C24", {}, "prod", { run: fakeRun({ ntp: ok("no\n") }).run });
    await expectOnly("C24", {}, "prod", { run: fakeRun({ chrony: TRACKING("2.500000000") }).run });
    await expectOnly("C24", {}, "prod", { run: fakeRun({ ntp: notInstalled }).run });
    await expectOnly("C24", {}, "prod", { run: fakeRun({ chrony: ok("System time : soon\n") }).run });
    // chrony is optional; a .localhost stack (an agent's throwaway one) asks the host nothing.
    expect(failed((await check({}, "prod", { run: fakeRun({ chrony: notInstalled }).run })).lines)).toEqual([]);
    const local = fakeRun({ ntp: ok("no\n") });
    expect((await check({ compose: host("pds.localhost") }, "prod", { run: local.run })).lines).toContain(
      "PASS C24 skipped: PDS_HOSTNAME ends in .localhost",
    );
    expect(local.calls.some(([file]) => file === "timedatectl")).toBe(false);
  });
});

describe("preflight C17 (P1.30t)", () => {
  // Two declared networks and the implicit default, in both service forms (compose-spec 05-services.md "networks").
  const NETWORKED = COMPOSE.replace(
    '    ports: ["80:80", "443:443", "127.0.0.1:2019:2019"]',
    '    ports: ["80:80", "443:443", "127.0.0.1:2019:2019"]\n    networks:\n      front:\n        aliases: ["${APP_HOST}", "${PDS_HOSTNAME}"]\n      inner:',
  )
    .replace(
      "    env_file: ../../unset-dev-env/pds.env",
      "    env_file: ../../unset-dev-env/pds.env\n    networks: [inner]",
    )
    .replace("\nsecrets:", "\nnetworks:\n  front: {}\n  inner:\n    internal: true\nsecrets:");
  const NETWORKED_TABLE = {
    default: { internal: false, members: ["web"] },
    front: { internal: false, members: ["edge"] },
    inner: { internal: true, members: ["edge", "pds"] },
  };
  const cannotRun = async (s: Stack, pattern: RegExp) => {
    const result = await check(s);
    expect(result.code).toBe(2);
    expect(result.lines[0]).toMatch(pattern);
  };

  test("c17_extra_service_on_pds_network_fails", async () => {
    // Only the services the table names may share a network with the PDS (P1.30's check table, C17).
    const withPdsNetwork = (webNetworks: string) =>
      COMPOSE.replace(
        "    env_file: ../../unset-dev-env/pds.env",
        "    env_file: ../../unset-dev-env/pds.env\n    networks: [pds_net]",
      )
        .replace(
          '    ports: ["80:80", "443:443", "127.0.0.1:2019:2019"]',
          '    ports: ["80:80", "443:443", "127.0.0.1:2019:2019"]\n    networks: [default, pds_net]',
        )
        .replace(`    image: ${WEB}`, `    image: ${WEB}\n    networks: ${webNetworks}`)
        .replace("\nsecrets:", "\nnetworks:\n  pds_net:\n    internal: true\nsecrets:");
    const table = {
      default: { internal: false, members: ["edge", "web"] },
      pds_net: { internal: true, members: ["edge", "pds"] },
    };
    expect(failed((await check({ compose: withPdsNetwork("[default]"), networks: table })).lines)).toEqual([]);
    expect(await expectOnly("C17", { compose: withPdsNetwork("[default, pds_net]"), networks: table })).toBe(
      "FAIL C17 web is on pds_net, the table says not",
    );
  });

  test("c17_default_network_counted", async () => {
    // A service with no networks key joins `default`, so a table without it, or without one of its members, fails.
    await expectOnly("C17", { networks: {} });
    await expectOnly("C17", { networks: { default: { internal: false, members: ["edge", "pds"] } } });
    // A top-level networks.default changes that network's settings.
    const internal = COMPOSE.replace("\nsecrets:", "\nnetworks:\n  default:\n    internal: true\nsecrets:");
    await expectOnly("C17", { compose: internal });
    const table = { default: { internal: true, members: ["edge", "pds", "web"] } };
    expect(failed((await check({ compose: internal, networks: table })).lines)).toEqual([]);
  });

  test("c17_list_and_map_forms", async () => {
    expect(failed((await check({ compose: NETWORKED, networks: NETWORKED_TABLE })).lines)).toEqual([]);
    const outer = { ...NETWORKED_TABLE, inner: { internal: false, members: ["edge", "pds"] } };
    expect(await expectOnly("C17", { compose: NETWORKED, networks: outer })).toContain("inner: internal differs");
    // An attachment key outside the four the subset reads, an empty list, and a network no file defines are refused.
    const mac = NETWORKED.replace(
      '        aliases: ["${APP_HOST}", "${PDS_HOSTNAME}"]',
      "        mac_address: 02:42:ac:11:00:02",
    );
    await cannotRun({ compose: mac, networks: NETWORKED_TABLE }, /mac_address/);
    const empty = NETWORKED.replace("networks: [inner]", "networks: []");
    await cannotRun({ compose: empty, networks: NETWORKED_TABLE }, /empty/);
    const undefinedNetwork = NETWORKED.replace("networks: [inner]", "networks: [back]");
    await cannotRun({ compose: undefinedNetwork, networks: NETWORKED_TABLE }, /network back is not defined/);
  });

  test("c17_external_network_refused", async () => {
    const top = (spec: string) => NETWORKED.replace("  front: {}", `  front:\n    ${spec}`);
    await cannotRun({ compose: top("external: true"), networks: NETWORKED_TABLE }, /external/);
    await cannotRun({ compose: top("driver: overlay"), networks: NETWORKED_TABLE }, /driver/);
    await cannotRun({ compose: top("driver_opts: {}"), networks: NETWORKED_TABLE }, /driver_opts/);
    expect(failed((await check({ compose: top("driver: bridge"), networks: NETWORKED_TABLE })).lines)).toEqual([]);
  });

  test("c17_network_mode_fails", async () => {
    for (const mode of ["host", '"service:edge"', '"container:x"', "bridge"]) {
      const compose = COMPOSE.replace(
        "    env_file: ../../unset-dev-env/pds.env",
        `    env_file: ../../unset-dev-env/pds.env\n    network_mode: ${mode}`,
      );
      const table = { default: { internal: false, members: ["edge", "web"] } };
      expect(await expectOnly("C17", { compose, networks: table })).toBe("FAIL C17 network_mode is set in pds");
    }
    // P1.29h: `none` joins no network, so there is nothing for the table to check, but only the tools-profile reader
    // may use it; on a service `up` starts it is still refused.
    const none = COMPOSE.replace(
      "    env_file: ../../unset-dev-env/pds.env",
      "    env_file: ../../unset-dev-env/pds.env\n    network_mode: none",
    );
    const table = { default: { internal: false, members: ["edge", "web"] } };
    expect(await expectOnly("C17", { compose: none, networks: table })).toBe("FAIL C17 network_mode is set in pds");
  });

  test("c17_tools_reader_has_no_network", async () => {
    const reader = COMPOSE.replace(
      "\nsecrets:",
      "\n  pds-token-reader:\n    image: x\n    profiles: [tools]\n    network_mode: none\n    logging:\n      driver: none\nsecrets:",
    );
    // Only the reader may set logging (the parser), so a renamed copy drops it.
    const unlogged = (text: string) => text.replace("    logging:\n      driver: none\n", "");
    expect(reader).not.toBe(COMPOSE);
    const lines = (await check({ compose: reader })).lines;
    expect(lines.filter((line) => / C17\b/.test(line))).toEqual(["PASS C17 ok"]);
    // Only that service (architecture, 2026-10-13 04:17Z): the tools profile under another name still fails.
    const renamed = unlogged(reader.replace("  pds-token-reader:", "  reader:"));
    const renamedLines = (await check({ compose: renamed })).lines;
    expect(renamedLines.filter((line) => / C17\b/.test(line))).toEqual(["FAIL C17 network_mode is set in reader"]);
    // By its exact name, never a prefix or a longer name; and only inside the tools profile (the parser admits no
    // other profile).
    const variants: [string, string][] = [
      ["pds-token-reader-2", unlogged(reader.replace("  pds-token-reader:", "  pds-token-reader-2:"))],
      ["pds-token", unlogged(reader.replace("  pds-token-reader:", "  pds-token:"))],
      // Case counts too: the parser takes any service name as written.
      ["PDS-Token-Reader", unlogged(reader.replace("  pds-token-reader:", "  PDS-Token-Reader:"))],
      ["pds-token-reader", reader.replace("    profiles: [tools]\n", "")],
    ];
    for (const [name, compose] of variants) {
      const result = (await check({ compose })).lines.filter((line) => / C17\b/.test(line));
      expect(result, compose).toEqual([`FAIL C17 network_mode is set in ${name}`]);
    }
  });

  test("c17_table_mismatch_each_direction", async () => {
    const spare = { ...NETWORKED_TABLE, spare: { internal: true, members: [] } };
    expect(await expectOnly("C17", { compose: NETWORKED, networks: spare })).toContain("spare is not in compose");
    const { front: _front, ...noFront } = NETWORKED_TABLE;
    expect(await expectOnly("C17", { compose: NETWORKED, networks: noFront })).toContain("front is not in the table");
    const extra = { ...NETWORKED_TABLE, front: { internal: false, members: ["edge", "web"] } };
    expect(await expectOnly("C17", { compose: NETWORKED, networks: extra })).toContain("web is not on front");
    const fewer = { ...NETWORKED_TABLE, inner: { internal: true, members: ["edge"] } };
    expect(await expectOnly("C17", { compose: NETWORKED, networks: fewer })).toContain("pds is on inner");
  });

  test("c17_table_duplicate_key_refused", async () => {
    const twice =
      '{"default": {"internal": true, "members": []}, "default": {"internal": false, "members": ["edge", "pds", "web"]}}';
    expect(await expectOnly("C17", { networks: twice })).toBe("FAIL C17 the network table is unreadable");
    // The table's own shape is strict too: an unknown key, a repeated member or a string boolean is refused.
    await expectOnly("C17", { networks: { default: { ...TABLE.default, aliases: [] } } });
    await expectOnly("C17", { networks: { default: { internal: false, members: ["edge", "pds", "web", "web"] } } });
    await expectOnly("C17", { networks: { default: { internal: "false", members: ["edge", "pds", "web"] } } });
  });

  test("c17_missing_table_input_missing", async () => {
    expect(await expectOnly("C17", { networks: null })).toMatch(/^FAIL C17 input missing: .*networks\.prod\.json$/);
    const dev = await check({ compose: DEV, pdsEnv: DEV_ENV, networks: null }, "dev");
    expect(dev.lines.find((l) => l.startsWith("FAIL C17"))).toMatch(/networks\.dev\.json$/);
  });
});

// P1.30x (architecture record 2026-10-12-p129-compose-service-keys; Codex ruling 3 in 2026-10-12-batch33-codex-rulings):
// the parser allows cap_add only as [NET_BIND_SERVICE] beside cap_drop [ALL]; C25 allows it only where the service runs
// the lock's edge image, which needs the lock the parser never reads.
describe("preflight C25 (P1.30x)", () => {
  const webAdds = COMPOSE.replace(
    `    image: ${WEB}\n`,
    `    image: ${WEB}\n    cap_drop: [ALL]\n    cap_add: [NET_BIND_SERVICE]\n`,
  );

  test("c25_cap_add_only_on_the_edge_image", async () => {
    expect(await expectOnly("C25", { compose: webAdds })).toBe(
      "FAIL C25 web adds a capability but does not run the lock's edge image",
    );
  });

  test("c25_needs_the_lock_only_when_a_service_adds_a_capability", async () => {
    // With no lock, C2 to C5 and C18 report it; C25 does too, because the edge adds a capability.
    const result = await check({ lock: null });
    expect(result.lines.find((l) => l.startsWith("FAIL C25"))).toMatch(
      /^FAIL C25 input missing: .*images\.lock\.json$/,
    );
    const noAdd = COMPOSE.replace("    cap_add: [NET_BIND_SERVICE]\n", "");
    expect((await check({ compose: noAdd, lock: null })).lines).toContain("PASS C25 ok");
  });

  // Codex ruling 3 (Amendment 5 of 2026-10-12-p204s-p130x-p130y-booked): a service with both an image and a build is
  // the edge only when both name it, the lock's edge ref and deployment/edge/Dockerfile; a mismatch fails as such.
  const DOCKERFILES = {
    "deployment/edge/Dockerfile": "FROM scratch\n",
    "deployment/images/node-app.Dockerfile": "FROM scratch\n",
  };
  // Each Dockerfile from the context the images workflow builds it from (C26): the edge's own folder, else the root.
  const built = (service: string, image: string, dockerfile: string, adds = "") => {
    const [context, file] = dockerfile.endsWith("/Dockerfile")
      ? [`./${dockerfile.slice(0, -"/Dockerfile".length).replace(/^deployment\//, "")}`, "Dockerfile"]
      : ["..", dockerfile];
    return COMPOSE.replace(
      `  ${service}:\n    image: ${image}\n`,
      `  ${service}:\n    image: ${image}\n    build:\n      context: ${context}\n      dockerfile: ${file}\n${adds}`,
    );
  };
  const adds = "    cap_drop: [ALL]\n    cap_add: [NET_BIND_SERVICE]\n";

  test("c25_edge_image_built_from_another_dockerfile_fails", async () => {
    const compose = built("edge", EDGE, "deployment/images/node-app.Dockerfile");
    expect(await expectOnly("C25", { compose, files: DOCKERFILES })).toBe(
      "FAIL C25 edge adds a capability but its image and build name different images",
    );
  });

  test("c25_other_image_built_from_the_edge_dockerfile_fails", async () => {
    const compose = built("web", WEB, "deployment/edge/Dockerfile", adds);
    expect(await expectOnly("C25", { compose, files: DOCKERFILES })).toBe(
      "FAIL C25 web adds a capability but its image and build name different images",
    );
  });

  test("c25_edge_image_built_from_the_edge_dockerfile_passes", async () => {
    const compose = built("edge", EDGE, "deployment/edge/Dockerfile");
    const result = await check({ compose, files: DOCKERFILES });
    expect(failed(result.lines)).toEqual([]);
  });

  test("c25_lock_without_an_edge_entry_fails", async () => {
    const { edge: _edge, ...noEdge } = LOCK;
    expect((await check({ lock: noEdge })).lines).toContain(
      "FAIL C25 edge adds a capability but does not run the lock's edge image",
    );
  });
});

describe("preflight C26 and C27 (P1.30y)", () => {
  const DOCKERFILES = {
    Dockerfile: "FROM scratch\n",
    "deployment/edge/Dockerfile": "FROM scratch\n",
    "deployment/images/node-app.Dockerfile": "FROM scratch\n",
    "deployment/images/postgres.Dockerfile": "FROM scratch\n",
    "deployment/images/node_modules/x/Dockerfile": "FROM scratch\n",
    "deployment/images/node-app": "FROM scratch\n",
  };
  const webBuilds = (context: string, dockerfile: string) =>
    COMPOSE.replace(
      `    image: ${WEB}\n`,
      `    image: ${WEB}\n    build:\n      context: ${context}\n      dockerfile: ${dockerfile}\n`,
    );
  const webTmpfs = (yaml: string) => COMPOSE.replace(`    image: ${WEB}\n`, `    image: ${WEB}\n${yaml}`);

  // Architecture record 2026-10-12-p129-compose-service-keys: a Dockerfile is one the images workflow discovers and
  // scans (scripts/ci/list-dockerfiles.ts, images.test.ts's rule), built from the context that workflow builds it from:
  // a file named Dockerfile from its own folder (the edge), any *.Dockerfile from the repository root (images.yml,
  // scan-image "Build"). Another context builds other files than the scanned image holds.
  test("c26_build_from_the_root_and_a_scanned_dockerfile_passes", async () => {
    const result = await check({
      compose: webBuilds("..", "deployment/images/node-app.Dockerfile"),
      files: DOCKERFILES,
    });
    expect(failed(result.lines)).toEqual([]);
  });

  test("c26_context_other_than_the_root_fails", async () => {
    // Each names the scanned node-app Dockerfile, from another context.
    for (const [context, dockerfile] of [
      [".", "images/node-app.Dockerfile"],
      ["../deployment", "images/node-app.Dockerfile"],
      ["./images", "node-app.Dockerfile"],
    ]) {
      expect(
        await expectOnly("C26", { compose: webBuilds(context as string, dockerfile as string), files: DOCKERFILES }),
        context,
      ).toBe("FAIL C26 web builds from a context other than the images workflow's");
    }
  });

  // As the images workflow refuses them (scripts/ci/list-dockerfiles.ts entryProblems): a symlinked Dockerfile or
  // folder, and an image name outside ^[a-z0-9-]+$. That workflow's discover job is not a required check, so C26 is.
  test("c26_symlinks_and_bad_image_names_fail", async () => {
    const files = { ...DOCKERFILES, "deployment/images/Web_App.Dockerfile": "FROM scratch\n" };
    const name = await expectOnly("C26", { compose: webBuilds("..", "deployment/images/Web_App.Dockerfile"), files });
    expect(name).toBe("FAIL C26 web builds from a Dockerfile the images workflow does not scan");
    const linked = stack({ compose: webBuilds("..", "deployment/images/linked.Dockerfile"), files: DOCKERFILES });
    symlinkSync(
      join(linked.root, "deployment/images/node-app.Dockerfile"),
      join(linked.root, "deployment/images/linked.Dockerfile"),
    );
    const viaLink = await preflight(["--env", "prod", "--compose", linked.file], {
      root: linked.root,
      run: fakeRun().run,
      ...fakeFs(linked.root),
    });
    expect(viaLink.lines.filter((l) => l.startsWith("FAIL"))).toEqual([
      "FAIL C26 web builds from a Dockerfile the images workflow does not scan",
    ]);
    const folder = stack({ compose: webBuilds("..", "deployment/linked/node-app.Dockerfile"), files: DOCKERFILES });
    symlinkSync(join(folder.root, "deployment/images"), join(folder.root, "deployment/linked"));
    const viaFolder = await preflight(["--env", "prod", "--compose", folder.file], {
      root: folder.root,
      run: fakeRun().run,
      ...fakeFs(folder.root),
    });
    expect(viaFolder.lines.filter((l) => l.startsWith("FAIL"))).toEqual([
      "FAIL C26 web builds from a Dockerfile the images workflow does not scan",
    ]);
  });

  // P1.27n (verifier N2 on #675): one fixture per rule, each refused by that rule alone, so removing any one turns
  // this red. The others in c26_dockerfile_the_images_workflow_does_not_scan_fails trip several rules at once.
  test("c26_each_scan_rule_refuses_on_its_own", async () => {
    const files = {
      ...DOCKERFILES,
      // Outside deployment/, an existing regular file with a listable name: only the prefix rule refuses it. Its image
      // name, web, is also given once under deployment/, so the duplicate rule would pass it (verifier N-b on #687).
      "other/web.Dockerfile": "FROM scratch\n",
      "deployment/images/web.Dockerfile": "FROM scratch\n",
      // A folder whose name the Dockerfile rule lists: only the is-a-file rule refuses it.
      "deployment/images/folder.Dockerfile/x": "FROM scratch\n",
    };
    for (const dockerfile of ["other/web.Dockerfile", "deployment/images/folder.Dockerfile"]) {
      expect(await expectOnly("C26", { compose: webBuilds("..", dockerfile), files }), dockerfile).toBe(
        "FAIL C26 web builds from a Dockerfile the images workflow does not scan",
      );
    }
  });

  // P1.27n (verifier N5 on #675): list-dockerfiles refuses two Dockerfiles that give one image name, since the scan
  // matrix would build one and publish the other's name; C26 refuses a build of either.
  test("c26_image_name_another_dockerfile_takes_fails", async () => {
    const files = { ...DOCKERFILES, "deployment/images/edge.Dockerfile": "FROM scratch\n" };
    for (const [context, dockerfile] of [
      ["..", "deployment/images/edge.Dockerfile"],
      ["./edge", "Dockerfile"],
    ]) {
      expect(
        await expectOnly("C26", { compose: webBuilds(context as string, dockerfile as string), files }),
        dockerfile,
      ).toBe("FAIL C26 web builds an image whose name another Dockerfile also takes");
    }
  });

  // P1.27u (architecture record 2026-10-12-p127u-bind-ancestors-and-build-context, (b)): a build context is sent to the
  // daemon whole, so none may hold, be or sit inside the secrets folder. .dockerignore is a file in the context that
  // any edit can change, so it never counts.
  test("c26_build_context_reaching_secrets_fails", async () => {
    const reaches = "FAIL C26 web builds from a context that reaches the secrets folder";
    const run = async (context: string, dockerfile: string, setUp: (root: string) => void = () => undefined) => {
      const s = stack({ compose: webBuilds(context, dockerfile), files: DOCKERFILES });
      setUp(s.root);
      return preflight(["--env", "prod", "--compose", s.file], { root: s.root, run: fakeRun().run, ...fakeFs(s.root) });
    };
    // The secrets folder inside the checkout, under a root-context build; the .dockerignore does not save it.
    const inside = (root: string) => {
      renameSync(secretsOf(root), join(root, "deployment/secrets"));
      const file = join(root, "deployment/compose.yaml");
      writeFileSync(file, readFileSync(file, "utf8").replace("../../unset-dev-secrets/", "secrets/"));
      writeFileSync(join(root, ".dockerignore"), "deployment/secrets\n");
    };
    expect((await run("..", "deployment/images/node-app.Dockerfile", inside)).lines).toContain(reaches);
    expect((await run("../../unset-dev-secrets", "../repo/deployment/images/node-app.Dockerfile")).lines).toContain(
      reaches,
    );
    const within = (root: string) => mkdirSync(join(secretsOf(root), "sub"), { mode: 0o700 });
    expect(
      (await run("../../unset-dev-secrets/sub", "../../repo/deployment/images/node-app.Dockerfile", within)).lines,
    ).toContain(reaches);
    // An env file Compose reads, inside a root context (architecture, Amendment 2 of the record above).
    const envInside = (root: string) => {
      renameSync(join(envOf(root), "pds.env"), join(root, "deployment/pds.env"));
      const file = join(root, "deployment/compose.yaml");
      writeFileSync(file, readFileSync(file, "utf8").replace("../../unset-dev-env/pds.env", "pds.env"));
    };
    expect((await run("..", "deployment/images/node-app.Dockerfile", envInside)).lines).toContain(
      "FAIL C26 web builds from a context that holds an env file",
    );
    // The env file reached only through its folder's real path: a context that is a link to that folder.
    const envLink = (root: string) => void symlinkSync(envOf(root), join(dirname(root), "envlink"));
    expect((await run("../../envlink", "../repo/deployment/images/node-app.Dockerfile", envLink)).lines).toContain(
      "FAIL C26 web builds from a context that holds an env file",
    );
    // The context is judged hop by hop like a bind source (Amendment 6): a group-writable checkout fails.
    const open = (root: string) => chmodSync(root, 0o775);
    expect((await run("..", "deployment/images/node-app.Dockerfile", open)).lines).toContain(
      "FAIL C26 web builds from a context that another user can change",
    );
    // The sibling layout passes.
    expect(failed((await run("..", "deployment/images/node-app.Dockerfile")).lines)).toEqual([]);
  });

  test("c26_edge_dockerfile_builds_from_its_own_folder", async () => {
    expect(failed((await check({ compose: webBuilds("./edge", "Dockerfile"), files: DOCKERFILES })).lines)).toEqual([]);
    for (const [context, dockerfile] of [
      ["..", "deployment/edge/Dockerfile"],
      ["./edge/sites", "../Dockerfile"],
      [".", "edge/Dockerfile"],
    ]) {
      expect(
        await expectOnly("C26", { compose: webBuilds(context as string, dockerfile as string), files: DOCKERFILES }),
        context,
      ).toBe("FAIL C26 web builds from a context other than the images workflow's");
    }
  });

  test("c26_dockerfile_the_images_workflow_does_not_scan_fails", async () => {
    for (const dockerfile of [
      "Dockerfile",
      "deployment/images/missing.Dockerfile",
      "deployment/images/node_modules/x/Dockerfile",
      // Files that exist under the root, so only the name rule refuses them.
      "deployment/compose.yaml",
      "deployment/images.lock.json",
      // A name the workflow's name rule accepts, on a file its Dockerfile rule does not list.
      "deployment/images/node-app",
      "../outside.Dockerfile",
    ]) {
      expect(await expectOnly("C26", { compose: webBuilds("..", dockerfile), files: DOCKERFILES }), dockerfile).toBe(
        "FAIL C26 web builds from a Dockerfile the images workflow does not scan",
      );
    }
  });

  // The same record: /var/run/postgresql is a tmpfs on the postgres-kind service only, in either tmpfs form.
  test("c27_postgres_socket_tmpfs_on_another_service_fails", async () => {
    for (const yaml of [
      "    tmpfs: [/var/run/postgresql]\n",
      "    volumes:\n      - type: tmpfs\n        target: /var/run/postgresql\n",
    ]) {
      expect(await expectOnly("C27", { compose: webTmpfs(yaml) }), yaml).toBe(
        "FAIL C27 web mounts the socket-directory tmpfs but does not run the lock's database image",
      );
    }
  });

  // P1.30j's rule: a reason names keys and services, never text a configured value could hold (PGHOST, POSTGRES_USER).
  test("c27_reason_survives_withholding", async () => {
    const pdsEnv = { PGHOST: "/var/run/postgresql", POSTGRES_USER: "postgres" };
    expect(await expectOnly("C27", { compose: webTmpfs("    tmpfs: [/var/run/postgresql]\n"), pdsEnv })).toBe(
      "FAIL C27 web mounts the socket-directory tmpfs but does not run the lock's database image",
    );
  });

  test("c27_postgres_socket_tmpfs_on_the_postgres_image_passes", async () => {
    // The lock names the web image as postgres here, so the same service is the postgres kind.
    const lock = { ...LOCK, postgres: LOCK.web };
    const result = await check({ compose: webTmpfs("    tmpfs: [/var/run/postgresql, /tmp]\n"), lock });
    expect(failed(result.lines)).toEqual([]);
    const pg = COMPOSE.replace(
      `    image: ${WEB}\n`,
      `    image: ${WEB}\n    build:\n      context: ..\n      dockerfile: deployment/images/node-app.Dockerfile\n    tmpfs: [/var/run/postgresql]\n`,
    );
    expect(await expectOnly("C27", { compose: pg, lock, files: DOCKERFILES })).toBe(
      "FAIL C27 web mounts the socket-directory tmpfs but its image and build name different images",
    );
    expect((await check({ compose: webTmpfs("    tmpfs: [/tmp]\n"), lock: null })).lines).toContain("PASS C27 ok");
  });

  // P1.27n (verifier N4 on #659): a socket-directory tmpfs with no lock to judge it by fails closed.
  test("c27_socket_tmpfs_without_a_lock_fails", async () => {
    const result = await check({ compose: webTmpfs("    tmpfs: [/var/run/postgresql]\n"), lock: null });
    expect(result.lines.find((l) => l.startsWith("FAIL C27"))).toMatch(
      /^FAIL C27 input missing: .*images\.lock\.json$/,
    );
  });
});

// P1.30a (architecture ruling 2026-10-12-preflight-compose-inputs, F3.2 and F3.4): the preflight judges the stack against
// the interpolation inputs Compose would use, and refuses to run when the environment could change them.
describe("compose inputs (P1.30a)", () => {
  // biome-ignore lint/suspicious/noTemplateCurlyInString: Compose interpolation text, not JS templates.
  const REF = COMPOSE.replace("      PDS_HOSTNAME: pds.example.test", "      PDS_HOSTNAME: ${HOST_NAME}");
  /** Passes only when pds's PDS_HOSTNAME is `want`; the value itself never leaves the map. */
  const hostnameIs = (want: string): Check => ({
    id: "CP",
    run: (inputs) => (inputs.serviceEnv.get("pds")?.use("PDS_HOSTNAME", (v) => v === want) ? pass() : fail("other")),
  });
  // Beside the checkout, as the stack's env files are (P1.34p: never inside the Compose project directory).
  function envFile(root: string, name: string, text: string, mode = 0o600): string {
    const path = join(envOf(root), name);
    writeFileSync(path, text);
    chmodSync(path, mode);
    return path;
  }
  const argv = (file: string, ...extra: string[]) => ["--env", "prod", "--compose", file, ...extra];

  test("interpolation_env_replaces_dot_env", async () => {
    const { root, file } = stack({ compose: REF, dotEnv: "HOST_NAME=dot.example.test\n" });
    const flag = envFile(root, "flag.env", "HOST_NAME=flag.example.test\n");
    const other = envFile(root, "other.env", "OTHER=x\n");
    const run = (extra: string[], want: string) =>
      preflight(argv(file, ...extra), { root, run: fakeRun().run, environment: {}, checks: [hostnameIs(want)] });
    expect(await run([], "dot.example.test")).toEqual({ code: 0, lines: ["PASS CP ok"] });
    expect(await run(["--interpolation-env", flag], "flag.example.test")).toEqual({ code: 0, lines: ["PASS CP ok"] });
    // The flag replaces the .env whole: a name only the .env holds is empty, as in Compose.
    expect(await run([`--interpolation-env=${other}`], "")).toEqual({ code: 0, lines: ["PASS CP ok"] });
  });

  test("interpolation_env_is_permission_checked", async () => {
    const { root, file } = stack({ compose: REF });
    const flag = envFile(root, "flag.env", "HOST_NAME=pds.example.test\n", 0o644);
    // C9 judges the secrets folder before the files Compose reads (P1.27u), so its parents above the stack's
    // temporary folder are faked as everywhere else.
    const result = await preflight(argv(file, "--interpolation-env", flag), {
      root,
      run: fakeRun().run,
      environment: {},
      ...fakeFs(root),
    });
    expect(failed(result.lines)).toEqual(["C9"]);
    expect(result.lines).toContain(`FAIL C9 ${flag} must have exactly owner read and write permissions`);
  });

  test("interpolation_env_inside_project_fails", async () => {
    const { root, file } = stack({ compose: REF });
    const inside = join(root, "deployment/flag.env");
    writeFileSync(inside, "HOST_NAME=pds.example.test\n");
    chmodSync(inside, 0o600);
    const run = (flag: string) =>
      preflight(argv(file, "--interpolation-env", flag), {
        root,
        run: fakeRun().run,
        environment: {},
        ...fakeFs(root),
      });
    expect((await run(inside)).lines).toContain(
      "FAIL C9 an env or secret file is inside the Compose project directory",
    );
    const beside = envFile(root, "flag.env", "HOST_NAME=pds.example.test\n");
    expect(failed((await run(beside)).lines)).not.toContain("C9");
  });

  test("interpolation_env_refusals_cannot_run", async () => {
    const { root, file } = stack();
    const flag = envFile(root, "flag.env", "");
    const refusal = async (extra: string[]) =>
      (await preflight(argv(file, ...extra), { root, run: fakeRun().run, environment: {} })).lines;
    expect(await refusal(["--interpolation-env", flag, "--interpolation-env", flag])).toEqual([
      "ERROR --interpolation-env may be given once",
    ]);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Compose interpolation text, not JS templates.
    for (const path of ["~/flag.env", "$HOME/flag.env", "/srv/${STAGE}.env"]) {
      expect(await refusal(["--interpolation-env", path]), path).toEqual([
        "ERROR --interpolation-env: a leading ~ or a $ is refused",
      ]);
    }
    expect((await refusal(["--interpolation-env", join(root, "absent.env")]))[0]).toMatch(
      /^ERROR cannot read .*absent\.env$/,
    );
  });

  // As for --compose (P1.27a Amendment 3): Compose resolves a relative --env-file against $PWD, Node against the
  // physical cwd, so the two could read different files. Only an absolute, normal path names one file to both.
  test("interpolation_env_path_must_be_absolute_and_normal", async () => {
    const { root, file } = stack();
    const flag = envFile(root, "flag.env", "");
    const dir = dirname(flag);
    for (const path of [
      relative(process.cwd(), flag),
      `${dir}/../deployment/flag.env`,
      `${dir}/./flag.env`,
      `${flag}/`,
    ]) {
      expect(
        await preflight(argv(file, "--interpolation-env", path), { root, run: fakeRun().run, environment: {} }),
        path,
      ).toEqual({
        code: 2,
        lines: ["ERROR --interpolation-env must be an absolute, normalised path"],
      });
    }
  });

  test("compose_variables_in_the_environment_cannot_run", async () => {
    // The ruling's names; all but COMPOSE_PROJECT_DIR change which files Compose reads (compose-go consts.go v2.13.0;
    // compose cmd/compose/compose.go v5.3.1). No pinned source reads COMPOSE_PROJECT_DIR; the prefix covers it anyway.
    const { root, file } = stack();
    for (const name of [
      "COMPOSE_ENV_FILES",
      "COMPOSE_FILE",
      "COMPOSE_PROJECT_DIR",
      "COMPOSE_PROFILES",
      "COMPOSE_DISABLE_ENV_FILE",
      // Ruling 2026-10-12-preflight-compose-inputs, Amendment 1: the whole COMPOSE_ prefix, not only these five.
      "COMPOSE_PROJECT_NAME",
    ]) {
      for (const value of [SENTINEL, ""]) {
        const result = await preflight(argv(file), { root, run: fakeRun().run, environment: { [name]: value } });
        expect(result, name).toEqual({ code: 2, lines: [`ERROR ${name} is set in the environment`] });
      }
    }
  });

  test("compose_variables_in_the_env_file_cannot_run", async () => {
    // Compose copies every COMPOSE_* key of the env file into its own environment when the shell lacks it
    // (cmd/compose/compose.go setEnvWithDotEnv, v5.3.1 :683-719), so the file can set them as the shell can.
    // Amendment 1 of the ruling: any COMPOSE_* key, so COMPOSE_PROJECT_NAME too.
    for (const name of ["COMPOSE_FILE", "COMPOSE_PROFILES", "COMPOSE_DISABLE_ENV_FILE", "COMPOSE_PROJECT_NAME"]) {
      const { root, file } = stack({ dotEnv: `${name}=${SENTINEL}\n` });
      const fromDotEnv = await preflight(argv(file), { root, run: fakeRun().run, environment: {} });
      expect(fromDotEnv, name).toEqual({ code: 2, lines: [`ERROR ${name} is set in the env file`] });
      const flag = envFile(root, "flag.env", `${name}=\n`);
      const fromFlag = await preflight(argv(file, "--interpolation-env", flag), {
        root,
        run: fakeRun().run,
        environment: {},
      });
      expect(fromFlag, name).toEqual({ code: 2, lines: [`ERROR ${name} is set in the env file`] });
    }
  });

  test("interpolated_name_in_the_environment_cannot_run", async () => {
    // Compose takes a shell value over the env file (Docker docs "Interpolation"; compose-go Mapping.Merge), so a name
    // the files interpolate must not be set where the preflight runs.
    const { root, file } = stack({ compose: REF, dotEnv: "HOST_NAME=pds.example.test\n" });
    const deps = { root, run: fakeRun().run, checks: [hostnameIs("pds.example.test")] };
    expect(await preflight(argv(file), { ...deps, environment: { HOST_NAME: SENTINEL } })).toEqual({
      code: 2,
      lines: ["ERROR HOST_NAME is set in the environment"],
    });
    expect(await preflight(argv(file), { ...deps, environment: { UNRELATED: SENTINEL } })).toEqual({
      code: 0,
      lines: ["PASS CP ok"],
    });
  });
});

describe("preflight --env local (P1.27l)", () => {
  /** web built from the scanned node Dockerfile at the root, with no image: the build-only shape the local stack has. */
  const WEB_BUILD_ONLY = COMPOSE.replace(
    `    image: ${WEB}\n`,
    "    build:\n      context: ..\n      dockerfile: deployment/images/node-app.Dockerfile\n",
  );
  const NODE_APP = { "deployment/images/node-app.Dockerfile": "FROM scratch\n" };
  /** C2 to C5's lines, with the stack's temporary root named as <root>. */
  async function imageLines(s: Stack, env: string, deps: Partial<Deps> = {}, noKey = false): Promise<string[]> {
    const { root, file } = stack(s);
    if (noKey) rmSync(join(root, "deployment/cosign.pub"));
    const { lines } = await preflight(["--env", env, "--compose", file], {
      root,
      run: fakeRun().run,
      ...fakeFs(root),
      ...deps,
    });
    return lines.filter((line) => /^\S+ C[2-5] /.test(line)).map((line) => line.replaceAll(root, "<root>"));
  }

  // Architecture record 2026-10-12-p129-local-build-preflight, item 2: --env dev and --env prod never take the local
  // path. Each expected line was printed by main 5961375, before this step, for the same stack.
  test("c2_to_c5_unchanged_under_dev_and_prod", async () => {
    const dev = { compose: DEV, pdsEnv: DEV_ENV };
    const verifyFails = { run: fakeRun({ verify: { code: 1, stderr: "edge: signature does not verify: bad\n" } }).run };
    const platform = { run: fakeRun({ mediaType: "application/vnd.oci.image.manifest.v1+json" }).run };
    const cases: [string, Stack, string, Partial<Deps>, boolean?][] = [
      ["prod", {}, "prod", {}],
      ["dev", dev, "dev", {}],
      ["no lock", { lock: null }, "prod", {}],
      ["dev no lock", { ...dev, lock: null }, "dev", {}],
      ["not ours", { compose: COMPOSE.replace(EDGE, `docker.io/library/caddy@${digest("a")}`) }, "prod", {}],
      ["unsigned", {}, "prod", verifyFails],
      ["platform", {}, "dev", platform],
      ["build only", { compose: WEB_BUILD_ONLY, files: NODE_APP }, "prod", {}],
      [
        "dev build only",
        { compose: WEB_BUILD_ONLY.replace("unset-prod", "unset-dev"), files: NODE_APP, pdsEnv: DEV_ENV },
        "dev",
        {},
      ],
      // The verifier on #789: a mutant dropping dev's cosign.pub requirement survived nine samples. Both stages, and
      // the failing paths under dev as under prod.
      ["no key", {}, "prod", {}, true],
      ["dev no key", dev, "dev", {}, true],
      ["dev not ours", { ...dev, compose: DEV.replace(EDGE, `docker.io/library/caddy@${digest("a")}`) }, "dev", {}],
      ["dev unsigned", dev, "dev", verifyFails],
      ["prod platform", {}, "prod", platform],
    ];
    const PASSED = [
      "PASS C2 ok",
      "PASS C3 2 first-party images verified",
      "PASS C4 1 upstream images verified",
      "PASS C5 ok",
    ];
    const NO_LOCK = ["C2", "C3", "C4", "C5"].map(
      (id) => `FAIL ${id} input missing: <root>/deployment/images.lock.json`,
    );
    const seen: Record<string, string[]> = {};
    for (const [name, s, env, deps, noKey] of cases) seen[name] = await imageLines(s, env, deps, noKey);
    const NO_KEY = ["C3", "C4"].map((id) => `FAIL ${id} input missing: <root>/deployment/cosign.pub`);
    expect(seen).toEqual({
      prod: PASSED,
      dev: PASSED,
      "no lock": NO_LOCK,
      "dev no lock": NO_LOCK,
      "not ours": ["FAIL C2 edge image is not ghcr.io/undefined6799/… by digest", ...PASSED.slice(1)],
      unsigned: [PASSED[0], "FAIL C3 edge: signature does not verify: bad", ...PASSED.slice(2)],
      platform: [...PASSED.slice(0, 3), "FAIL C5 edge is not a multi-arch index"],
      "build only": ["FAIL C2 web image is not ghcr.io/undefined6799/… by digest", ...PASSED.slice(1)],
      "dev build only": ["FAIL C2 web image is not ghcr.io/undefined6799/… by digest", ...PASSED.slice(1)],
      "no key": [PASSED[0], ...NO_KEY, PASSED[3]],
      "dev no key": [PASSED[0], ...NO_KEY, PASSED[3]],
      "dev not ours": ["FAIL C2 edge image is not ghcr.io/undefined6799/… by digest", ...PASSED.slice(1)],
      "dev unsigned": [PASSED[0], "FAIL C3 edge: signature does not verify: bad", ...PASSED.slice(2)],
      "prod platform": [...PASSED.slice(0, 3), "FAIL C5 edge is not a multi-arch index"],
    });
  });

  // The local stack (architecture record 2026-10-12-p129-local-build-preflight, item 2; Alex, "Yes, local only",
  // 2026-10-12T16:44:52Z): every service built here or run as a locked base, the edge with the dev leaf's TLS snippet.
  const BASES = readFileSync(join(REPO, "deployment/images/bases.lock.json"), "utf8");
  const MIRROR = readFileSync(join(REPO, "deployment/mirror.list.json"), "utf8");
  const LOCKED_PDS = (() => {
    const pds = (JSON.parse(BASES) as Record<string, { ref: string; tag: string; digest: string }>).pds;
    return `${pds?.ref}:${pds?.tag}@${pds?.digest}`;
  })();
  const LOCAL = `name: unset-local
services:
  edge:
    build:
      context: ./edge
      dockerfile: Dockerfile
    user: "65532:65532"
    cap_drop: [ALL]
    cap_add: [NET_BIND_SERVICE]
    ports: ["127.0.0.1:80:80", "127.0.0.1:443:443"]
    secrets: [local_tls_cert, local_tls_key]
    volumes:
      - ./edge/sites/enabled:/etc/caddy/sites/enabled:ro
      - ./edge/local/tls.caddy:/etc/caddy/snippets/tls.caddy:ro
    environment:
      PDS_HOST: pds.localhost
      PDS_UPSTREAM: pds:3000
      APP_HOST: app.localhost
      APP_UPSTREAM: web:3000
      ACME_EMAIL: edge@example.test
  pds:
    image: ${LOCKED_PDS}
    env_file: ../../unset-dev-env/pds.env
    environment:
      PDS_HOSTNAME: pds.localhost
  web:
    build:
      context: ..
      dockerfile: deployment/images/node-app.Dockerfile
    user: "65532:65532"
    secrets: [db_password]
secrets:
  db_password:
    file: ../../unset-dev-secrets/db_password
  local_tls_cert:
    file: ../../unset-dev-secrets/local_tls_cert
  local_tls_key:
    file: ../../unset-dev-secrets/local_tls_key
`;
  /**
   * The handle domain is the PDS's own. Mail stays set: C11 and C19 stay required under local until Alex answers the
   * local-mail card (architecture record 2026-10-13-p127l-local-gaps, item 2).
   */
  const LOCAL_ENV = { PDS_SERVICE_HANDLE_DOMAINS: ".pds.localhost" };
  const LOCAL_FILES = {
    ...NODE_APP,
    "deployment/edge/Dockerfile": "FROM scratch\n",
    "deployment/edge/local/tls.caddy": readFileSync(join(EDGE_DIR, "local/tls.caddy"), "utf8"),
    "deployment/edge/local/app.caddy": readFileSync(join(EDGE_DIR, "local/app.caddy"), "utf8"),
    "deployment/images/bases.lock.json": BASES,
    "deployment/mirror.list.json": MIRROR,
  };
  const LOCAL_LAST = "LOCAL unsigned, local-only stack: never deploy it";
  /** The edge Dockerfile itself, built from the root: the path is right, but C26 refuses the context. */
  const OFF_CONTEXT_EDGE = "      context: ..\n      dockerfile: deployment/edge/Dockerfile\n";
  /** The local stack after `edit`, with its leaf secret files written beside the other secrets. */
  async function local(
    edit: (text: string) => string = (text) => text,
    { links = {}, remove = [], ...s }: Stack & { links?: Record<string, string>; remove?: string[] } = {},
  ) {
    const { root, file } = stack({
      compose: edit(LOCAL),
      pdsEnv: LOCAL_ENV,
      lock: null,
      ...s,
      files: { ...LOCAL_FILES, ...s.files },
    });
    for (const name of ["local_tls_cert", "local_tls_key"]) {
      writeFileSync(join(secretsOf(root), name), "fixture\n");
      chmodSync(join(secretsOf(root), name), 0o400);
    }
    chmodSync(join(root, "deployment/edge/local"), 0o755);
    for (const [path, target] of Object.entries(links)) symlinkSync(target, join(root, path));
    for (const path of remove) rmSync(join(root, path));
    const result = await preflight(["--env", "local", "--compose", file], {
      root,
      run: fakeRun().run,
      ...fakeFs(root),
    });
    return { ...result, root };
  }
  const verdicts = (lines: string[]) => lines.map((line) => line.split(" ").slice(0, 2).join(" "));

  test("local_stack_is_unsigned_and_local_only", async () => {
    const { code, lines } = await local();
    expect(verdicts(lines)).toEqual([
      ...IDS.map((id) => (["C3", "C4", "C5"].includes(id) ? `UNSIGNED ${id}` : `PASS ${id}`)),
      "PASS L1",
      "PASS L2",
      "LOCAL unsigned,",
    ]);
    expect(lines.at(-1)).toBe(LOCAL_LAST);
    expect(code).toBe(0);
  });

  test("local_unsigned_never_hides_a_failure", async () => {
    const { code, lines } = await local((text) => text, { pdsEnv: { ...LOCAL_ENV, PDS_INVITE_REQUIRED: "false" } });
    expect(failed(lines)).toEqual(["C7"]);
    expect(lines.filter((line) => line.startsWith("UNSIGNED"))).toHaveLength(3);
    expect(lines.at(-1)).toBe(LOCAL_LAST);
    expect(code).toBe(1);
    // Crawling stays off on local as on dev.
    const crawled = await local((text) => text, { pdsEnv: { ...LOCAL_ENV, PDS_CRAWLERS: "https://bsky.network" } });
    expect(failed(crawled.lines)).toEqual(["C7"]);
  });

  test("local_c2_admits_builds_and_run_only_vendor_images", async () => {
    // Architecture record 2026-10-13-p127l-local-gaps, Amendment 2, point 2: unbuilt, only a vendor image the dev stack
    // runs as shipped, by exact ref:tag@digest; a builder, a base we harden, and any partial reference are refused.
    const c2 = async (edit: (text: string) => string) => (await local(edit)).lines.find((line) => / C2 /.test(line));
    expect(await c2((text) => text)).toBe("PASS C2 ok");
    const bases = JSON.parse(BASES) as Record<string, { ref: string; tag: string; digest: string }>;
    const exact = (key: string) => `${bases[key]?.ref}:${bases[key]?.tag}@${bases[key]?.digest}`;
    const pds = bases.pds as { ref: string; tag: string; digest: string };
    for (const image of [
      exact("caddy-builder"),
      exact("postgres"),
      exact("caddy"),
      exact("node"),
      pds.ref,
      `${pds.ref}:${pds.tag}`,
      `${pds.ref}@${pds.digest}`,
      `${pds.ref}:${pds.tag}@sha256:${"0".repeat(64)}`,
      `ghcr.io/undefined6799/mirror/pds@${pds.digest}`,
    ]) {
      expect(await c2((text) => text.replace(LOCKED_PDS, image)), image).toBe(
        "FAIL C2 pds image is not a run-only vendor image by tag and digest",
      );
    }
    // A service with neither an image nor a build cannot run, and Compose refuses it; C2 says so too.
    const webBuild = "    build:\n      context: ..\n      dockerfile: deployment/images/node-app.Dockerfile\n";
    expect(await c2((text) => text.replace(webBuild, ""))).toBe("FAIL C2 web has neither an image nor a build");
    // A build counts only with no image beside it, and only from a Dockerfile C26 passes.
    expect(await c2((text) => text.replace(webBuild, `${webBuild}    image: ${LOCKED_PDS}\n`))).toBe(
      "FAIL C2 web has both an image and a build",
    );
    // Outside deployment/, so the images workflow never scans it.
    const unscanned = await local(
      (text) => text.replace("deployment/images/node-app.Dockerfile", "apps/other.Dockerfile"),
      {
        files: { "apps/other.Dockerfile": "FROM scratch\n" },
      },
    );
    expect(unscanned.lines.find((line) => / C2 /.test(line))).toBe("FAIL C2 web builds from a Dockerfile C26 refuses");
  });

  test("local_guards_loopback_ports_and_localhost_pds", async () => {
    for (const ports of ['["80:80", "127.0.0.1:443:443"]', '["0.0.0.0:80:80", "127.0.0.1:443:443"]']) {
      const { lines, code } = await local((text) => text.replace('["127.0.0.1:80:80", "127.0.0.1:443:443"]', ports));
      expect(lines.filter((line) => line.startsWith("FAIL"))).toEqual([
        "FAIL L1 edge publishes a port beyond loopback",
      ]);
      expect(code).toBe(1);
    }
    for (const host of ["pds.example.test", "localhost", "pds-localhost", "pds.localhost.example.test"]) {
      const { lines } = await local((text) => text.replace("PDS_HOSTNAME: pds.localhost", `PDS_HOSTNAME: ${host}`));
      expect(lines, host).toContain("FAIL L2 PDS_HOSTNAME is not a name under the loopback-only top-level domain");
    }
  });

  test("local_capability_and_socket_checks_need_no_lock", async () => {
    // Architecture record 2026-10-13-p127l-local-gaps, Amendment 1, point 1: with no lock, C25 and C27 know the edge and
    // the database only by a build of exactly their Dockerfile that C26 passes, with no image beside it.
    const postgres = (from: string) => (text: string) =>
      text.replace(
        "  web:\n",
        `  postgres:\n${from}    tmpfs:\n      - /var/run/postgresql:uid=70,gid=70,mode=0700\n$&`,
      );
    const built = "    build:\n      context: ..\n      dockerfile: deployment/images/postgres.Dockerfile\n";
    const files = { "deployment/images/postgres.Dockerfile": "FROM scratch\n" };
    const lines = async (edit: (text: string) => string, s: Stack & { links?: Record<string, string> } = {}) =>
      (await local(edit, { ...s, files: { ...files, ...s.files } })).lines.filter((line) => / C2[57] /.test(line));
    expect(await lines(postgres(built))).toEqual(["PASS C25 ok", "PASS C27 ok"]);
    // Red fixtures, each by the Dockerfile's identity alone.
    const webBuild = "    build:\n      context: ..\n      dockerfile: deployment/images/node-app.Dockerfile\n";
    const nonEdge = await lines((text) =>
      text.replace(webBuild, `${webBuild}    cap_drop: [ALL]\n    cap_add: [NET_BIND_SERVICE]\n`),
    );
    expect(nonEdge).toContain("FAIL C25 web adds a capability but is not built from deployment/edge/Dockerfile");
    const linked = await lines(
      (text) => text.replace("      dockerfile: Dockerfile\n", "      dockerfile: link.Dockerfile\n"),
      {
        links: { "deployment/edge/link.Dockerfile": "Dockerfile" },
      },
    );
    expect(linked).toContain("FAIL C25 edge adds a capability but is not built from deployment/edge/Dockerfile");
    const nonPostgres = await lines((text) =>
      text.replace(webBuild, `${webBuild}    tmpfs:\n      - /var/run/postgresql:uid=70,gid=70,mode=0700\n`),
    );
    expect(nonPostgres).toContain(
      "FAIL C27 web mounts the socket-directory tmpfs but is not built from deployment/images/postgres.Dockerfile",
    );
    expect(await lines(postgres(`${built}    image: ${LOCKED_PDS}\n`))).toContain(
      "FAIL C27 postgres mounts the socket-directory tmpfs but its image and build name different images",
    );
    const edgeBuild = "    build:\n      context: ./edge\n      dockerfile: Dockerfile\n";
    expect(await lines((text) => text.replace(edgeBuild, `${edgeBuild}    image: ${LOCKED_PDS}\n`))).toContain(
      "FAIL C25 edge adds a capability but its image and build name different images",
    );
    expect(await lines(postgres(`    image: ${LOCKED_PDS}\n`))).toContain(
      "FAIL C27 postgres mounts the socket-directory tmpfs but is not built from deployment/images/postgres.Dockerfile",
    );
    // Md (book edit 2026-10-13-p127l-verify-owners, item 3): the right Dockerfile, but a build C26 refuses (here its
    // context), counts for neither check.
    const offContext = "    build:\n      context: ./images\n      dockerfile: postgres.Dockerfile\n";
    expect(await lines(postgres(offContext))).toContain(
      "FAIL C27 postgres mounts the socket-directory tmpfs but is not built from deployment/images/postgres.Dockerfile",
    );
    expect(
      await lines((text) => text.replace("      context: ./edge\n      dockerfile: Dockerfile\n", OFF_CONTEXT_EDGE)),
    ).toContain("FAIL C25 edge adds a capability but is not built from deployment/edge/Dockerfile");
  });

  test("dev_and_prod_capability_and_socket_checks_still_need_the_lock", async () => {
    // Amendment 1, point 1: the build-only fixture that passes C25 and C27 under local fails both under dev and prod,
    // which still read the lock.
    const postgres = (text: string) =>
      text.replace(
        "  web:\n",
        "  postgres:\n    build:\n      context: ..\n      dockerfile: deployment/images/postgres.Dockerfile\n" +
          "    tmpfs:\n      - /var/run/postgresql:uid=70,gid=70,mode=0700\n$&",
      );
    const edgeBuilt = (text: string) =>
      text.replace(`    image: ${EDGE}\n`, "    build:\n      context: ./edge\n      dockerfile: Dockerfile\n");
    const files = {
      "deployment/images/postgres.Dockerfile": "FROM scratch\n",
      "deployment/edge/Dockerfile": "FROM scratch\n",
    };
    for (const [env, s] of [
      ["prod", { compose: postgres(edgeBuilt(COMPOSE)), files, lock: null }],
      ["dev", { compose: postgres(edgeBuilt(DEV)), files, lock: null, pdsEnv: DEV_ENV }],
    ] as const) {
      const { lines } = await check(s, env);
      const judged = lines.filter((line) => / C2[57] /.test(line)).map((line) => line.replace(/: \/.*\//, ": <root>/"));
      expect(judged, env).toEqual([
        "FAIL C25 input missing: <root>/images.lock.json",
        "FAIL C27 input missing: <root>/images.lock.json",
      ]);
    }
  });

  test("local_still_requires_mail_until_alex_answers", async () => {
    // Architecture record 2026-10-13-p127l-local-gaps, item 2: dropping C11 and C19 under local is Alex's card.
    const noMail = {
      PDS_EMAIL_SMTP_URL: null,
      PDS_MODERATION_EMAIL_SMTP_URL: null,
      PDS_MODERATION_EMAIL_ADDRESS: null,
    };
    const { lines, code } = await local((text) => text, { pdsEnv: { ...LOCAL_ENV, ...noMail } });
    expect(failed(lines)).toEqual(["C11", "C19"]);
    expect(code).toBe(1);
    // Mailpit stays dev's alone: local is held to prod's mail rule.
    const mailpit = await local((text) => text, {
      pdsEnv: { ...LOCAL_ENV, PDS_EMAIL_SMTP_URL: "smtp://mailpit:1025" },
    });
    expect(failed(mailpit.lines)).toEqual(["C11"]);
  });

  test("local_c7_applies_in_full", async () => {
    // Item 2 of the same record: only the crawler rule was ever dev's; the rest of C7 holds on every stack.
    for (const pdsEnv of [
      { PDS_ADMIN_PASSWORD: "short" },
      { PDS_RATE_LIMITS_ENABLED: "true" },
      { PDS_RATE_LIMITS_ENABLED: null },
      { PDS_INVITE_REQUIRED: null },
    ]) {
      const { lines } = await local((text) => text, { pdsEnv: { ...LOCAL_ENV, ...pdsEnv } });
      expect(failed(lines), JSON.stringify(pdsEnv)).toEqual(["C7"]);
    }
  });

  test("dev_and_prod_c18_still_need_the_lock_edge_ref", async () => {
    const built = (text: string) =>
      text.replace(`    image: ${EDGE}\n`, "    build:\n      context: ./edge\n      dockerfile: Dockerfile\n");
    const files = { "deployment/edge/Dockerfile": "FROM scratch\n" };
    for (const [env, s] of [
      ["prod", { compose: built(COMPOSE), files }],
      ["dev", { compose: built(DEV), files, pdsEnv: DEV_ENV }],
    ] as const) {
      const { lines } = await check(s, env);
      expect(lines, env).toContain("FAIL C18 the edge service does not run the lock's edge image");
    }
  });

  test("local_c18_allows_only_the_tls_snippet_and_the_leaf", async () => {
    const c18 = async (edit: (text: string) => string) => (await local(edit)).lines.find((line) => / C18 /.test(line));
    const volume = (line: string) => (text: string) =>
      text.replace("      - ./edge/local/tls.caddy:/etc/caddy/snippets/tls.caddy:ro\n", `$&      - ${line}\n`);
    expect(await c18((text) => text)).toBe("PASS C18 ok");
    // Anything else under /etc/caddy, a writable or other snippet, and any further bind (the dev root's key above all).
    expect(await c18(volume("./edge/snippets:/etc/caddy/snippets/extra:ro"))).toBe(
      "FAIL C18 the edge mounts over /etc/caddy/snippets/extra",
    );
    expect(await c18((text) => text.replace("/etc/caddy/snippets/tls.caddy:ro", "/etc/caddy/snippets/tls.caddy"))).toBe(
      "FAIL C18 the TLS snippet is not mounted read-only",
    );
    expect(await c18((text) => text.replace("./edge/local/tls.caddy:", "./edge/snippets/tls.caddy:"))).toBe(
      "FAIL C18 the TLS snippet is not deployment/edge/local/tls.caddy",
    );
    expect(await c18(volume("../../unset-dev-ca/root.key:/srv/root.key:ro"))).toBe(
      "FAIL C18 the edge binds more than its sites and the local files",
    );
    // The app site's mount waits for P1.34o's reader (book edit 2026-10-13-p127l-to-third-lane, Amendment 1): until the
    // reader reads local/app.caddy with the enabled sites, C18 refuses it as any other mount over the sites.
    const app = "./edge/local/app.caddy:/etc/caddy/sites/enabled/app.caddy:ro";
    expect(await c18(volume(app))).toBe("FAIL C18 the edge mounts over /etc/caddy/sites/enabled/app.caddy");
    expect(await c18(volume("./edge/local/app.caddy:/etc/caddy/sites/enabled/second.caddy:ro"))).toBe(
      "FAIL C18 the edge mounts over /etc/caddy/sites/enabled/second.caddy",
    );
    // A volume at the snippet's target is not the file it names, however it is filled.
    const tls = "      - ./edge/local/tls.caddy:/etc/caddy/snippets/tls.caddy:ro\n";
    expect(
      await c18((text) =>
        text
          .replace(tls, "      - snippet:/etc/caddy/snippets/tls.caddy:ro\n")
          .replace("\nsecrets:", "\nvolumes:\n  snippet: {}\nsecrets:"),
      ),
    ).toBe("FAIL C18 the TLS snippet is not a bind mount");
    // The leaf's two secrets by exact name: another `local_` secret is still another secret.
    expect(
      await c18((text) =>
        text
          .replace("secrets: [local_tls_cert, local_tls_key]", "secrets: [local_tls_cert, local_tls_extra]")
          .replace(
            "  local_tls_key:\n",
            "  local_tls_extra:\n    file: ../../unset-dev-secrets/local_tls_key\n  local_tls_key:\n",
          ),
      ),
    ).toBe("FAIL C18 the edge reads a secret other than the dev leaf's");
    // The reader's local mode: the snippet C18 judges is local/tls.caddy, not the shipped snippets/tls.caddy.
    const broken = await local((text) => text, {
      files: { "deployment/edge/local/tls.caddy": "this is { not caddy\n" },
    });
    expect(broken.lines.find((line) => / C18 /.test(line))).toMatch(/^FAIL C18 the edge config is unreadable: /);
    expect(
      await c18((text) =>
        text.replace("secrets: [local_tls_cert, local_tls_key]", "secrets: [local_tls_cert, db_password]"),
      ),
    ).toBe("FAIL C18 the edge reads a secret other than the dev leaf's");
    // The edge runs what the edge Dockerfile builds, never a pulled image, on local.
    expect(
      await c18((text) =>
        text.replace("    build:\n      context: ./edge\n      dockerfile: Dockerfile\n", `    image: ${EDGE}\n`),
      ),
    ).toBe("FAIL C18 the edge is not built from deployment/edge/Dockerfile");
    // Nor from any other Dockerfile, scanned or not.
    expect(
      await c18((text) =>
        text.replace(
          "    build:\n      context: ./edge\n      dockerfile: Dockerfile\n",
          "    build:\n      context: ..\n      dockerfile: deployment/images/node-app.Dockerfile\n",
        ),
      ),
    ).toBe("FAIL C18 the edge is not built from deployment/edge/Dockerfile");
  });

  // P1.33t (architecture's Amendment 3, S3, to unset-plan/book-edits/2026-10-13-p127l-local-gaps.md): under local
  // the (tls) every site imports is the leaf's, from the local/tls.caddy mount, and nothing else gives a site a
  // certificate.
  test("local_c18_serves_only_the_leaf_snippet", async () => {
    const c18 = async (edit: (text: string) => string, files: Record<string, string> = {}) =>
      (await local(edit, { files })).lines.find((line) => / C18 /.test(line));
    const site = readFileSync(join(EDGE_DIR, "sites/pds.caddy"), "utf8");
    const leaf = readFileSync(join(EDGE_DIR, "local/tls.caddy"), "utf8");
    // Without its mount Caddy serves snippets/tls.caddy, which is not what C18 read under local.
    expect(
      await c18((text) => text.replace("      - ./edge/local/tls.caddy:/etc/caddy/snippets/tls.caddy:ro\n", "")),
    ).toBe("FAIL C18 the TLS snippet is not mounted");
    expect(await c18((text) => text, { "deployment/edge/sites/pds.caddy": site.replace("\timport tls\n", "") })).toBe(
      "FAIL C18 {$PDS_HOST}: does not import tls",
    );
    expect(
      await c18((text) => text, {
        "deployment/edge/sites/pds.caddy": site.replace("\timport tls\n", "$&\ttls internal\n"),
      }),
    ).toBe("FAIL C18 {$PDS_HOST}: has its own tls directive");
    expect(
      await c18((text) => text, {
        "deployment/edge/local/tls.caddy": leaf.replace("(tls) {", "(tls-leaf) {"),
        "deployment/edge/snippets/z.caddy": "(tls) {\n\ttls internal\n}\n",
      }),
    ).toBe("FAIL C18 the (tls) snippet served is not local/tls.caddy");
    // The #789 verify's pins (E7, E9, E10): the snippet's mount twice, another local/ file at its target, and the
    // leaf reached through a link inside local/.
    const mount = "      - ./edge/local/tls.caddy:/etc/caddy/snippets/tls.caddy:ro\n";
    expect(await c18((text) => text.replace(mount, `${mount}${mount}`))).toBe(
      "FAIL C18 the edge mounts /etc/caddy/snippets/tls.caddy more than once",
    );
    expect(await c18((text) => text.replace(mount, mount.replace("local/tls.caddy:", "local/app.caddy:")))).toBe(
      "FAIL C18 the TLS snippet is not deployment/edge/local/tls.caddy",
    );
    const linked = await local((text) => text.replace(mount, mount.replace("local/tls.caddy:", "local/leaf.caddy:")), {
      links: { "deployment/edge/local/leaf.caddy": "tls.caddy" },
    });
    expect(linked.lines.find((line) => / C18 /.test(line))).toBe(
      "FAIL C18 the TLS snippet is not a regular file: deployment/edge/local/tls.caddy",
    );
    // E2 and N2: the edge is the edge Dockerfile's build only when nothing else names it, and C26 passes that build.
    const edgeBuild = "    build:\n      context: ./edge\n      dockerfile: Dockerfile\n";
    expect(await c18((text) => text.replace(edgeBuild, `${edgeBuild}    image: ${EDGE}\n`))).toBe(
      "FAIL C18 the edge is not built from deployment/edge/Dockerfile",
    );
    expect(
      await c18((text) => text.replace("      context: ./edge\n      dockerfile: Dockerfile\n", OFF_CONTEXT_EDGE)),
    ).toBe("FAIL C18 the edge is not built from deployment/edge/Dockerfile");
    // With snippets/tls.caddy gone, the reader reads no leaf in its place, so another file's (tls) is what it judged.
    const gone = await local((text) => text, {
      remove: ["deployment/edge/snippets/tls.caddy"],
      files: { "deployment/edge/snippets/z.caddy": "(tls) {\n\ttls internal\n}\n" },
    });
    expect(gone.lines.find((line) => / C18 /.test(line))).toBe(
      "FAIL C18 the (tls) snippet served is not local/tls.caddy",
    );
  });

  test("dev_and_prod_still_refuse_the_local_file_mounts", async () => {
    for (const [file, target] of [
      ["tls.caddy", "/etc/caddy/snippets/tls.caddy"],
      ["app.caddy", "/etc/caddy/sites/enabled/app.caddy"],
    ]) {
      const mount = (text: string) =>
        text.replace(
          "      - ./edge/sites/enabled:/etc/caddy/sites/enabled:ro\n",
          `$&      - ./edge/local/${file}:${target}:ro\n`,
        );
      for (const [env, s] of [
        ["dev", { compose: mount(DEV), pdsEnv: DEV_ENV }],
        ["prod", { compose: mount(COMPOSE) }],
      ] as const) {
        const { lines } = await check(s, env);
        expect(lines, `${env} ${file}`).toContain(`FAIL C18 the edge mounts over ${target}`);
      }
    }
  });

  test("local_c15_keeps_handles_under_the_local_pds_host", async () => {
    // Architecture record 2026-10-13-p127l-local-gaps, Amendment 2, point 1: a tightening, never prod's rule.
    const c15 = async (domains: string) =>
      (await local((text) => text, { pdsEnv: { PDS_SERVICE_HANDLE_DOMAINS: domains } })).lines.find((line) =>
        / C15 /.test(line),
      );
    expect(await c15(".pds.localhost")).toBe("PASS C15 ok");
    // S5 (the #789 verify): a look-alike that ends in the host's text but not at a label boundary.
    for (const domains of [
      ".example.test",
      ".0x40.space",
      ".other.localhost",
      ".pds.localhost,.example.test",
      ".evil-pds.localhost",
    ]) {
      expect(await c15(domains), domains).toBe("FAIL C15 PDS_SERVICE_HANDLE_DOMAINS is not under the local PDS host");
    }
    expect(await c15(".0x40.me")).toBe("FAIL C15 PDS_SERVICE_HANDLE_DOMAINS includes the profile domain");
    expect(await c15("")).toBe("FAIL C15 PDS_SERVICE_HANDLE_DOMAINS is not set");
    // Mj (book edit 2026-10-13-p127l-verify-owners, item 3): C15's own `.localhost` rule on PDS_HOSTNAME, reached
    // directly. Handles under a PDS host that is not `.localhost` fail, however well they sit under it.
    const host = async (name: string) =>
      (
        await local((text) => text.replace("PDS_HOSTNAME: pds.localhost", `PDS_HOSTNAME: ${name}`), {
          pdsEnv: { PDS_HOSTNAME: name, PDS_SERVICE_HANDLE_DOMAINS: `.${name}` },
        })
      ).lines.find((line) => / C15 /.test(line));
    for (const name of ["pds.example.test", "pds.localhost.example.test", "localhost"]) {
      expect(await host(name), name).toBe("FAIL C15 PDS_SERVICE_HANDLE_DOMAINS is not under the local PDS host");
    }
    expect(await host("pds.localhost")).toBe("PASS C15 ok");
  });

  test("local_takes_dev_c23_skip_and_network_table", async () => {
    // Amendment 2, point 3: both neutral, disclosed and pinned. C23 prints dev's skip, and the table read is dev's.
    const result = await local();
    const devLine = (await check({ compose: DEV, pdsEnv: DEV_ENV }, "dev")).lines.find((line) => / C23 /.test(line));
    expect(result.lines.find((line) => / C23 /.test(line))).toBe(devLine);
    // The table read is dev's: with prod's table unreadable, local still passes C17, and with dev's, it fails it.
    const tables = (dev: string, prod: string) =>
      local((text) => text, {
        networks: TABLE,
        files: { "deployment/networks.dev.json": dev, "deployment/networks.prod.json": prod },
      });
    const prodBroken = await tables(JSON.stringify(TABLE), "not json");
    expect(prodBroken.lines.find((line) => / C17 /.test(line))).toBe("PASS C17 ok");
    const devBroken = await tables("not json", JSON.stringify(TABLE));
    expect(devBroken.lines.find((line) => / C17 /.test(line))).toMatch(/^FAIL C17 /);
  });

  test("env_flag_once_and_exact", async () => {
    // The verifier on #789: parseArgs keeps the last of a repeated flag, so `--env prod --env local` ran the local path.
    const { root, file } = stack();
    const run = async (args: string[]) =>
      (await preflight([...args, "--compose", file], { root, run: fakeRun().run, ...fakeFs(root) })).lines;
    expect(await run(["--env", "prod", "--env", "local"])).toEqual(["ERROR --env may be given once"]);
    expect(await run(["--env", "local", "--env", "local"])).toEqual(["ERROR --env may be given once"]);
    for (const args of [[], ["--env", ""], ["--env", "LOCAL"], ["--env", "Prod"], ["--env", "staging"]]) {
      expect(await run(args), JSON.stringify(args)).toEqual(["ERROR --env must be dev, prod or local"]);
    }
  });
});
