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
    env_file: pds.env
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
    file: secrets/db_password
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
  const root = mkdtempSync(join(tmpdir(), "preflight-"));
  dirs.push(root);
  mkdirSync(join(root, "deployment/secrets"), { recursive: true });
  const secret = (path: string, text: string) => {
    writeFileSync(join(root, path), text);
    chmodSync(join(root, path), 0o600);
  };
  const env = Object.entries({ ...PDS_ENV, ...pdsEnv }).flatMap(([k, v]) => (v === null ? [] : [`${k}=${v}\n`]));
  secret("deployment/pds.env", env.join(""));
  // A mounted secret (P1.30o): mode 0400 in the deploy user's 0700 directory; fakeFs reads it as owned by web's uid.
  secret("deployment/secrets/db_password", `${CANARY}\n`);
  chmodSync(join(root, "deployment/secrets/db_password"), 0o400);
  chmodSync(join(root, "deployment/secrets"), 0o700);
  // C9 judges every parent of the secrets folder, so the fixture sets its own modes whatever the umask.
  chmodSync(join(root, "deployment"), 0o755);
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
 * - a directory above the stack root reads as the root itself (mkdtemp's 0700, the test's uid), because the temporary
 *   directory's own parents (often /tmp, sticky and world writable) are not the stack's to judge;
 * - a file inside a deployment/secrets/ directory reads as owned by `owner`, since a test cannot chown to another uid;
 * - a path named in `uids` reads as owned by that uid.
 */
function fakeFs(root: string, owner = WEB_UID, uids: Record<string, number> = {}): Pick<Deps, "lstat"> {
  const lstat = (path: string): Stats | null => {
    let info: Stats;
    try {
      info = lstatSync(root.startsWith(`${path}/`) || path === "/" ? root : path);
    } catch {
      return null;
    }
    const uid = uids[path] ?? (dirname(path).endsWith("/deployment/secrets") ? owner : info.uid);
    return Object.assign(Object.create(Object.getPrototypeOf(info)), info, { uid });
  };
  return { lstat };
}
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
      const pdsEnv = join(root, "deployment/pds.env");
      for (const mode of [0o644, 0o400]) {
        chmodSync(pdsEnv, mode);
        expect((await run()).lines).toContain(`FAIL C9 ${pdsEnv} must have exactly owner read and write permissions`);
      }
      chmodSync(pdsEnv, 0o600);
      expect(failed((await run()).lines)).toEqual([]);
      const other = (await run({ uid: 4242 })).lines.find((l) => l.startsWith("FAIL C9"));
      expect(other).toBe(`FAIL C9 ${pdsEnv} is not owned by the deploy user`);
    }
    const absent = await check({ compose: COMPOSE.replace("secrets/db_password", "secrets/absent") });
    expect(failed(absent.lines)).toEqual(["C9"]);
  });

  // P1.30o: a mounted secret is mode 0400, owned by the one uid that mounts it, in a 0700 directory of the deploy user.
  test("c9_mounted_secret_owner_and_mode", async () => {
    const path = (root: string) => join(root, "deployment/secrets/db_password");
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
    const dir = join(root, "deployment/secrets");
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
    for (const mode of [0o777, 0o775, 0o1777]) {
      chmodSync(join(root, "deployment"), mode);
      expect((await run()).lines).toContain(parent);
    }
    chmodSync(join(root, "deployment"), 0o755);
    expect((await run({ [join(root, "deployment")]: 4242 })).lines).toContain(parent);
    expect((await run({ [root]: 4242 })).lines).toContain(
      "FAIL C9 parent 2 of the secrets folder can be changed by another user",
    );
    expect(failed((await run({ [root]: 0 })).lines)).toEqual([]);
    // The walk reaches "/" itself.
    const depth = dir.split("/").length - 1;
    expect((await run({ "/": 4242 })).lines).toContain(
      `FAIL C9 parent ${depth} of the secrets folder can be changed by another user`,
    );
    const other = await check({}, "prod", { uid: 4242 });
    expect(other.lines.find((l) => l.startsWith("FAIL C9"))).toMatch(/is not owned by the deploy user$/);
  });

  // P1.27a: the folder is judged where it really is. Docker resolves a bind source again at every start, so a link
  // anywhere on the path lets whoever controls its target swap the secret after the preflight passed.
  test("c9_secrets_path_has_no_links", async () => {
    const linkedFolder = stack();
    const dir = join(linkedFolder.root, "deployment/secrets");
    renameSync(dir, `${dir}-real`);
    symlinkSync(`${dir}-real`, dir);
    const folder = await preflight(["--env", "prod", "--compose", linkedFolder.file], {
      root: linkedFolder.root,
      run: fakeRun().run,
      ...fakeFs(linkedFolder.root),
    });
    expect(folder.lines).toContain(`FAIL C9 ${dir} must be a directory with mode 0700 owned by the deploy user`);
    // A deploy-owned link above the folder, pointing into a tree another user controls.
    const linkedParent = stack();
    const deployment = join(linkedParent.root, "deployment");
    renameSync(deployment, join(linkedParent.root, "elsewhere"));
    symlinkSync(join(linkedParent.root, "elsewhere"), deployment);
    const parent = await preflight(["--env", "prod", "--compose", linkedParent.file], {
      root: linkedParent.root,
      run: fakeRun().run,
      ...fakeFs(linkedParent.root),
    });
    expect(parent.lines).toContain("FAIL C9 parent 1 of the secrets folder is a link or not a directory");
  });

  test("c9_mounted_secret_readers", async () => {
    const pdsReads = (user: string) =>
      COMPOSE.replace("    env_file: pds.env", `    env_file: pds.env\n${user}    secrets: [db_password]`);
    const secret = (root: string) => join(root, "deployment/secrets/db_password");
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
    writeFileSync(join(root, "deployment/real"), "x\n");
    symlinkSync(join(root, "deployment/real"), secret(root));
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
      COMPOSE.replace("    env_file: pds.env", `    env_file: pds.env\n    volumes:\n      - ${source}:/srv:ro`);
    // "/" and a ".." chain that Compose resolves to "/" contain every folder (verifier on #689).
    for (const source of ["./secrets", "./secrets/db_password", ".", "..", "/", "../../../../../../../../../.."]) {
      const result = await check({ compose: binding(source) });
      expect(result.lines.find((l) => l.startsWith("FAIL C9"))).toBe(
        "FAIL C9 pds binds a path that reaches the secrets folder",
      );
    }
    // A link elsewhere in the project that resolves into the folder.
    const { root, file } = stack({ compose: binding("./alias") });
    symlinkSync(join(root, "deployment/secrets"), join(root, "deployment/alias"));
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
    // A link into the folder whose target does not exist yet: Compose would create it there (P1.27u).
    const dangling = stack({ compose: binding("./dangle") });
    symlinkSync("secrets/newdir", join(dangling.root, "deployment/dangle"));
    const dangle = await preflight(["--env", "prod", "--compose", dangling.file], {
      root: dangling.root,
      run: fakeRun().run,
      ...fakeFs(dangling.root),
    });
    expect(dangle.lines).toContain("FAIL C9 pds binds a path that does not exist");
    // A sibling whose name only starts with the folder's name is not inside it.
    const sibling = stack({ compose: binding("./secrets-old") });
    mkdirSync(join(sibling.root, "deployment/secrets-old"), { mode: 0o755 });
    chmodSync(join(sibling.root, "deployment/secrets-old"), 0o755);
    const old = await preflight(["--env", "prod", "--compose", sibling.file], {
      root: sibling.root,
      run: fakeRun().run,
      ...fakeFs(sibling.root),
    });
    expect(failed(old.lines)).toEqual([]);
    // A second name for the folder that no link explains (a host bind mount): matched by (dev, ino), both ways.
    const aliased = stack({ compose: binding("/srv/alias") });
    const folder = join(aliased.root, "deployment/secrets");
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
      const real = join(s.root, "deployment/secrets");
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
    for (const source of ["./secrets", "./secrets/db_password", ".", "..", "/"]) {
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
        "    env_file: pds.env",
        `    env_file: pds.env
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
    // A real path that still holds a link (one swapped in after it was resolved) is refused, not followed.
    const linkedReal = await run("./via", (d) => void symlinkSync(join(d, "data/shared"), join(d, "via")), {
      realpath: (path) => path,
    });
    expect(linkedReal.lines).toContain(changeable);
    expect((await run("./nowhere", () => undefined)).lines).toContain("FAIL C9 pds binds a path that does not exist");
    // /proc resolves in the preflight's own context, not the container's.
    for (const source of ["/proc/self/cwd", "/proc"]) {
      expect((await run(source, () => undefined)).lines).toContain("FAIL C9 pds binds a path under /proc");
    }
  });

  // P1.30o: every mounted secret shares one locked folder, so one directory check covers them all.
  test("c9_mounted_secrets_share_one_folder", async () => {
    const second = COMPOSE.replace("    secrets: [db_password]", "    secrets: [db_password, api_key]").replace(
      "    file: secrets/db_password\n",
      "    file: secrets/db_password\n  api_key:\n    file: other/api_key\n",
    );
    const { root, file } = stack({ compose: second });
    mkdirSync(join(root, "deployment/other"), { mode: 0o700 });
    writeFileSync(join(root, "deployment/other/api_key"), "key\n", { mode: 0o400 });
    const result = await preflight(["--env", "prod", "--compose", file], { root, run: fakeRun().run, ...fakeFs(root) });
    expect(result.lines).toContain("FAIL C9 mounted secrets are not all in one directory");
  });

  test("c10_published_port_fails", async () => {
    await expectOnly("C10", { compose: COMPOSE.replace('"127.0.0.1:2019:2019"', '"2019:2019"') });
    const pdsPort = COMPOSE.replace(
      "    env_file: pds.env",
      '    env_file: pds.env\n    ports: ["127.0.0.1:443:3000"]',
    );
    await expectOnly("C10", { compose: pdsPort });
    const range = COMPOSE.replace("    env_file: pds.env", '    env_file: pds.env\n    ports: ["0.0.0.0:3000:3000"]');
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
    ]) {
      expect((await preflight(argv, { root, run: fakeRun().run })).code).toBe(2);
    }
  });

  // P1.27a (architecture, Amendment 3): Compose resolves a relative --compose against $PWD, Node against the physical
  // cwd, so the two can name different trees. The preflight takes only an absolute, normal path, the one both use.
  test("compose_path_must_be_absolute_and_normal", async () => {
    const { root, file } = stack();
    const refused = { code: 2, lines: ["ERROR --compose must be an absolute, normalised path"] };
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
    // A link on the path the caller names is walked, not resolved away.
    const linked = join(root, "via");
    symlinkSync(dir, linked);
    const viaLink = await preflight(["--env", "prod", "--compose", join(linked, "compose.yaml")], {
      root,
      run: fakeRun().run,
      ...fakeFs(root),
    });
    expect(viaLink.lines).toContain("FAIL C9 parent 1 of the secrets folder is a link or not a directory");
  });

  test("no_repository_script_passes_project_directory", () => {
    // Every script that runs `docker compose` gives it the file list the preflight read, and never moves the base
    // directory (architecture record 2026-10-12-preflight-project-directory, item 3). Docs and tests may name the flags.
    // `--workdir` is Compose's hidden, deprecated alias for the same option (cmd/compose/compose.go in 2.38.2, v5.3.1).
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
    const result = await check({ compose: COMPOSE.replace("env_file: pds.env", "env_file: absent.env") });
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
    '    ports: ["80:80", "443:443", "127.0.0.1:2019:2019"]\n    networks:\n      front:\n        aliases: [edge]\n      inner:',
  )
    .replace("    env_file: pds.env", "    env_file: pds.env\n    networks: [inner]")
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
      COMPOSE.replace("    env_file: pds.env", "    env_file: pds.env\n    networks: [pds_net]")
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
    const mac = NETWORKED.replace("        aliases: [edge]", "        mac_address: 02:42:ac:11:00:02");
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
      const compose = COMPOSE.replace("    env_file: pds.env", `    env_file: pds.env\n    network_mode: ${mode}`);
      const table = { default: { internal: false, members: ["edge", "web"] } };
      expect(await expectOnly("C17", { compose, networks: table })).toBe("FAIL C17 network_mode is set in pds");
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
      // Outside deployment/, an existing regular file with a listable name: only the prefix rule refuses it.
      "other/web.Dockerfile": "FROM scratch\n",
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
