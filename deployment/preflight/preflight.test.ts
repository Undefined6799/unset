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
  realpathSync,
  renameSync,
  rmSync,
  statfsSync,
  statSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { c26 } from "./checks/build.ts";
import { children, der, type Tlv } from "./checks/der.ts";
import { C21_DEV_WAIVER, c21 } from "./checks/host.ts";
import { pdsNeighbours } from "./checks/networks.ts";
import { c32 } from "./checks/placeholders.ts";
import { c9 } from "./checks/secrets.ts";
import { type Check, fail, type Inputs, missing, type Outcome, pass } from "./checks/types.ts";
import { parseCompose } from "./compose-parse.ts";
import { COSIGN, cosignProblem } from "./cosign.ts";
import { type Deps, type Run, preflight as runPreflight, SOURCE_LAST_LINE } from "./index.ts";
import { loadInputs } from "./inputs.ts";
import { printable } from "./printable.ts";
import { SecretMap } from "./secret-map.ts";

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
  PDS_JWT_SECRET: `${CANARY}-jwt`,
  PDS_PLC_ROTATION_KEY_K256_PRIVATE_KEY_HEX: `${CANARY}-plc`,
  PDS_RECOVERY_DID_KEY: RECOVERY_KEY,
  PDS_DID_PLC_URL: "https://plc.directory",
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
  PDS_EMAIL_FROM_ADDRESS: "noreply@example.test",
  PDS_BLOB_UPLOAD_LIMIT: "5242880",
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
    tmpfs: ["/tmp:uid=1000,gid=1000,mode=1777,size=20m"]
    env_file: ../../unset-dev-env/pds.env
    environment:
      PDS_HOSTNAME: pds.example.test
  web:
    image: ${WEB}
    user: "65532:65532"
    networks: [back]
    secrets: [db_password]
    environment:
      FINGERPRINT_CHECK: arachnid
secrets:
  db_password:
    file: ../../unset-dev-secrets/db_password
networks:
  back: {}
`;
const NEWT = `ghcr.io/undefined6799/mirror/newt@${digest("e")}`;
const LOCK = {
  edge: { ref: EDGE, origin: "first-party", verify: "cosign-keyless" },
  pds: { ref: PDS, origin: "upstream", upstreamSource: "docker.io/example/pds", verify: "cosign-keyless" },
  web: { ref: WEB, origin: "first-party", verify: "cosign-keyless" },
  newt: { ref: NEWT, origin: "upstream", upstreamSource: "docker.io/fosrl/newt", verify: "cosign-keyless" },
};
/** Newt under dev (P1.37v): the edge's only way in, so the edge publishes nothing (C10) and Newt reads newt.env (C31). */
const NEWT_SERVICE = `  newt:
    image: ${NEWT}
    env_file: ../../unset-dev-env/newt.env
    environment:
      CONFIG_FILE: /tmp/newt.json
      DISABLE_SSH: "true"
      DISABLE_CLIENTS: "true"
      NEWT_METRICS_PROMETHEUS_ENABLED: "false"
      NEWT_PPROF_ENABLED: "false"
      LOG_LEVEL: WARN
    networks: [tunnel]
`;
/**
 * The dev stack (P1.38e; ADR 0032): the edge runs the lock's image with the dev sites and the dev (tls) over the
 * shipped one, reads the self-signed leaf's two secrets, publishes nothing, and has the dev app site's two keys;
 * Newt beside it (P1.37v).
 */
const DEV = COMPOSE.replace("name: unset-prod", "name: unset-dev")
  .replace('    ports: ["80:80", "443:443", "127.0.0.1:2019:2019"]\n', '    user: "65532:65532"\n')
  .replace(
    "      - ./edge/sites/enabled:/etc/caddy/sites/enabled:ro\n",
    "      - ./edge/dev/app.caddy:/etc/caddy/sites/enabled/app.caddy:ro\n" +
      "      - ./edge/dev/pds.caddy:/etc/caddy/sites/enabled/pds.caddy:ro\n" +
      "      - ./edge/dev/tls.caddy:/etc/caddy/snippets/tls.caddy:ro\n" +
      "    secrets: [dev_tls_cert, dev_tls_key]\n",
  )
  .replace(
    "      ACME_EMAIL: edge@example.test\n",
    "      ACME_EMAIL: edge@example.test\n      APP_HOST: staging.unset.sh\n      APP_UPSTREAM: web:8080\n",
  )
  .replace(
    "    file: ../../unset-dev-secrets/db_password\n",
    "$&  dev_tls_cert:\n    file: ../../unset-dev-secrets/dev_tls_cert\n" +
      "  dev_tls_key:\n    file: ../../unset-dev-secrets/dev_tls_key\n",
  )
  .replace("secrets:\n  db_password:", `${NEWT_SERVICE}$&`)
  .replace("networks:\n  back: {}\n", "$&  tunnel: {}\n")
  // The ruled staging names (P1.37 follow-up): the PDS at staging.unset.ac, web's origin on the dev app host.
  .replaceAll("pds.example.test", "staging.unset.ac")
  .replace("      FINGERPRINT_CHECK: arachnid\n", "$&      PUBLIC_ORIGIN: https://staging.unset.sh\n");
// The dev (staging) PDS's own handle domain, ADR 0025: the dev-environment checks are about that suffix.
const DEV_ENV = { PDS_SERVICE_HANDLE_DOMAINS: ".staging.unset.im" };
/** A from address of 254 or 255 characters, every part within its own cap, so only the length decides. */
const addressOfLength = (length: 254 | 255) =>
  `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(length - 193)}`;
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
  "C28",
  "C29",
  "C30",
  "C31",
  "C32",
]);

type Stack = {
  compose?: string;
  pdsEnv?: Record<string, string | null>;
  /** Raw lines appended to pds.env, after the ones pdsEnv writes there (C30). */
  pdsEnvFile?: string;
  /** newt.env's whole text, where the compose reads it (C31); its three names by default. */
  newtEnvFile?: string;
  lock?: object | null;
  dotEnv?: string;
  /** The retirement report's text; `undefined` writes none, even under --env dev (see `check`). */
  report?: string | undefined;
  /** The network table, written as both networks.dev.json and networks.prod.json: an object, raw text, or none. */
  networks?: object | string | null;
  /** Extra enabled edge sites, by file name. */
  sites?: Record<string, string>;
  /** Leaves out the fixture's sites/enabled folder, so deployment/edge/sites holds only the shipped site, as on main. */
  shippedSitesOnly?: boolean;
  /** Extra files under the root, by repository-relative path (Dockerfiles a build names, P1.30y). */
  files?: Record<string, string>;
};
/**
 * The all-good stack's table: the edge and the PDS on Compose's implicit default network, and web on its own, since only
 * the edge may share a network with the PDS (architecture 2026-10-15 02:05Z, option C point 4).
 */
const TABLE = {
  default: { internal: false, members: ["edge", "pds"] },
  back: { internal: false, members: ["web"] },
};
/** The dev stack's table: TABLE plus Newt's own network. */
const DEV_TABLE = { ...TABLE, tunnel: { internal: false, members: ["newt"] } };
const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** The stack's secrets folder: `unset-dev-secrets` beside the checkout, as the compose file names it. */
const secretsOf = (root: string) => join(dirname(root), "unset-dev-secrets");
/** The folder of the env files Compose reads: `unset-dev-env` beside the checkout. */
const envOf = (root: string) => join(dirname(root), "unset-dev-env");
/** The dev root CA's key folder: `unset-dev-ca` beside the checkout (P1.33w). */
const devCaOf = (root: string) => join(dirname(root), "unset-dev-ca");

/** The names the fixture keeps in pds.env, as C30 wants them under dev and prod. */
const PDS_ENV_FILE_NAMES = new Set([
  "PDS_JWT_SECRET",
  "PDS_ADMIN_PASSWORD",
  "PDS_PLC_ROTATION_KEY_K256_PRIVATE_KEY_HEX",
  "PDS_RECOVERY_DID_KEY",
  "PDS_EMAIL_SMTP_URL",
  "PDS_MODERATION_EMAIL_SMTP_URL",
]);

/** The names newt.env holds (C31). */
const NEWT_ENV_NAMES = ["PANGOLIN_ENDPOINT", "NEWT_ID", "NEWT_SECRET"];

/** Writes a stack (the all-good one unless overridden) and returns its root and compose path. */
function stack({
  compose = COMPOSE,
  pdsEnv = {},
  pdsEnvFile = "",
  newtEnvFile,
  lock = LOCK,
  dotEnv,
  report,
  networks = TABLE,
  sites,
  shippedSitesOnly = false,
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
  // As in the real stack (C30, P1.36q): pds.env holds the PDS's secrets and mail URLs, and every other setting is a
  // literal at the top of the pds service's environment. A compose whose pds has no environment keeps them in pds.env.
  const entries = Object.entries({ ...PDS_ENV, ...pdsEnv }).filter((e): e is [string, string] => e[1] !== null);
  const pdsBlock = /\n {2}pds:\n(?: {4}.*\n)*? {4}environment:\n/.exec(compose);
  // A setting the test already wrote into pds's environment stays as written there.
  const pdsText = pdsBlock === null ? "" : (compose.slice(pdsBlock.index + 1).split(/\n {2}\S/)[0] ?? "");
  const written = (k: string) => pdsText.includes(`\n      ${k}:`);
  const literal = (k: string) => !PDS_ENV_FILE_NAMES.has(k) && pdsBlock !== null;
  const env = entries.filter(([k]) => !literal(k)).map(([k, v]) => `${k}=${v}\n`);
  const settings = entries
    .filter(([k]) => literal(k) && !written(k))
    .map(([k, v]) => `      ${k}: ${JSON.stringify(v)}\n`);
  if (pdsBlock !== null) {
    const at = pdsBlock.index + pdsBlock[0].length;
    compose = compose.slice(0, at) + settings.join("") + compose.slice(at);
  }
  // The env files Compose reads (P1.27u): beside the checkout too, in their own 0700 folder, never in a build context.
  writeFileSync(join(envOf(root), "pds.env"), env.join("") + pdsEnvFile);
  chmodSync(join(envOf(root), "pds.env"), 0o600);
  if (compose.includes("unset-dev-env/newt.env")) {
    writeFileSync(
      join(envOf(root), "newt.env"),
      newtEnvFile ?? `PANGOLIN_ENDPOINT=https://${CANARY}.example.test\nNEWT_ID=${CANARY}\nNEWT_SECRET=${CANARY}\n`,
    );
    chmodSync(join(envOf(root), "newt.env"), 0o600);
  }
  // A mounted secret (P1.30o): mode 0400 in the deploy user's 0700 directory; fakeFs reads it as owned by web's uid.
  writeFileSync(join(secretsOf(root), "db_password"), `${CANARY}\n`);
  chmodSync(join(secretsOf(root), "db_password"), 0o400);
  // The dev edge's leaf and key (P1.38e), when the stack mounts them.
  for (const name of ["dev_tls_cert", "dev_tls_key"].filter((n) =>
    compose.includes(`file: ../../unset-dev-secrets/${n}`),
  )) {
    writeFileSync(join(secretsOf(root), name), "fixture\n");
    chmodSync(join(secretsOf(root), name), 0o400);
  }
  chmodSync(secretsOf(root), 0o700);
  // C9 judges every parent of the secrets folder and of each bind source, so the fixture sets its own modes whatever
  // the umask.
  for (const dir of [root, join(root, "deployment")]) chmodSync(dir, 0o755);
  if (dotEnv !== undefined) secret("deployment/.env", dotEnv);
  if (lock !== null) writeFileSync(join(root, "deployment/images.lock.json"), JSON.stringify(lock));
  mkdirSync(join(root, "deployment/sigstore"));
  writeFileSync(join(root, "deployment/sigstore/trusted_root.json"), "{}\n");
  writeFileSync(join(root, "deployment/compose.yaml"), compose);
  // The shipped edge config, with the PDS site enabled the way an environment enables it (C18).
  const edge = join(root, "deployment/edge");
  for (const part of ["Caddyfile", "snippets", "sites", "dev"])
    cpSync(join(EDGE_DIR, part), join(edge, part), { recursive: true });
  // C9 judges every bind source and its parents too (P1.27u), so these get fixed modes whatever the umask.
  for (const dir of [edge, join(edge, "sites"), join(edge, "dev")]) chmodSync(dir, 0o755);
  if (!shippedSitesOnly) {
    mkdirSync(join(edge, "sites/enabled"), { mode: 0o755 });
    chmodSync(join(edge, "sites/enabled"), 0o755);
    symlinkSync(join(edge, "sites/pds.caddy"), join(edge, "sites/enabled/pds.caddy"));
  }
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
type Answers = {
  verify?: { code: number; stderr: string };
  mediaType?: string;
  ntp?: Answer;
  chrony?: Answer;
  cosign?: Answer;
};
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
    // The pinned x64 cosign (P2.26b), unless a test hands another sum.
    if (file === "sha256sum") return answers.cosign ?? ok(`${COSIGN.sha256.x64}  ${COSIGN.path}\n`);
    if (file === "docker") {
      const mediaType = answers.mediaType ?? "application/vnd.oci.image.index.v1+json";
      return { code: 0, stdout: JSON.stringify({ mediaType }), stderr: "" };
    }
    return { code: 0, stdout: "", stderr: "", ...answers.verify };
  };
  return { run, calls };
}

/** The preflight on an x64 host, the cosign fakeRun answers for, so the suite passes on any host (P2.26v). */
const preflight = (args: string[], deps: Deps) => runPreflight(args, { arch: "x64", ...deps });

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
/**
 * fakeFs, with a statfs that runs `act` once, right after the walk first judged `target`: its statfs is the walk's last
 * look at an entry (shared/host-pin walk.ts), so `act` lands between the walk and the open.
 */
function afterWalk(root: string, target: string, act: () => void): Pick<Deps, "lstat" | "statfs"> {
  let done = false;
  return {
    ...fakeFs(root),
    statfs: (path) => {
      const info = statfsSync(path);
      if (path === target && !done) {
        done = true;
        act();
      }
      return info;
    },
  };
}
/** fakeFs's lstat, which runs `act` once, just before it looks at `target` the second time. */
function beforeSecondLook(root: string, target: string, act: () => void): Pick<Deps, "lstat"> {
  const { lstat } = fakeFs(root);
  let looks = 0;
  return {
    lstat: (path) => {
      if (path === target && ++looks === 2) act();
      return lstat?.(path) ?? null;
    },
  };
}
/**
 * An env reader with no walk, for tests of C9's own rules on the folders the env files share with the secrets folder:
 * the real reader walks first and would stop the run there before C9 runs (P1.34r).
 */
const unwalkedEnv: Pick<Deps, "readEnv"> = {
  readEnv: (path) => {
    try {
      return { text: readFileSync(path, "utf8"), file: statSync(path) };
    } catch {
      return null;
    }
  },
};
/** A complete retirement report (C21): prod and local on the old host need one; dev is waived (Alex, 2026-10-21). */
const PART_A_DONE = '{"retirement_part_a_complete": true}';
async function check(s: Stack = {}, env = "prod", deps: Partial<Deps> = {}) {
  // A dev pass fixture carries the complete report unless the test names its own (`report: undefined` for none).
  const withReport = env === "dev" && !("report" in s) ? { ...s, report: PART_A_DONE } : s;
  const { root, file } = stack(
    env === "dev" && !("networks" in s) ? { ...withReport, networks: DEV_TABLE } : withReport,
  );
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

/** C2's line for a build under dev or prod (P1.37n): every build C25 to C27 judge there fails C2 as well. */
const BUILD_REFUSED = /^FAIL C2 \S+ has a build; dev and prod run only registry images$/;
/** `failed` without C2, after checking that C2 failed on the build and on nothing else. */
function failedBesideBuild(lines: string[]): (string | undefined)[] {
  expect(lines.find((l) => l.startsWith("FAIL C2"))).toMatch(BUILD_REFUSED);
  return failed(lines).filter((id) => id !== "C2");
}
/** `expectOnly` for a stack with a build: `id` fails, and C2 fails only on the build. */
async function expectOnlyBesideBuild(id: string, s: Stack, env = "prod", deps: Partial<Deps> = {}) {
  const result = await check(s, env, deps);
  expect(failedBesideBuild(result.lines)).toEqual([id]);
  expect(result.code).toBe(1);
  return result.lines.find((l) => l.startsWith(`FAIL ${id}`));
}

/** As expectOnly, for a name pds.env must hold (P1.36q): leaving it out fails its own check and C30's exact set. */
async function expectWithC30(id: string, s: Stack, env = "prod") {
  const result = await check(s, env);
  expect(failed(result.lines)).toEqual([id, "C30"]);
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
    // Not the lock's edge ref, so C18 fails too (P1.30w), C25, because the edge adds a capability (P1.30x), and C17,
    // because a service that is not the edge shares a network with the PDS (P1.35o).
    for (const image of [
      `docker.io/library/caddy@${digest("a")}`,
      "ghcr.io/undefined6799/edge:latest",
      `ghcr.io/undefined6799/edge@${digest("c")}`,
    ]) {
      const result = await check({ compose: COMPOSE.replace(EDGE, image) });
      expect(failed(result.lines), image).toEqual(["C2", "C17", "C18", "C25"]);
      expect(result.code, image).toBe(1);
    }
  });

  test("c2_dev_migrate_built_from_checkout_fails", async () => {
    // P1.36r (architecture's section labelled 04:20Z): migrate runs schema changes with migration privileges, so under
    // dev it is digest-pinned like every other image, and C3 verifies its signature. A build from the checkout, as
    // compose.dev.yaml had until P2.26b, fails C2 under dev and prod alike; only --env local takes the unsigned path.
    const migrate = [
      "  migrate:",
      "    build:",
      "      context: ..",
      "      dockerfile: deployment/images/migrate.Dockerfile",
      '    user: "65532:65532"',
      "    networks: [db]",
    ].join("\n");
    for (const env of ["dev", "prod"] as const) {
      const compose = (env === "dev" ? DEV : COMPOSE)
        .replace("secrets:\n  db_password:", `${migrate}\n$&`)
        .replace("  back: {}", "$&\n  db: {}");
      const stack: Stack = {
        compose,
        ...(env === "dev" ? { pdsEnv: DEV_ENV } : {}),
        networks: { ...(env === "dev" ? DEV_TABLE : TABLE), db: { internal: false, members: ["migrate"] } },
        files: { "deployment/images/migrate.Dockerfile": "FROM scratch\n" },
      };
      expect(await expectOnly("C2", stack, env), env).toBe(
        "FAIL C2 migrate has a build; dev and prod run only registry images",
      );
    }
  });

  test("c2_build_beside_a_locked_image_fails_under_dev_and_prod", async () => {
    // P1.37n (architecture 07:24Z on verify-1079 M1): a locked digest beside a build doesn't hold, because Compose
    // builds the bytes from the checkout. Under dev and prod any build fails C2, and the run exits non-zero.
    const build = "    build:\n      context: ..\n      dockerfile: deployment/images/node-app.Dockerfile\n";
    for (const env of ["dev", "prod"] as const) {
      const stack: Stack = {
        compose: (env === "dev" ? DEV : COMPOSE).replace(`    image: ${WEB}\n`, `$&${build}`),
        ...(env === "dev" ? { pdsEnv: DEV_ENV } : {}),
        files: { "deployment/images/node-app.Dockerfile": "FROM scratch\n" },
      };
      expect(await expectOnly("C2", stack, env), env).toBe(
        "FAIL C2 web has a build; dev and prod run only registry images",
      );
    }
  });

  test("missing_input_fails_check_not_run", async () => {
    const result = await check({ lock: null });
    expect(result.lines.find((l) => l.startsWith("FAIL C2"))).toMatch(/^FAIL C2 input missing: .*images\.lock\.json$/);
    // C18 reads the lock's edge ref (P1.30w), C25 does for the edge's cap_add (P1.30x), and C17 to know the edge beside
    // the PDS (P1.35o), so all three fail closed without the lock, and without the edge entry alone.
    expect(failed(result.lines)).toEqual(["C2", "C3", "C4", "C5", "C17", "C18", "C25"]);
    expect(result.code).toBe(1);
    const { edge: _, ...noEdge } = LOCK;
    const unlisted = (await check({ lock: noEdge })).lines;
    expect(failed(unlisted)).toEqual(["C2", "C17", "C18", "C25"]);
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

  test("c3_c4_unknown_origin_fails_both", async () => {
    // verify-images fails an entry of neither origin by name; it belongs to neither check, so it fails both.
    const lock = { ...LOCK, web: { ...LOCK.web, origin: "third-party" } };
    const stderr = "web: ref is not ours by digest, signed keyless\n";
    const result = await check({ lock }, "prod", { run: fakeRun({ verify: { code: 1, stderr } }).run });
    expect(failed(result.lines)).toEqual(["C3", "C4"]);
    expect(result.lines).toContain("FAIL C4 web: ref is not ours by digest, signed keyless");
  });

  test("cosign_hash_mismatch_refused", async () => {
    // P2.26b: before C3 and C4 verify anything, the preflight hashes the cosign it is about to run; another binary, an
    // unreadable one or sha256sum's failure refuses both, and verify-images never runs.
    const other = ok(`${"0".repeat(64)}  ${COSIGN.path}\n`);
    // v3.1.3's own arm64 binary, which no deploy host runs (the images are amd64 only).
    const otherArch = ok(`c5d324e091826b0d7a78eb16fef316450b4eb9aaec045611c08ba06f5e73220a  ${COSIGN.path}\n`);
    for (const cosign of [other, otherArch, ok(""), { code: 1, stdout: "", stderr: "No such file" }]) {
      const { run, calls } = fakeRun({ cosign });
      const result = await check({}, "prod", { run });
      expect(failed(result.lines)).toEqual(["C3", "C4"]);
      expect(result.lines).toContain(`FAIL C3 cosign at ${COSIGN.path} is not the pinned v3.1.3 binary`);
      expect(calls.some(([file]) => file === "/usr/bin/env")).toBe(false);
    }
    // The pinned binary passes, and verify-images then runs offline with only cosign's folder on PATH.
    const { run, calls } = fakeRun();
    expect(failed((await check({}, "prod", { run })).lines)).toEqual([]);
    expect(calls).toContainEqual(["sha256sum", "--", "/usr/local/bin/cosign"]);
    const verify = calls.find(([file]) => file === "/usr/bin/env") ?? [];
    expect(verify.slice(0, 3)).toEqual(["/usr/bin/env", "PATH=/usr/local/bin", process.execPath]);
    expect(verify.slice(-2)).toEqual([
      "--trusted-root",
      expect.stringMatching(/\/deployment\/sigstore\/trusted_root\.json$/),
    ]);
  });

  test("cosign_pins_are_v3_1_3", () => {
    // sigstore/cosign v3.1.3 cosign_checksums.txt; the workflows install the same amd64 binary.
    expect(COSIGN).toEqual({
      path: "/usr/local/bin/cosign",
      version: "v3.1.3",
      sha256: { x64: "4629c757b7618056f8ddd7e2625ae9fdd94c0372a65049520bc7d9df9efc7f71" },
    });
  });

  test("cosign_arm64_host_refused", async () => {
    // publish-images.yml builds linux/amd64 only, so an arm64 host could pass C3 to C5 and then fail at compose up; it
    // fails C3 and C4 first, without hashing anything.
    const { run, calls } = fakeRun();
    expect(await cosignProblem(run, "arm64", new AbortController().signal)).toBe("no cosign is pinned for arm64");
    expect(calls).toEqual([]);
  });

  test("c3_c4_fail_on_an_arm64_host", async () => {
    // The host's architecture reaches the verifier through the preflight's deps (P2.26v), so this refusal holds there.
    const { run, calls } = fakeRun();
    const result = await check({}, "prod", { run, arch: "arm64" });
    expect(result.lines).toContain("FAIL C3 no cosign is pinned for arm64");
    expect(result.lines).toContain("FAIL C4 no cosign is pinned for arm64");
    expect(calls.filter(([file]) => file === "sha256sum")).toEqual([]);
  });

  test("c3_c4_read_the_host_arch_without_a_dep", async () => {
    // Without deps.arch the CLI's own process.arch decides, never a fixed x64, so a real arm64 host is still refused.
    const { root, file } = stack();
    const { run, calls } = fakeRun();
    const real = Object.getOwnPropertyDescriptor(process, "arch");
    Object.defineProperty(process, "arch", { value: "arm64", configurable: true });
    try {
      const { lines } = await runPreflight(["--env", "prod", "--compose", file], { root, run, ...fakeFs(root) });
      expect(lines).toContain("FAIL C3 no cosign is pinned for arm64");
      expect(calls.filter(([name]) => name === "sha256sum")).toEqual([]);
    } finally {
      if (real !== undefined) Object.defineProperty(process, "arch", real);
    }
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
    expect(await expectWithC30("C6", { pdsEnv: { PDS_RECOVERY_DID_KEY: null } })).toContain("cannot be added");
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
      const { root, file } = stack(
        env === "dev" ? { compose: DEV, pdsEnv: DEV_ENV, report: PART_A_DONE, networks: DEV_TABLE } : {},
      );
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
    // (Amendment 6). The reader now walks and fstats before it reads (P1.34r), so these stop the run unread.
    const { root, file } = stack();
    const pdsEnv = join(envOf(root), "pds.env");
    const run = (uids: Record<string, number> = {}) =>
      preflight(["--env", "prod", "--compose", file], { root, run: fakeRun().run, ...fakeFs(root, WEB_UID, uids) });
    const stopped = (why: string) => ({ code: 2, lines: [`ERROR ${pdsEnv} ${why}`] });
    linkSync(pdsEnv, join(dirname(root), "pds.env.copy"));
    expect(await run()).toEqual(stopped("has more than one hard link"));
    rmSync(join(dirname(root), "pds.env.copy"));
    expect(await run({ [envOf(root)]: 2000 })).toEqual(stopped("lies on a path that another user can change"));
    renameSync(pdsEnv, join(envOf(root), "real.env"));
    symlinkSync("real.env", pdsEnv);
    expect(failed((await run()).lines)).toEqual([]);
    expect(await run({ [pdsEnv]: 2000 })).toEqual(stopped("lies on a path that another user can change"));
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
    symlinkSync(join(viaLink.root, "deployment/edge/edge.test.env"), join(envOf(viaLink.root), "dev-public.env"));
    writeFileSync(viaLink.file, COMPOSE.replace("../../unset-dev-env/pds.env", "../../unset-dev-env/dev-public.env"));
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
    writeFileSync(join(envOf(root), "dev-public.env"), readFileSync(join(envOf(root), "pds.env")));
    chmodSync(join(envOf(root), "dev-public.env"), 0o600);
    writeFileSync(
      file,
      readFileSync(file, "utf8").replace("../../unset-dev-env/pds.env", "../../unset-dev-env/dev-public.env"),
    );
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

  // P1.34p Amendment 2, item 2, and P1.34r (architecture Amendment 9, B1): an env file is walked, then opened, then
  // fstat'ed, and read only from that descriptor, so nothing at a refused path is ever read.
  test("c9_env_file_read_safely", async () => {
    const { root, file } = stack();
    const pdsEnv = join(envOf(root), "pds.env");
    rmSync(pdsEnv);
    execFileSync("mkfifo", ["-m", "600", pdsEnv]);
    // A FIFO with no writer would block a plain read for ever; the preflight stops instead, by the suite's own limit.
    const fifo = await preflight(["--env", "prod", "--compose", file], { root, run: fakeRun().run, ...fakeFs(root) });
    expect(fifo).toEqual({ code: 2, lines: [`ERROR ${pdsEnv} is not a regular file`] });
    // A real swap between the walk and the open: the walk met one file, the descriptor holds another. The reader is the
    // real one; only the walk's statfs is the hook that renames the other file into place once the walk has judged it.
    const swapped = stack();
    const swappedEnv = join(envOf(swapped.root), "pds.env");
    const other = join(envOf(swapped.root), "other.env");
    writeFileSync(other, readFileSync(swappedEnv));
    chmodSync(other, 0o600);
    const result = await preflight(["--env", "prod", "--compose", swapped.file], {
      root: swapped.root,
      run: fakeRun().run,
      ...afterWalk(swapped.root, swappedEnv, () => renameSync(other, swappedEnv)),
    });
    expect(result).toEqual({ code: 2, lines: [`ERROR ${swappedEnv} changed while the preflight read it`] });
  });

  // P1.34r step 4: a 64 KiB cap from the fstat size, so a huge file is refused before any of it is read.
  test("env_reader_refuses_an_oversize_file_unread", async () => {
    const { root, file } = stack();
    const pdsEnv = join(envOf(root), "pds.env");
    const run = () => preflight(["--env", "prod", "--compose", file], { root, run: fakeRun().run, ...fakeFs(root) });
    const text = readFileSync(pdsEnv, "utf8");
    // Exactly the cap is read; one byte more is refused. Comment lines keep the values as they were.
    const padded = (size: number) => `${text}${"#".repeat(size - Buffer.byteLength(text) - 1)}\n`;
    writeFileSync(pdsEnv, padded(64 * 1024));
    expect((await run()).code).not.toBe(2);
    writeFileSync(pdsEnv, padded(64 * 1024 + 1));
    expect(await run()).toEqual({ code: 2, lines: [`ERROR ${pdsEnv} is larger than 64 KiB`] });
    // A sparse 3 GiB file: a reader that read it in full would fail on its size or run out of memory, not refuse it.
    truncateSync(pdsEnv, 3 * 1024 ** 3);
    expect(await run()).toEqual({ code: 2, lines: [`ERROR ${pdsEnv} is larger than 64 KiB`] });
  });

  // P1.34r step 2 (mutant M6, an open without O_NOFOLLOW): the walk met the file, and a link to that same file then
  // took its name. Followed, the link would reach the walk's (dev, ino); O_NOFOLLOW refuses it instead.
  test("env_reader_opens_without_following_a_link", async () => {
    const { root, file } = stack();
    const pdsEnv = join(envOf(root), "pds.env");
    const moved = join(envOf(root), "moved.env");
    const result = await preflight(["--env", "prod", "--compose", file], {
      root,
      run: fakeRun().run,
      ...afterWalk(root, pdsEnv, () => {
        renameSync(pdsEnv, moved);
        symlinkSync(moved, pdsEnv);
      }),
    });
    expect(result).toEqual({ code: 2, lines: [`ERROR cannot read ${pdsEnv}`] });
  });

  // Mutant M17: the project's .env may be absent, but one the walk found and the reader then cannot open is an ERROR,
  // never read as absent (which would interpolate every name as empty).
  test("env_reader_errors_on_an_unreadable_dot_env", async () => {
    const { root, file } = stack({ dotEnv: "HOST_NAME=pds.example.test\n" });
    const dotEnv = join(root, "deployment/.env");
    const result = await preflight(["--env", "prod", "--compose", file], {
      root,
      run: fakeRun().run,
      ...afterWalk(root, dotEnv, () => rmSync(dotEnv)),
    });
    expect(result).toEqual({ code: 2, lines: [`ERROR cannot read ${dotEnv}`] });
  });

  // P1.34r: the reader keeps every (dev, ino) a path was read from. The .env is read twice; a whole file swapped in
  // between, itself walked, opened and fstat'ed as one file, still means the values came from two files.
  test("env_reader_keeps_every_read_of_a_path", async () => {
    const { root, file } = stack({ dotEnv: "HOST_NAME=pds.example.test\n" });
    const dotEnv = join(root, "deployment/.env");
    const other = join(root, "deployment/.env.other");
    writeFileSync(other, readFileSync(dotEnv));
    chmodSync(other, 0o600);
    const result = await preflight(["--env", "prod", "--compose", file], {
      root,
      run: fakeRun().run,
      ...beforeSecondLook(root, dotEnv, () => renameSync(other, dotEnv)),
    });
    expect(result.lines).toContain(`FAIL C9 ${dotEnv} changed after the preflight read it`);
  });

  // P1.34p Amendment 2, item 3: FUSE (FUSE_SUPER_MAGIC, linux/magic.h) is refused beside procfs.
  test("c9_fuse_refused", async () => {
    const FUSE = 0x65735546;
    const { root, file } = stack();
    const onFuse = (where: string, reader: Partial<Deps> = {}) =>
      preflight(["--env", "prod", "--compose", file], {
        root,
        run: fakeRun().run,
        ...fakeFs(root),
        ...reader,
        statfs: (path) => ({ type: path === where ? FUSE : 0xef53 }),
      });
    for (const where of [secretsOf(root), dirname(secretsOf(root))]) {
      expect((await onFuse(where, unwalkedEnv)).lines, where).toContain("FAIL C9 the secrets folder is on FUSE");
    }
    // An env file on FUSE stops the run in the reader's walk, before any of it is read (P1.34r).
    expect(await onFuse(envOf(root))).toEqual({
      code: 2,
      lines: [`ERROR ${join(envOf(root), "pds.env")} lies on a path through a FUSE file system`],
    });
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
      preflight(["--env", "prod", "--compose", file], {
        root,
        run: fakeRun().run,
        ...fakeFs(root, WEB_UID, uids),
        ...unwalkedEnv,
      });
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
        ...unwalkedEnv,
        statfs: (path) => ({ type: path === onProc ? 0x9fa0 : 0xef53 }),
      });
      expect(procfs.lines).toContain("FAIL C9 the secrets folder is on procfs");
    }
    // The walk reaches "/" itself.
    const depth = dir.split("/").length - 1;
    expect((await run({ "/": 4242 })).lines).toContain(
      `FAIL C9 parent ${depth} of the secrets folder can be changed by another user`,
    );
    const other = await check({}, "prod", { uid: 4242, ...unwalkedEnv });
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

  // P1.33w, P1.34d item 6 (record 2026-10-12-p134c-p134d-local-dev-root-ca, point 6): nothing ever binds the dev root
  // CA's key folder, `unset-dev-ca` beside the checkout, whether it exists yet or not.
  test("c9_bind_mount_reaching_dev_ca_fails", async () => {
    const binding = (source: string) =>
      COMPOSE.replace(
        "    env_file: ../../unset-dev-env/pds.env",
        `    env_file: ../../unset-dev-env/pds.env\n    volumes:\n      - ${source}:/srv:ro`,
      );
    const reaches = "FAIL C9 pds binds a path that reaches the dev CA folder";
    const bind = async (source: string, setUp: (root: string) => void = () => undefined) => {
      const s = stack({ compose: binding(source) });
      setUp(s.root);
      return preflight(["--env", "prod", "--compose", s.file], { root: s.root, run: fakeRun().run, ...fakeFs(s.root) });
    };
    const made = (root: string) => {
      mkdirSync(devCaOf(root), { mode: 0o700 });
      writeFileSync(join(devCaOf(root), "root.key"), "fixture\n", { mode: 0o400 });
    };
    for (const source of ["../../unset-dev-ca", "../../unset-dev-ca/root.key", "../../unset-dev-ca/newdir"]) {
      expect((await bind(source, made)).lines, source).toContain(reaches);
    }
    // Before the folder exists: Compose would create it as root, and the root key would land in a bound folder. A child
    // of the missing folder too.
    expect((await bind("../../unset-dev-ca")).lines).toContain(reaches);
    expect((await bind("../../unset-dev-ca/newdir")).lines).toContain(reaches);
    // A parent of the folder, with no secrets folder or env file that would be refused first.
    const bare = (source: string) =>
      binding(source)
        .replace("    env_file: ../../unset-dev-env/pds.env\n", "")
        .replace("    secrets: [db_password]\n", "")
        .replace("secrets:\n  db_password:\n    file: ../../unset-dev-secrets/db_password\n", "");
    for (const made of [false, true]) {
      const s = stack({ compose: bare("../..") });
      if (made) mkdirSync(devCaOf(s.root), { mode: 0o700 });
      const parent = await preflight(["--env", "prod", "--compose", s.file], {
        root: s.root,
        run: fakeRun().run,
        ...fakeFs(s.root),
      });
      expect(
        parent.lines.filter((line) => / C9 /.test(line)),
        String(made),
      ).toEqual([reaches]);
    }
    // The folder itself a link to another place: a bind of that place reaches it by its real path.
    const moved = (root: string) => {
      mkdirSync(join(dirname(root), "store/ca"), { recursive: true, mode: 0o700 });
      chmodSync(join(dirname(root), "store"), 0o755);
      symlinkSync("store/ca", devCaOf(root));
    };
    const movedLines = (await bind("../../store", moved)).lines;
    expect(movedLines).toContain(reaches);
    // And C26 refuses the folder itself: no dev CA folder, real or a link, belongs on a prod host (verify-887 N5).
    expect(movedLines).toContain("FAIL C26 dev CA folder present on a prod host");
    // A link in the project that resolves into it.
    const linked = (root: string) => {
      made(root);
      symlinkSync(devCaOf(root), join(root, "deployment/alias"));
    };
    expect((await bind("./alias", linked)).lines).toContain(reaches);
    // A second name no link explains (a host bind mount), by (dev, ino).
    const s = stack({ compose: binding("/srv/alias") });
    made(s.root);
    const folder = devCaOf(s.root);
    const alias = await preflight(["--env", "prod", "--compose", s.file], {
      root: s.root,
      run: fakeRun().run,
      ...fakeFs(s.root),
      realpath: (path) => path,
      stat: (path) =>
        path === "/srv/alias" ? statSync(folder) : path.startsWith(dirname(folder)) ? statOrNull(path) : null,
    });
    expect(alias.lines).toContain(reaches);
    // A sibling whose name only starts with the folder's name is not inside it.
    const old = await bind("../../unset-dev-ca-old", (root) => {
      mkdirSync(`${devCaOf(root)}-old`);
      chmodSync(`${devCaOf(root)}-old`, 0o755);
    });
    expect(failed(old.lines)).toEqual([]);
  });

  // P1.33w (verify-861 S1): a file secret or env file in the dev CA folder is bind-mounted or read like any other, so
  // the folder is refused there too, whoever owns the file.
  test("c9_secret_or_env_file_in_dev_ca_fails", async () => {
    const inCa = "FAIL C9 a secret or env file is in the dev CA folder";
    const run = async (compose: string, file: string) => {
      const s = stack({ compose });
      mkdirSync(devCaOf(s.root), { mode: 0o700 });
      writeFileSync(join(devCaOf(s.root), file), "fixture=1\n", { mode: 0o400 });
      return preflight(["--env", "prod", "--compose", s.file], { root: s.root, run: fakeRun().run, ...fakeFs(s.root) });
    };
    const secret = await run(
      COMPOSE.replace("../../unset-dev-secrets/db_password", "../../unset-dev-ca/root.key"),
      "root.key",
    );
    expect(secret.lines.filter((line) => / C9 /.test(line))).toEqual([inCa]);
    const env = await run(COMPOSE.replace("../../unset-dev-env/pds.env", "../../unset-dev-ca/pds.env"), "pds.env");
    expect(env.lines.filter((line) => / C9 /.test(line))).toEqual([inCa]);
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
    const asFolder = (path: string) => statOrNull(path === "/srv/alias" ? folder : path);
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
          return to === null || to === undefined ? null : statOrNull(to);
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
    // Thrown on the bind source's walk only: the env reader walks with the same statfs, and stops the run first.
    const throwing = {
      statfs: (path: string) => {
        if (path.includes("/deployment/data")) throw Object.assign(new Error("denied"), { code: "EACCES" });
        return { type: 0xef53 };
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

  test("c10_dev_publishes_nothing", async () => {
    // P1.37v (ADR 0030 Decision 2, ADR 0031 Decision 2): under dev Newt alone reaches the edge, so no service publishes,
    // not even the edge on loopback; prod keeps the edge's 80 and 443.
    const dev = { pdsEnv: DEV_ENV };
    expect(failed((await check({ ...dev, compose: DEV }, "dev")).lines)).toEqual([]);
    const edgePort = (port: string) => DEV.replace("    cap_add: [NET_BIND_SERVICE]\n", `$&    ports: ["${port}"]\n`);
    // C18 refuses a published edge port under dev too (P1.38e).
    for (const port of ["80:80", "127.0.0.1:443:443", "127.0.0.1:2019:2019"]) {
      const { lines } = await check({ ...dev, compose: edgePort(port) }, "dev");
      expect(failed(lines), port).toEqual(["C10", "C18"]);
      expect(lines, port).toContain("FAIL C10 edge publishes a port under dev");
      expect(lines, port).toContain("FAIL C18 the edge publishes a port under dev");
    }
    const newtPort = DEV.replace("    networks: [tunnel]\n", '$&    ports: ["127.0.0.1:2112:2112"]\n');
    expect(await expectOnly("C10", { ...dev, compose: newtPort }, "dev")).toBe(
      "FAIL C10 newt publishes a port under dev",
    );
    expect(failed((await check({})).lines)).toEqual([]);
  });

  test("c31_newt_env_holds_exactly_its_three_names", async () => {
    // P1.37v: newt.env holds PANGOLIN_ENDPOINT, NEWT_ID and NEWT_SECRET and nothing else, in one file, none of them
    // shadowed by compose; under dev the stack must run Newt, under prod and local it may not.
    const dev = { compose: DEV, pdsEnv: DEV_ENV };
    const names = (list: string[]) => `${list.map((k) => `${k}=x`).join("\n")}\n`;
    const only = (newtEnvFile: string) => expectOnly("C31", { ...dev, newtEnvFile }, "dev");
    expect(await only(names([...NEWT_ENV_NAMES, "LOG_LEVEL"]))).toBe(
      "FAIL C31 LOG_LEVEL is in the newt env file, which holds only its three names",
    );
    expect(await only(names([...NEWT_ENV_NAMES, "NEWT_ADMIN_ADDR"]))).toBe(
      "FAIL C31 a name is in the newt env file, which holds only its three names",
    );
    expect(await only(names([...NEWT_ENV_NAMES, `${CANARY.replaceAll("-", "_")}`]))).toBe(
      "FAIL C31 a name is in the newt env file, which holds only its three names",
    );
    expect(await only(names([...NEWT_ENV_NAMES, "NEWT_SECRET"]))).toBe(
      "FAIL C31 NEWT_SECRET is repeated in the newt env file",
    );
    for (const name of NEWT_ENV_NAMES) {
      expect(await only(names(NEWT_ENV_NAMES.filter((k) => k !== name))), name).toBe(
        `FAIL C31 ${name} is missing from the newt env file`,
      );
      const compose = DEV.replace("      LOG_LEVEL: WARN\n", `$&      ${name}: shadow\n`);
      expect(await expectOnly("C31", { ...dev, compose }, "dev"), name).toBe(
        `FAIL C31 ${name} is set in the newt service's environment, not newt.env`,
      );
    }
    const twoFiles = DEV.replace(
      "    env_file: ../../unset-dev-env/newt.env\n",
      "    env_file: [../../unset-dev-env/newt.env, ../../unset-dev-env/pds.env]\n",
    );
    expect(failed((await check({ ...dev, compose: twoFiles }, "dev")).lines)).toContain("C31");
    expect((await check({ ...dev, compose: twoFiles }, "dev")).lines).toContain(
      "FAIL C31 the newt service reads 2 env files, not exactly one",
    );
    // No Newt: dev fails, prod passes.
    const withoutNewt = {
      ...dev,
      compose: DEV.replace(NEWT_SERVICE, "").replace("  tunnel: {}\n", ""),
      networks: TABLE,
    };
    expect(await expectOnly("C31", withoutNewt, "dev")).toBe(
      "FAIL C31 no newt service; under dev it is the edge's only way in",
    );
    expect((await check({})).lines).toContain("PASS C31 ok");
  });

  test("c31_newt_runs_the_locked_image_with_its_features_off", async () => {
    // P1.37 follow-up: the dev Newt runs exactly the lock's newt image, with SSH, client access, metrics and pprof off
    // as compose literals and no other setting, no mount and no secret.
    const dev = { compose: DEV, pdsEnv: DEV_ENV };
    const only = (compose: string) => expectOnly("C31", { ...dev, compose }, "dev");
    expect(await only(DEV.replace(`    image: ${NEWT}\n    env_file`, `    image: ${WEB}\n    env_file`))).toBe(
      "FAIL C31 the newt service does not run the lock's newt image",
    );
    for (const [name, value] of [
      ["DISABLE_SSH", '"true"'],
      ["DISABLE_CLIENTS", '"true"'],
      ["NEWT_METRICS_PROMETHEUS_ENABLED", '"false"'],
      ["NEWT_PPROF_ENABLED", '"false"'],
    ]) {
      const line = `      ${name}: ${value}\n`;
      expect(await only(DEV.replace(line, "")), name).toBe(`FAIL C31 ${name} is not set in the newt service`);
      expect(await only(DEV.replace(line, `      ${name}: "1"\n`)), name).toBe(
        `FAIL C31 ${name} is not its reviewed literal in the newt service`,
      );
      expect(await only(DEV.replace(line, `      ${name}: \${FLAG}\n`)), name).toBe(
        `FAIL C31 ${name} is not its reviewed literal in the newt service`,
      );
    }
    expect(await only(DEV.replace("      LOG_LEVEL: WARN\n", "$&      NEWT_ADMIN_ADDR: 0.0.0.0:2022\n"))).toBe(
      "FAIL C31 a name is not a newt setting the preflight allows",
    );
    // In Compose's list form a repeated name's last value wins, so a second spelling of a setting is refused.
    const listed = DEV.replace(
      / {4}environment:\n {6}CONFIG_FILE[\s\S]*? {6}LOG_LEVEL: WARN\n/,
      "    environment:\n" +
        ["CONFIG_FILE=/tmp/newt.json", "DISABLE_SSH=true", "DISABLE_CLIENTS=true"]
          .concat(["NEWT_METRICS_PROMETHEUS_ENABLED=false", "NEWT_PPROF_ENABLED=false", "LOG_LEVEL=WARN"])
          .map((entry) => `      - ${entry}\n`)
          .join(""),
    );
    expect((await check({ ...dev, compose: listed }, "dev")).lines).toContain("PASS C31 ok");
    expect(await only(listed.replace("      - LOG_LEVEL=WARN\n", "$&      - DISABLE_SSH=false\n"))).toBe(
      "FAIL C31 DISABLE_SSH is set twice in the newt service",
    );
    // A name every object inherits is not an allowed setting either.
    expect(await only(DEV.replace("      LOG_LEVEL: WARN\n", "$&      constructor: x\n"))).toBe(
      "FAIL C31 a name is not a newt setting the preflight allows",
    );
    // A socket bind and a second reader of a secret also fail C9; C31 names the Newt rule itself.
    const lines = async (compose: string) => (await check({ ...dev, compose }, "dev")).lines;
    const socket = "$&    volumes: [/var/run/docker.sock:/var/run/docker.sock:ro]\n";
    expect(await lines(DEV.replace("    networks: [tunnel]\n", socket))).toContain(
      "FAIL C31 the newt service mounts a file or volume",
    );
    expect(await lines(DEV.replace("    networks: [tunnel]\n", "$&    secrets: [db_password]\n"))).toContain(
      "FAIL C31 the newt service reads a secret",
    );
  });

  test("c18_dev_hosts_are_the_staging_names", async () => {
    // P1.37 follow-up: under dev the PDS is the ruled staging.unset.ac (the dev leaf's SAN and Pangolin's resource),
    // and web's PUBLIC_ORIGIN names the dev app host the edge serves.
    const dev = { pdsEnv: DEV_ENV };
    const c18 = (compose: string) => expectOnly("C18", { ...dev, compose }, "dev");
    expect(await c18(DEV.replaceAll("staging.unset.ac", "pds.other.test"))).toBe(
      "FAIL C18 PDS_HOST is not the staging PDS name",
    );
    expect(
      await c18(DEV.replace("PUBLIC_ORIGIN: https://staging.unset.sh", "PUBLIC_ORIGIN: https://other.unset.sh")),
    ).toBe("FAIL C18 web's PUBLIC_ORIGIN is not the dev app origin");
    // The exact names, no port: the dev sites listen on PDS_HOST and Pangolin reaches them on 443.
    expect(await c18(DEV.replaceAll("staging.unset.ac", "staging.unset.ac:2583"))).toBe(
      "FAIL C18 PDS_HOST is not a hostname",
    );
    expect(
      await c18(DEV.replace("PUBLIC_ORIGIN: https://staging.unset.sh", "PUBLIC_ORIGIN: https://staging.unset.sh:8443")),
    ).toBe("FAIL C18 web's PUBLIC_ORIGIN is not the dev app origin");
    // The origin exactly, as web's config parser takes it: no path, userinfo or other spelling.
    for (const origin of [
      "https://staging.unset.sh/path",
      "https://user@staging.unset.sh",
      "https://STAGING.unset.sh",
      "https://:pw@staging.unset.sh",
      "https://staging.unset.sh?x=1",
      "https://staging.unset.sh#x",
      "https://staging.unset.sh:443",
      "https://ſtaging.unset.sh",
    ]) {
      expect(
        await c18(DEV.replace("PUBLIC_ORIGIN: https://staging.unset.sh", `PUBLIC_ORIGIN: ${origin}`)),
        origin,
      ).toBe("FAIL C18 web's PUBLIC_ORIGIN is not the dev app origin");
    }
    expect(await c18(DEV.replace("      PUBLIC_ORIGIN: https://staging.unset.sh\n", ""))).toBe(
      "FAIL C18 web's PUBLIC_ORIGIN is missing",
    );
    expect((await check({ ...dev, compose: DEV }, "dev")).lines).toContain("PASS C18 ok");
  });

  test("c31_newt_env_values_are_real_and_the_endpoint_is_https", async () => {
    // P1.37 follow-up: newt.env's values are not the example's replace-me, and Pangolin's endpoint is an https address
    // with no credentials in it. No value is ever printed.
    const dev = { compose: DEV, pdsEnv: DEV_ENV };
    const only = (newtEnvFile: string) => expectOnly("C31", { ...dev, newtEnvFile }, "dev");
    const env = (endpoint: string, id = CANARY, secret = CANARY) =>
      `PANGOLIN_ENDPOINT=${endpoint}\nNEWT_ID=${id}\nNEWT_SECRET=${secret}\n`;
    const good = `https://${CANARY}.example.test`;
    expect(await only(env("replace-me"))).toBe("FAIL C31 PANGOLIN_ENDPOINT is still the example file's placeholder");
    expect(await only(env(good, "replace-me"))).toBe("FAIL C31 NEWT_ID is still the example file's placeholder");
    expect(await only(env(good, CANARY, "replace-me"))).toBe(
      "FAIL C31 NEWT_SECRET is still the example file's placeholder",
    );
    for (const endpoint of [
      `http://${CANARY}.example.test`,
      `https://user:${CANARY}@pangolin.example.test`,
      `https://${CANARY}@pangolin.example.test`,
      CANARY,
      // Newt appends its API path to the endpoint, so only a bare base address works.
      `https://${CANARY}.example.test/?x`,
      `https://${CANARY}.example.test/base`,
      // An empty fragment delimiter normalises away (url.hash is ""), but Newt's API path would land after it. The
      // strict env form allows `#` only inside single quotes.
      `'https://${CANARY}.example.test#'`,
      `'https://${CANARY}.example.test/#x'`,
    ]) {
      const outcome = await only(env(endpoint));
      expect(outcome, endpoint).toBe("FAIL C31 PANGOLIN_ENDPOINT is not a bare https address without credentials");
    }
    // Newt applies a setting only when it is non-empty (newtconfig.go:191-196), so an empty one is never set.
    expect(await only(env(""))).toBe("FAIL C31 PANGOLIN_ENDPOINT is empty");
    expect(await only(env(good, ""))).toBe("FAIL C31 NEWT_ID is empty");
    expect(await only(env(good, CANARY, ""))).toBe("FAIL C31 NEWT_SECRET is empty");
    // Blank is no better (the env file admits it only quoted): Newt would set it, and it names no usable site.
    expect(await only(env(good, "'   '"))).toBe("FAIL C31 NEWT_ID is empty");
    expect(await only(env(good, CANARY, "'\t'"))).toBe("FAIL C31 NEWT_SECRET is empty");
    expect(await check({ ...dev, newtEnvFile: env(`${good}/`) }, "dev").then((r) => r.lines)).toContain("PASS C31 ok");
  });

  test("c11_smtp_fails", async () => {
    await expectWithC30("C11", { pdsEnv: { PDS_EMAIL_SMTP_URL: null } });
    await expectOnly("C11", { pdsEnv: { PDS_EMAIL_SMTP_URL: "smtp://mail.example.test:587" } });
    await expectOnly("C11", { pdsEnv: { PDS_EMAIL_SMTP_URL: "smtp://mailpit:1025" } });
    await expectOnly("C11", { pdsEnv: { PDS_EMAIL_FROM_ADDRESS: null } });
    await expectOnly("C11", {
      pdsEnv: { PDS_EMAIL_SMTP_URL: "smtps://mail.example.test?tls.rejectUnauthorized=false" },
    });
    const tls = await check({ pdsEnv: { PDS_EMAIL_SMTP_URL: "smtp://mail.example.test:587?requireTLS=true" } });
    expect(failed(tls.lines)).toEqual([]);
    // P1.36g: no dev service runs Mailpit, so dev refuses it too; a local stack sends no mail at all.
    const mailpit = await check(
      { compose: DEV, pdsEnv: { ...DEV_ENV, PDS_EMAIL_SMTP_URL: "smtp://mailpit:1025" } },
      "dev",
    );
    expect(mailpit.lines).toContain("FAIL C11 PDS_EMAIL_SMTP_URL is Mailpit");
    expect(failed(mailpit.lines)).toEqual(["C11"]);
    // An smtp: URL keeps its host's case, and a trailing dot names the same host.
    for (const url of ["smtps://MAILPIT:465", "smtps://mailpit.:465", "smtps://MailPit.:465"]) {
      expect(await expectOnly("C11", { pdsEnv: { PDS_EMAIL_SMTP_URL: url } }), url).toBe(
        "FAIL C11 PDS_EMAIL_SMTP_URL is Mailpit",
      );
    }
  });

  test("c30_pds_env_holds_exactly_its_set", async () => {
    // P1.36q reds 1, 2, 4, 6 and 7 (dev and prod hold six names); reds 3 and 5 are under --env local below.
    const set = (name: string, env = "prod") =>
      `FAIL C30 ${name} is in the pds env file, which under ${env} holds only its set`;
    expect(await expectOnly("C30", { pdsEnvFile: "PDS_CRAWLERS=\n" })).toBe(set("PDS_CRAWLERS"));
    expect(await expectOnly("C30", { pdsEnvFile: "PDS_EMAIL_FROM_ADDRESS=noreply@example.test\n" })).toBe(
      set("PDS_EMAIL_FROM_ADDRESS"),
    );
    // A key that is not one of ours might be a pasted value, so it is not printed.
    expect(await expectOnly("C30", { pdsEnvFile: `${CANARY.replaceAll("-", "_")}=x\n` })).toBe(set("a name"));
    for (const key of ["pds_x", "PDS_Xab"]) {
      expect(await expectOnly("C30", { pdsEnvFile: `${key}=\n` }), key).toBe(set("a name"));
    }
    expect(await expectOnly("C30", { pdsEnvFile: "PDS_JWT_SECRET=again\n" })).toBe(
      "FAIL C30 PDS_JWT_SECRET is repeated in the pds env file",
    );
    // Codex on #1129: compose's environment wins over env_file, so none of the set may be written there.
    for (const name of [...PDS_ENV_FILE_NAMES]) {
      const compose = COMPOSE.replace("      PDS_HOSTNAME:", `      ${name}: shadow\n      PDS_HOSTNAME:`);
      const line = (await check({ compose })).lines.find((l) => l.startsWith("FAIL C30"));
      expect(line, name).toBe(`FAIL C30 ${name} is set in the pds service's environment, not pds.env`);
    }
    // Codex on #1129: the set lives in one env file, so it cannot be split across a second one or beside one holding nothing.
    const urls = ["PDS_EMAIL_SMTP_URL", "PDS_MODERATION_EMAIL_SMTP_URL"].map((k) => `${k}=${PDS_ENV[k]}\n`).join("");
    for (const mail of ["# nothing here\n", urls]) {
      const pdsEnv = mail.startsWith("#") ? {} : { PDS_EMAIL_SMTP_URL: null, PDS_MODERATION_EMAIL_SMTP_URL: null };
      const compose = COMPOSE.replace(
        "    env_file: ../../unset-dev-env/pds.env\n",
        "    env_file: [../../unset-dev-env/pds.env, ../../unset-dev-env/mail.env]\n",
      );
      const { root, file } = stack({ compose, pdsEnv });
      writeFileSync(join(envOf(root), "mail.env"), mail);
      chmodSync(join(envOf(root), "mail.env"), 0o600);
      const result = await preflight(["--env", "prod", "--compose", file], {
        root,
        run: fakeRun().run,
        ...fakeFs(root),
      });
      expect(
        result.lines.filter((l) => l.startsWith("FAIL")),
        JSON.stringify(mail),
      ).toEqual(["FAIL C30 the pds service reads 2 env files; its set lives in pds.env alone"]);
    }
    const dev = (unset: Record<string, null>) => ({ compose: DEV, pdsEnv: { ...DEV_ENV, ...unset } });
    expect(await expectWithC30("C11", dev({ PDS_EMAIL_SMTP_URL: null }), "dev")).toBe(
      "FAIL C11 PDS_EMAIL_SMTP_URL missing",
    );
    const four = await check(dev({ PDS_EMAIL_SMTP_URL: null, PDS_MODERATION_EMAIL_SMTP_URL: null }), "dev");
    expect(failed(four.lines)).toEqual(["C11", "C19", "C30"]);
    expect(four.lines).toContain("FAIL C30 PDS_EMAIL_SMTP_URL is missing from the pds env file");
    expect(failed((await check(dev({ PDS_MODERATION_EMAIL_SMTP_URL: null }), "dev")).lines)).toEqual(["C19", "C30"]);
  });

  test("c11_c19_from_address_is_an_addr_spec", async () => {
    // P1.36g (architecture 20:01Z): each SMTP URL needs its from address, an RFC 5322 dot-atom addr-spec.
    for (const [id, key] of [
      ["C11", "PDS_EMAIL_FROM_ADDRESS"],
      ["C19", "PDS_MODERATION_EMAIL_ADDRESS"],
    ] as const) {
      expect(await expectOnly(id, { pdsEnv: { [key]: null } }), key).toBe(`FAIL ${id} ${key} missing`);
      for (const bad of [
        "",
        "noreply",
        "@example.test",
        "a@",
        "a b@example.test",
        "a@example",
        `a@${"b".repeat(64)}.test`,
        `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(60)}.test`,
        "a@@example.test",
        "Name <a@example.test>",
        "a@example.test,b@example.test",
        "a@-example.test",
        "a..b@example.test",
        ".a@example.test",
        "a@example.test\r\nBcc: x@example.test",
        "<a@example.test>",
        "a,b@example.test",
        "a@example-.test",
        "a@b_c.test",
        `${"a".repeat(65)}@example.test`,
        addressOfLength(255),
      ]) {
        expect(await expectOnly(id, { pdsEnv: { [key]: bad } }), `${key}=${bad}`).toBe(
          bad === "" ? `FAIL ${id} ${key} missing` : `FAIL ${id} ${key} is not an email address`,
        );
      }
      for (const good of [
        "noreply@staging.unset.sh",
        "a.b+c@mail.example.test",
        `a@${"b".repeat(63)}.test`,
        `${"a".repeat(64)}@example.test`,
        addressOfLength(254),
      ]) {
        expect(failed((await check({ pdsEnv: { [key]: good } })).lines), good).toEqual([]);
      }
    }
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
    // PDS_HOSTNAME carries the sentinel too, so C18 passes its PDS host tie (P1.35l) and reaches the reader.
    const sentinel = "sentinelhost.example.test";
    const compose = COMPOSE.replace("      PDS_HOST: pds.example.test", `      PDS_HOST: ${sentinel}`).replace(
      "      PDS_HOSTNAME: pds.example.test",
      `      PDS_HOSTNAME: ${sentinel}`,
    );
    const result = await check({ compose, sites: { "probe.caddy": '"{$PDS_HOST}" {\n\trespond 204\n}\n' } });
    expect(result.lines.find((line) => / C18 /.test(line))).toMatch(/^FAIL C18 the edge config is unreadable/);
    expect(result.lines.join("\n")).not.toContain(sentinel);
  });

  test("c18_prod_refuses_the_dev_mount", async () => {
    // P1.36c: the dev sites and the dev (tls) are the dev stack's alone; prod mounting either fails C18.
    const sites = "      - ./edge/sites/enabled:/etc/caddy/sites/enabled:ro\n";
    const c18 = async (edit: (text: string) => string) =>
      (await check({ compose: edit(COMPOSE) }, "prod")).lines.find((line) => / C18 /.test(line));
    expect(await c18((text) => text)).toBe("PASS C18 ok");
    expect(await c18((text) => text.replace(sites, "      - ./edge/dev:/etc/caddy/sites/enabled:ro\n"))).toBe(
      "FAIL C18 the edge config is unreadable: the enabled sites directory is not inside sites/",
    );
    expect(
      await c18((text) =>
        text.replace(sites, `${sites}      - ./edge/dev/app.caddy:/etc/caddy/sites/enabled/app.caddy:ro\n`),
      ),
    ).toBe("FAIL C18 the edge mounts over /etc/caddy/sites/enabled/app.caddy");
    expect(
      await c18((text) =>
        text.replace(sites, `${sites}      - ./edge/dev/tls.caddy:/etc/caddy/snippets/tls.caddy:ro\n`),
      ),
    ).toBe("FAIL C18 the edge mounts over /etc/caddy/snippets/tls.caddy");
  });

  test("c18_dev_serves_the_self_signed_leaf_files", async () => {
    // P1.38e (ADR 0032 Decision 3): under dev C18 takes exactly the dev shape: the dev sites, the dev (tls) mounted from
    // deployment/edge/dev/tls.caddy and reading `tls <cert> <key>`, the leaf's two secrets and no published port.
    const c18 = async (edit: (text: string) => string, files: Record<string, string> = {}, env = "dev") =>
      (await check({ compose: edit(env === "dev" ? DEV : COMPOSE), pdsEnv: DEV_ENV, files }, env)).lines.find((line) =>
        / C18 /.test(line),
      );
    const same = (text: string) => text;
    expect(await c18(same)).toBe("PASS C18 ok");
    const tlsMount = "      - ./edge/dev/tls.caddy:/etc/caddy/snippets/tls.caddy:ro\n";
    const leaf = "    secrets: [dev_tls_cert, dev_tls_key]\n";
    const cases: [string, (text: string) => string][] = [
      [
        "FAIL C18 the edge publishes a port under dev",
        (t) => t.replace(leaf, `${leaf}    ports: ["127.0.0.1:443:443"]\n`),
      ],
      [
        "FAIL C18 the edge reads a secret other than the dev leaf's",
        (t) => t.replace(leaf, "    secrets: [dev_tls_cert, dev_tls_key, db_password]\n"),
      ],
      ["FAIL C18 the edge does not read the dev leaf", (t) => t.replace(leaf, "    secrets: [dev_tls_cert]\n")],
      // The leaf's files stay with the edge: by its name, under another name or bound from disk (P1.37 follow-up).
      ...[
        (t: string) => t.replace("    secrets: [db_password]\n", "    secrets: [db_password, dev_tls_key]\n"),
        (t: string) =>
          t
            .replace("    secrets: [db_password]\n", "    secrets: [db_password, leaf_key]\n")
            .replace(
              "secrets:\n  db_password:",
              "secrets:\n  leaf_key:\n    file: ../../unset-dev-secrets/dev_tls_key\n  db_password:",
            ),
        (t: string) =>
          t.replace(
            "    secrets: [db_password]\n",
            "$&    volumes:\n      - ../../unset-dev-secrets/dev_tls_cert:/c:ro\n",
          ),
        (t: string) =>
          t.replace("    secrets: [db_password]\n", "$&    volumes:\n      - ../../unset-dev-secrets:/s:ro\n"),
      ].map((edit): [string, (text: string) => string] => [
        "FAIL C18 a service other than the edge reads the dev leaf",
        edit,
      ]),
      ["FAIL C18 the TLS snippet is not mounted", (t) => t.replace(tlsMount, "")],
      ["FAIL C18 the TLS snippet is not mounted read-only", (t) => t.replace(tlsMount, tlsMount.replace(":ro", ""))],
      [
        "FAIL C18 the TLS snippet is not deployment/edge/dev/tls.caddy",
        (t) => t.replace(tlsMount, tlsMount.replace("./edge/dev/", "./edge/local/")),
      ],
      [
        "FAIL C18 the TLS snippet is not deployment/edge/dev/tls.caddy",
        (t) => t.replace(tlsMount, tlsMount.replace("./edge/dev/tls.caddy", "./edge/snippets/tls.caddy")),
      ],
    ];
    // ADR 0032 Decision 3: exactly the three file binds, each read-only from dev/ by its own name; no directory.
    const appMount = "      - ./edge/dev/app.caddy:/etc/caddy/sites/enabled/app.caddy:ro\n";
    const pdsMount = "      - ./edge/dev/pds.caddy:/etc/caddy/sites/enabled/pds.caddy:ro\n";
    const unreadable = "FAIL C18 the edge config is unreadable: ";
    cases.push(
      // P1.38g: no directory at the enabled sites under dev, alone or beside the binds.
      [
        "FAIL C18 the dev edge mounts a directory at /etc/caddy/sites/enabled",
        (t) => t.replace(pdsMount, `${pdsMount}      - ./edge/sites:/etc/caddy/sites/enabled:ro\n`),
      ],
      [
        "FAIL C18 the dev edge mounts a directory at /etc/caddy/sites/enabled",
        (t) => t.replace(appMount, "").replace(pdsMount, "      - ./edge/dev:/etc/caddy/sites/enabled/:ro\n"),
      ],
      [`${unreadable}pds.caddy: not mounted`, (t) => t.replace(pdsMount, "")],
      [`${unreadable}app.caddy: not mounted`, (t) => t.replace(appMount, "")],
      ["FAIL C18 the site pds.caddy is not mounted read-only", (t) => t.replace(pdsMount, pdsMount.replace(":ro", ""))],
      [
        `${unreadable}pds.caddy: not mounted from dev/pds.caddy`,
        (t) => t.replace(pdsMount, pdsMount.replace("./edge/dev/pds.caddy", "./edge/sites/pds.caddy")),
      ],
      [
        `${unreadable}x.caddy: not a site the dev stack mounts`,
        (t) => t.replace(pdsMount, `${pdsMount}${pdsMount.replace("enabled/pds.caddy", "enabled/x.caddy")}`),
      ],
      [
        "FAIL C18 the edge binds more than the dev sites and the dev (tls)",
        (t) => t.replace(pdsMount, `${pdsMount}      - ./edge/dev/pds.caddy:/srv/pds.caddy:ro\n`),
      ],
    );
    for (const [line, edit] of cases) expect(await c18(edit), line).toBe(line);
    // Main's old shape, the shipped sites folder alone, which P1.38e allowed until P1.36c moved compose to the three
    // binds: refused under dev since P1.38g, from any folder.
    const folder = (t: string) =>
      t
        .replace(appMount, "")
        .replace(tlsMount, "")
        .replace(pdsMount, "      - ./edge/sites:/etc/caddy/sites/enabled:ro\n");
    const onMain = async (edit: (t: string) => string) =>
      (await check({ compose: edit(DEV), pdsEnv: DEV_ENV, shippedSitesOnly: true }, "dev")).lines.find((line) =>
        / C18 /.test(line),
      );
    expect(await onMain(folder)).toBe("FAIL C18 the dev edge mounts a directory at /etc/caddy/sites/enabled");
    expect(await onMain((t) => folder(t).replace("./edge/sites:", "./edge/dev:"))).toBe(
      "FAIL C18 the dev edge mounts a directory at /etc/caddy/sites/enabled",
    );
    // Shape (b): a directory, or a file from outside deployment/edge/dev/, at a site's own path fails by its name.
    const app = (source: string) => (t: string) =>
      t.replace(appMount, appMount.replace("./edge/dev/app.caddy", source));
    expect(await c18(app("./edge/dev"))).toBe(`${unreadable}app.caddy: the mount is not one regular file`);
    expect(await c18(app("/etc/hostname"))).toBe(`${unreadable}app.caddy: not mounted from dev/app.caddy`);
    expect(await c18(app("./edge/dev/../sites/pds.caddy"))).toBe(
      `${unreadable}app.caddy: not mounted from dev/app.caddy`,
    );
    // The dev (tls) itself: anything but the leaf's two files fails, an issuer and Caddy's internal CA included.
    for (const other of [
      "(tls) {\n\ttls internal\n}\n",
      "(tls) {\n\ttls {\n\t\tissuer acme {\n\t\t\tdir https://acme-v02.api.letsencrypt.org/directory\n\t\t}\n\t}\n}\n",
      "(tls) {\n\ttls /run/secrets/dev_tls_key /run/secrets/dev_tls_cert\n}\n",
    ]) {
      expect(await c18(same, { "deployment/edge/dev/tls.caddy": other }), other).toBe(
        "FAIL C18 the dev (tls) is not the self-signed leaf's files",
      );
    }
    // No :80 site under dev.
    const plain = readFileSync(join(EDGE_DIR, "dev/pds.caddy"), "utf8").replace(
      "{$PDS_HOST} {",
      "http://{$PDS_HOST} {",
    );
    expect(await c18(same, { "deployment/edge/dev/pds.caddy": plain })).toMatch(
      /^FAIL C18 \{\$PDS_HOST\}: a plain-http dev site/,
    );
    // Both dev sites stay bound to the newt_edge address alone, the listener P1.36j's trusted proxy names.
    for (const name of ["app", "pds"]) {
      const site = readFileSync(join(EDGE_DIR, `dev/${name}.caddy`), "utf8");
      expect(site).toContain("\tbind 10.250.37.3\n");
      expect(
        await c18(same, { [`deployment/edge/dev/${name}.caddy`]: site.replace("\tbind 10.250.37.3\n", "") }),
      ).toMatch(/^FAIL C18 \{\$(APP|PDS)_HOST\}: not bound to the edge's newt_edge address alone/);
    }
    // The app site takes only its ruled name under dev.
    expect(await c18((t) => t.replace("APP_HOST: staging.unset.sh", "APP_HOST: other.unset.sh"))).toMatch(
      /^FAIL C18 the edge config is unreadable: \{\$APP_HOST\} is not the dev app site's ruled value/,
    );
    // Prod is unchanged: the shipped sites with Let's Encrypt, and a file certificate fails.
    expect(await c18(same, {}, "prod")).toBe("PASS C18 ok");
    const file = "{$PDS_HOST} {\n\ttls /run/secrets/x_cert /run/secrets/x_key\n";
    const shipped = readFileSync(join(EDGE_DIR, "sites/pds.caddy"), "utf8").replace("{$PDS_HOST} {\n", file);
    expect(await c18(same, { "deployment/edge/sites/pds.caddy": shipped }, "prod")).toMatch(
      /\{\$PDS_HOST\}: a file certificate outside dev and local/,
    );
  });

  test("c18_pds_host_is_the_pds_hostname_in_every_env", async () => {
    // P1.35l (architecture 02:01Z): dev and prod tie the edge's PDS_HOST to the PDS's own PDS_HOSTNAME as local does
    // (P1.35g), so the edge never terminates TLS for one name while the PDS issues its OAuth issuer, DID document
    // endpoint and handles under another. C21 reads only the retirement report (host.ts:18-40). Reasons name the
    // variables and never echo a value.
    const pdsHost = "      PDS_HOST: pds.example.test\n";
    const hostname = "      PDS_HOSTNAME: pds.example.test\n";
    const host = (value: string) => (text: string) => text.replace(pdsHost, `      PDS_HOST: ${value}\n`);
    const named = (value: string) => (text: string) => text.replace(hostname, `      PDS_HOSTNAME: ${value}\n`);
    const mismatch = "FAIL C18 PDS_HOST is not the pds service's PDS_HOSTNAME";
    const notHost = "FAIL C18 PDS_HOST is not a hostname";
    const ipName = "FAIL C18 PDS_HOSTNAME is an IP address";
    const noHost = "FAIL C18 input missing: the edge's PDS_HOST";
    const noName = "FAIL C18 input missing: the pds service's PDS_HOSTNAME";
    const cases: [string, (text: string) => string][] = [
      [mismatch, named("other.example.test")],
      [mismatch, named("x.pds.example.test")],
      [notHost, (text) => host("192.0.2.2")(named("192.0.2.2")(text))],
      [notHost, host('"2001:db8::2"')],
      [ipName, named("192.0.2.2")],
      [ipName, named('"192.0.2.2.:443"')],
      [ipName, named('"3221225986"')],
      [ipName, named('"2001:db8::2"')],
      [ipName, named('"[2001:db8::2]:443"')],
      [noHost, (text) => text.replace(pdsHost, "")],
      [noHost, host('""')],
      [noName, (text) => text.replace(`    environment:\n${hostname}`, "")],
      [noName, named('""')],
      // verify-888 N4: each differs from PDS_HOST only in what normalHost must not strip.
      [mismatch, named('"pds.example.test:abc"')],
      [mismatch, named("pds.example.test..")],
      [mismatch, named('" pds.example.test"')],
    ];
    // Dev's PDS is the ruled staging name (P1.37 follow-up), so there the cases run on it in place of pds.example.test.
    const staging = (text: string) => text.replace(/pds\.example\.test/gi, "staging.unset.ac");
    for (const [env, compose, pdsEnv, names] of [
      ["prod", COMPOSE, {}, (text: string) => text],
      ["dev", DEV.replaceAll("staging.unset.ac", "pds.example.test"), DEV_ENV, staging],
    ] as const) {
      const c18 = async (edit: (text: string) => string) =>
        (await check({ compose: names(edit(compose)), pdsEnv }, env)).lines.find((line) => / C18 /.test(line));
      expect(await c18((text) => text), env).toBe("PASS C18 ok");
      for (const value of [
        "PDS.Example.Test",
        "pds.example.test.",
        "pds.example.test:2583",
        '"PDS.Example.Test.:443"',
      ]) {
        expect(await c18(named(value)), `${env} ${value}`).toBe("PASS C18 ok");
      }
      for (const [line, edit] of cases) expect(await c18(edit), `${env} ${line}`).toBe(line);
    }
    // The two pinned prod fixtures, whole: an address standing in for the host, and another name than the PDS's own.
    const prod = async (edit: (text: string) => string) => (await check({ compose: edit(COMPOSE) })).lines;
    expect(await prod((text) => host("192.0.2.2")(named("192.0.2.2")(text)))).toContain(notHost);
    expect(await prod(host("other.example.test"))).toContain(mismatch);
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
    // The project's .env is looked for through that link, so the env reader's walk stops the run first (P1.34r).
    expect(viaLink).toEqual({
      code: 2,
      lines: [`ERROR ${join(linked, ".env")} lies on a path that another user can change`],
    });
    // With an interpolation env file named outright, no .env is read, and C9 judges the bind source as written.
    const flag = join(envOf(root), "flag.env");
    writeFileSync(flag, "");
    const viaLinkWithFlag = await preflight(
      ["--env", "prod", "--compose", join(linked, "compose.yaml"), "--interpolation-env", flag],
      { root, run: fakeRun().run, ...fakeFs(root, WEB_UID, { [linked]: 2000 }) },
    );
    expect(viaLinkWithFlag.lines).toContain("FAIL C9 edge binds a path that another user can change");
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
    const loose = await check({ pdsEnv: { PDS_JWT_SECRET: '"quoted"' } });
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
  /** The PDS named `name`, which the edge serves as its normal form, since C18 ties the two (P1.35l). */
  const host = (name: string) =>
    withEnv(`      PDS_HOSTNAME: ${name}`).replace(
      "      PDS_HOST: pds.example.test",
      `      PDS_HOST: ${name.toLowerCase().replace(/\.$/, "")}`,
    );

  test("c13_lexicon_authority_did_fails", async () => {
    await expectOnly("C13", { pdsEnv: { PDS_LEXICON_AUTHORITY_DID: "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa" } });
    await expectOnly("C13", { pdsEnv: { PDS_LEXICON_AUTHORITY_DID: "" } });
  });

  test("c14_dev_mode_fails", async () => {
    await expectOnly("C14", { pdsEnv: { PDS_DEV_MODE: "true" } });
    await expectOnly("C14", { pdsEnv: { PDS_DEV_MODE: "1" } });
  });

  test("c14_safety_off_keys_fail", async () => {
    // P1.34k: the same list as the compose test. Each denied key fails C14, and the reason names the key only.
    for (const [name, value] of [
      ["PDS_DISABLE_SSRF_PROTECTION", "true"],
      ["PDS_DISABLE_SSRF_PROTECTION", "false"],
      ["PDS_DEV_MODE", "false"],
      ["DEV_MODE", "1"],
      ["PDS_X_DISABLE_Y", "true"],
      ["PDS_EMAIL_DISABLE_CONFIRMATION_LINKS", "true"],
    ] as const) {
      const line = await expectOnly("C14", { pdsEnv: { [name]: value } });
      const reason = line?.slice("FAIL C14 ".length) ?? "";
      expect(reason, `${name}=${value}`).toContain(name);
      expect(reason, `${name}=${value}`).not.toContain(value);
    }
  });

  test("c14_confirmation_link_exemption_is_exact", async () => {
    // The one exemption is the exact pair. false, TRUE and 1 are denied; C16 still requires the exact value too.
    for (const value of ["false", "TRUE", "1"]) {
      const result = await check({ pdsEnv: { PDS_EMAIL_DISABLE_CONFIRMATION_LINK: value } });
      expect(failed(result.lines), value).toEqual(["C14", "C16"]);
      const reason = result.lines.find((entry) => entry.startsWith("FAIL C14 "))?.slice("FAIL C14 ".length);
      expect(reason, value).toContain("PDS_EMAIL_DISABLE_CONFIRMATION_LINK");
      expect(reason, value).not.toContain(value);
    }
    expect(failed((await check()).lines)).toEqual([]);
  });

  test("c15_handle_domain_0x40_me_fails", async () => {
    await expectOnly("C15", { pdsEnv: { PDS_SERVICE_HANDLE_DOMAINS: ".pds.example.test,.0x40.me" } });
    await expectOnly("C15", { pdsEnv: { PDS_SERVICE_HANDLE_DOMAINS: null } });
    await expectOnly("C15", { compose: DEV, pdsEnv: { PDS_SERVICE_HANDLE_DOMAINS: ".pds.example.test" } }, "dev");
    expect(failed((await check({ compose: DEV, pdsEnv: DEV_ENV }, "dev")).lines)).toEqual([]);
  });

  test("c15_dev_handle_domain_is_the_staging_one", async () => {
    // P1.35x (ADR 0025): the dev PDS mints only <user>.staging.unset.im, one exact entry, never .unset.im.
    const dev = async (domains: string) =>
      (await check({ compose: DEV, pdsEnv: { ...DEV_ENV, PDS_SERVICE_HANDLE_DOMAINS: domains } }, "dev")).lines.find(
        (l) => / C15 /.test(l),
      );
    expect(await dev(".staging.unset.im")).toBe("PASS C15 ok");
    for (const domains of [
      ".0x40.space",
      ".unset.im",
      ".x.staging.unset.im",
      ".staging.unset.im.evil",
      ".staging.unset.im,.unset.im",
      ".staging.unset.im,",
    ]) {
      expect(await dev(domains), domains).toBe("FAIL C15 PDS_SERVICE_HANDLE_DOMAINS is not the dev handle domain");
    }
    // Prod's rule is unchanged: the dev domain is not judged there.
    expect(failed((await check({ pdsEnv: { PDS_SERVICE_HANDLE_DOMAINS: ".0x40.space" } })).lines)).toEqual([]);
  });

  test("c16_confirmation_link_required", async () => {
    await expectOnly("C16", { pdsEnv: { PDS_EMAIL_DISABLE_CONFIRMATION_LINK: null } });
    // A wrong value is also a safety-off key, so C14 fails with C16 (P1.34k). Absence is C16 alone.
    const wrong = await check({ pdsEnv: { PDS_EMAIL_DISABLE_CONFIRMATION_LINK: "false" } });
    expect(failed(wrong.lines)).toEqual(["C14", "C16"]);
  });

  test("c19_moderation_mail_missing_fails", async () => {
    await expectWithC30("C19", { pdsEnv: { PDS_MODERATION_EMAIL_SMTP_URL: null } });
    await expectOnly("C19", { pdsEnv: { PDS_MODERATION_EMAIL_ADDRESS: null } });
    await expectOnly("C19", { pdsEnv: { PDS_MODERATION_EMAIL_SMTP_URL: "smtp://mailpit:1025" } });
    const dev = { ...DEV_ENV, PDS_MODERATION_EMAIL_SMTP_URL: "smtp://mailpit:1025" };
    expect(failed((await check({ compose: DEV, pdsEnv: dev }, "dev")).lines)).toEqual(["C19"]);
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

  test("c21_dev_is_waived_whatever_the_report", async () => {
    // Under --env dev C21 is waived for staging (Alex, 2026-10-21 02:41:25Z: a new PDS and a new handle domain, no
    // 0x40 account carries over): no report, a half report and any hostname all pass with the one fixed line, which
    // names the waiver and no value. Prod and local keep the 0x40.space rule below.
    const waived = `PASS C21 ${C21_DEV_WAIVER}`;
    expect(C21_DEV_WAIVER).toMatch(/^skipped: waived for staging/);
    expect(C21_DEV_WAIVER).not.toMatch(/[0-9]|dev/);
    expect((await check({ compose: DEV, pdsEnv: DEV_ENV, report: undefined }, "dev")).lines).toContain(waived);
    const half = '{"retirement_part_a_complete": false}';
    expect((await check({ compose: DEV, pdsEnv: DEV_ENV, report: half }, "dev")).lines).toContain(waived);
    for (const name of ["pds.localhost", "dev.example.test", "0x40.space"]) {
      const compose = host(name).replace("name: unset-prod", "name: unset-dev");
      const { lines } = await check({ compose, pdsEnv: DEV_ENV, report: undefined }, "dev");
      expect(failed(lines), name).not.toContain("C21");
      expect(lines, name).toContain(waived);
    }
    expect((await check()).lines).toContain("PASS C21 skipped: PDS_HOSTNAME is unset or a different host");
  });

  test("c21_waiver_line_is_never_withheld", async () => {
    // The runner withholds a whole reason holding any configured value (P1.30m), and the real dev compose configures
    // `dev` (UNSET_ENV), `5` (PG_POOL_MAX) and more (Codex review on #1174): the fixed line holds none of the real
    // file's literals, and a dev fixture carrying those two literals still prints it.
    const file = join(import.meta.dirname, "../compose.dev.yaml");
    const real = parseCompose(readFileSync(file, "utf8"), file);
    const literals = real.services.flatMap((s) =>
      s.environment.flatMap(([, v]) => ("literal" in v ? [v.literal] : [])),
    );
    expect(literals).toContain("dev");
    for (const literal of literals.filter((v) => v !== "")) expect(C21_DEV_WAIVER, literal).not.toContain(literal);
    const compose = DEV.replace(
      "      FINGERPRINT_CHECK: arachnid\n",
      '      FINGERPRINT_CHECK: arachnid\n      UNSET_ENV: dev\n      PG_POOL_MAX: "5"\n',
    );
    const { lines } = await check({ compose, pdsEnv: DEV_ENV, report: undefined }, "dev");
    expect(lines.filter((line) => line.includes(" C21 "))).toEqual([`PASS C21 ${C21_DEV_WAIVER}`]);
  });

  test("c21_prod_and_local_still_need_the_report_on_the_old_host", () => {
    // The waiver is dev's alone: on 0x40.space, prod and local read the report and fail without it or with part A
    // incomplete, exactly as before.
    const signal = new AbortController().signal;
    const inputs = (env: string, report: string | null) =>
      ({
        env,
        serviceEnv: new Map([["pds", new SecretMap([["PDS_HOSTNAME", "0x40.space"]])]]),
        retirementReportPath: "docs/human/retirement/retirement-check.json",
        readText: () => report,
      }) as unknown as Inputs;
    for (const env of ["prod", "local"]) {
      expect(c21.run(inputs(env, null), signal), env).toEqual(missing("docs/human/retirement/retirement-check.json"));
      expect(c21.run(inputs(env, '{"retirement_part_a_complete": false}'), signal), env).toEqual(
        fail("the retirement report does not mark part A complete"),
      );
      expect(c21.run(inputs(env, PART_A_DONE), signal), env).toEqual(pass());
    }
    expect(c21.run(inputs("dev", null), signal)).toEqual(pass(C21_DEV_WAIVER));
  });

  test("c28_dev_and_prod_use_exactly_the_public_plc", async () => {
    // Decision 20 and local-plc Amendment 4: the dev (staging) and prod PDS publish to plc.directory and nowhere else.
    // The PDS reads an unset or empty value as https://plc.directory (@atproto/pds 0.5.37 dist/config/config.js:99,
    // env.js:57), so the value is required spelled out.
    for (const env of ["prod", "dev"]) {
      const base: Stack = env === "dev" ? { compose: DEV } : {};
      const pdsEnv = env === "dev" ? DEV_ENV : {};
      for (const value of [
        null,
        "",
        "http://plc:2582",
        "https://plc.directory/",
        "http://plc.directory",
        "https://plc.directory.example.test",
        "https://PLC.directory",
        "https://evil.example/https://plc.directory",
        "'https://plc.directory '",
        "https://user@plc.directory",
        "https://plc.directory:443",
        "https://plc%2Edirectory",
      ]) {
        expect(
          await expectOnly("C28", { ...base, pdsEnv: { ...pdsEnv, PDS_DID_PLC_URL: value } }, env),
          `${env} ${value}`,
        ).toBe(value === null ? "FAIL C28 PDS_DID_PLC_URL missing" : "FAIL C28 PDS_DID_PLC_URL is not the public PLC");
      }
    }
  });

  // Alex's "Local only" answer keeps mail required off local, pinned here (record p127l-local-gaps, Amendment 6).
  const offLocal = (env: "dev" | "prod", unset: Record<string, null>): Stack =>
    env === "dev" ? { compose: DEV, pdsEnv: { ...DEV_ENV, ...unset } } : { pdsEnv: unset };

  for (const env of ["dev", "prod"] as const) {
    test(`c11_required_${env}`, async () => {
      expect(await expectWithC30("C11", offLocal(env, { PDS_EMAIL_SMTP_URL: null }), env)).toBe(
        "FAIL C11 PDS_EMAIL_SMTP_URL missing",
      );
      expect(await expectOnly("C11", offLocal(env, { PDS_EMAIL_FROM_ADDRESS: null }), env)).toBe(
        "FAIL C11 PDS_EMAIL_FROM_ADDRESS missing",
      );
    });

    test(`c19_required_${env}`, async () => {
      expect(await expectWithC30("C19", offLocal(env, { PDS_MODERATION_EMAIL_SMTP_URL: null }), env)).toBe(
        "FAIL C19 PDS_MODERATION_EMAIL_SMTP_URL missing",
      );
      expect(await expectOnly("C19", offLocal(env, { PDS_MODERATION_EMAIL_ADDRESS: null }), env)).toBe(
        "FAIL C19 PDS_MODERATION_EMAIL_ADDRESS missing",
      );
    });
  }

  test("c15_subdomain_entry_refused", async () => {
    // About our own suffix: C15 refuses handle domains under the profile domain (0x40.me), so the test needs it. The
    // label is a one-letter placeholder (P1.35i), reserved when handle registration lands (P2.09).
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
    '    ports: ["80:80", "443:443", "127.0.0.1:2019:2019"]\n    networks:\n      front:\n        priority: 1\n      inner:',
  )
    .replace(
      "    env_file: ../../unset-dev-env/pds.env",
      "    env_file: ../../unset-dev-env/pds.env\n    networks: [inner]",
    )
    .replace("\nnetworks:\n", "\nnetworks:\n  front: {}\n  inner:\n    internal: true\n");
  const NETWORKED_TABLE = {
    back: { internal: false, members: ["web"] },
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
        .replace("    networks: [back]", `    networks: ${webNetworks}`)
        .replace("\nnetworks:\n", "\nnetworks:\n  pds_net:\n    internal: true\n");
    const table = {
      default: { internal: false, members: ["edge", "web"] },
      back: { internal: false, members: [] },
      pds_net: { internal: true, members: ["edge", "pds"] },
    };
    expect(failed((await check({ compose: withPdsNetwork("[default]"), networks: table })).lines)).toEqual([]);
    // The table cannot admit it either: only the edge may share a network with the PDS (option C point 4).
    expect(await expectOnly("C17", { compose: withPdsNetwork("[default, pds_net]"), networks: table })).toBe(
      "FAIL C17 web shares a network with the pds; web is on pds_net, the table says not",
    );
    const admitted = { ...table, pds_net: { internal: true, members: ["edge", "pds", "web"] } };
    expect(await expectOnly("C17", { compose: withPdsNetwork("[default, pds_net]"), networks: admitted })).toBe(
      "FAIL C17 web shares a network with the pds",
    );
  });

  test("c17_neighbours_are_known_by_image", async () => {
    // Architecture 2026-10-15 03:05Z, F3: a PDS and the edge are known by the image they run, never by name alone.
    const c17 = async (compose: string, networks: object = TABLE) =>
      (await check({ compose, networks })).lines.find((line) => / C17 /.test(line));
    const beside = (name: string, image: string) =>
      COMPOSE.replace("  web:\n", `  ${name}:\n    image: ${image}\n  web:\n`);
    const withMember = (name: string) => ({ ...TABLE, default: { internal: false, members: ["edge", "pds", name] } });
    // A second service running the PDS image, under another name, is a second PDS.
    expect(await c17(beside("relay", PDS), withMember("relay"))).toBe("FAIL C17 pds and relay both run the pds");
    // A service named edge that runs another image is no edge.
    expect(await c17(COMPOSE.replace(`    image: ${EDGE}\n`, `    image: ${WEB}\n`))).toBe(
      "FAIL C17 edge shares a network with the pds",
    );
    // Nor is a service whose name merely starts with edge (verify-895 N5).
    expect(await c17(beside("edge-proxy", WEB), withMember("edge-proxy"))).toBe(
      "FAIL C17 edge-proxy shares a network with the pds",
    );
  });

  test("c17_default_network_counted", async () => {
    // A service with no networks key joins `default`, so a table without it, or without one of its members, fails.
    await expectOnly("C17", { networks: {} });
    await expectOnly("C17", { networks: { ...TABLE, default: { internal: false, members: ["edge"] } } });
    // A top-level networks.default changes that network's settings.
    const internal = COMPOSE.replace("\nnetworks:\n", "\nnetworks:\n  default:\n    internal: true\n");
    await expectOnly("C17", { compose: internal });
    const table = { ...TABLE, default: { internal: true, members: ["edge", "pds"] } };
    expect(failed((await check({ compose: internal, networks: table })).lines)).toEqual([]);
  });

  test("c17_list_and_map_forms", async () => {
    expect(failed((await check({ compose: NETWORKED, networks: NETWORKED_TABLE })).lines)).toEqual([]);
    const outer = { ...NETWORKED_TABLE, inner: { internal: false, members: ["edge", "pds"] } };
    expect(await expectOnly("C17", { compose: NETWORKED, networks: outer })).toContain("inner: internal differs");
    // An attachment key outside the four the subset reads, an empty list, and a network no file defines are refused.
    const mac = NETWORKED.replace("        priority: 1", "        mac_address: 02:42:ac:11:00:02");
    await cannotRun({ compose: mac, networks: NETWORKED_TABLE }, /mac_address/);
    const empty = NETWORKED.replace("networks: [inner]", "networks: []");
    await cannotRun({ compose: empty, networks: NETWORKED_TABLE }, /empty/);
    const undefinedNetwork = NETWORKED.replace("networks: [inner]", "networks: [gone]");
    await cannotRun({ compose: undefinedNetwork, networks: NETWORKED_TABLE }, /network gone is not defined/);
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
      // verify-876 N3: another name ending in -reader is not the reader.
      ["pds-email-reader", unlogged(reader.replace("  pds-token-reader:", "  pds-email-reader:"))],
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

  test("c17_local_only_networks_refused_outside_local", async () => {
    // Architecture 2026-10-15 02:32Z: a PLC network belongs to the local stack alone, so dev and prod refuse one even
    // when their table lists it; under local, one the local-only list does not name is refused by the table.
    const plc = (compose: string) =>
      compose.replace("    networks: [back]", "    networks: [plc_web]").replace("  back: {}", "  plc_web: {}");
    const table = { default: TABLE.default, plc_web: { internal: false, members: ["web"] } };
    expect(await expectOnly("C17", { compose: plc(COMPOSE), networks: table })).toBe(
      "FAIL C17 network plc_web is local only",
    );
    const dev = await check({ compose: plc(DEV), pdsEnv: DEV_ENV, networks: table }, "dev");
    expect(dev.lines).toContain("FAIL C17 network plc_web is local only");
  });

  test("c17_dev_refuses_edge_aliases_and_internal_hosts", async () => {
    // P1.36i (ADR 0031 Decision 3), through the check (verify-1145 B2): under dev an aliased edge or a net-guard
    // internal host fails C17 alone, in fixed words, so no configured value withholds the reason; local is not refused.
    const dev = { pdsEnv: DEV_ENV };
    const table = { ...TABLE, tunnel: { internal: false, members: ["newt"] } };
    // The edge leaves the default network for edge and app, where it carries the aliases.
    const aliasTable = {
      ...table,
      default: { ...TABLE.default, members: TABLE.default.members.filter((member) => member !== "edge") },
      edge: { internal: false, members: ["edge"] },
      app: { internal: false, members: ["edge"] },
    };
    const aliased = (text: string) =>
      text
        .replace(
          "    secrets: [dev_tls_cert, dev_tls_key]\n",
          '$&    networks:\n      edge:\n        aliases: ["${APP_HOST}", "${PDS_HOSTNAME}"]\n      app:\n        aliases: ["${APP_HOST}", "${PDS_HOSTNAME}"]\n',
        )
        .replace("  tunnel: {}\n", "$&  edge: {}\n  app: {}\n");
    const hosts = (text: string) =>
      text.replace("      FINGERPRINT_CHECK: arachnid\n", "$&      NETGUARD_INTERNAL_HOSTS: pds.example.test\n");
    expect(failed((await check({ ...dev, compose: DEV, networks: table }, "dev")).lines)).not.toContain("C17");
    expect(await expectOnly("C17", { ...dev, compose: aliased(DEV), networks: aliasTable }, "dev")).toBe(
      "FAIL C17 the edge carries a network alias",
    );
    expect(await expectOnly("C17", { ...dev, compose: hosts(DEV), networks: table }, "dev")).toBe(
      "FAIL C17 a service names an internal host for net-guard",
    );
  });

  test("c17_outside_dev_refuses_a_bare_edge", async () => {
    // The P1.36i follow-up through the check itself, so C17 dropping edgeAliasProblems fails here (the coordinator's
    // review of 8cfc5ab): under prod an edge on the edge network with no alias fails C17 alone; with them it passes.
    const onEdge = (aliases: string) =>
      COMPOSE.replace(
        "      ACME_EMAIL: edge@example.test\n",
        `$&    networks:\n      default:\n      edge:${aliases}\n`,
      ).replace("  back: {}\n", "$&  edge: {}\n");
    const networks = { ...TABLE, edge: { internal: false, members: ["edge"] } };
    expect(await expectOnly("C17", { compose: onEdge(""), networks })).toBe(
      "FAIL C17 the edge carries no alias on its networks",
    );
    const aliased = onEdge('\n        aliases: ["${APP_HOST}", "${PDS_HOSTNAME}"]');
    expect(failed((await check({ compose: aliased, networks })).lines)).not.toContain("C17");
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
    const result = await check({ compose, files: DOCKERFILES });
    // A mismatched edge is no edge, so C17 also refuses it beside the PDS (P1.35o, architecture 03:05Z F3).
    expect(failedBesideBuild(result.lines)).toEqual(["C17", "C25"]);
    expect(result.lines).toContain("FAIL C25 edge adds a capability but its image and build name different images");
  });

  test("c25_other_image_built_from_the_edge_dockerfile_fails", async () => {
    const compose = built("web", WEB, "deployment/edge/Dockerfile", adds);
    expect(await expectOnlyBesideBuild("C25", { compose, files: DOCKERFILES })).toBe(
      "FAIL C25 web adds a capability but its image and build name different images",
    );
  });

  test("c25_edge_image_built_from_the_edge_dockerfile_passes", async () => {
    const compose = built("edge", EDGE, "deployment/edge/Dockerfile");
    const result = await check({ compose, files: DOCKERFILES });
    expect(failedBesideBuild(result.lines)).toEqual([]);
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
    expect(failedBesideBuild(result.lines)).toEqual([]);
  });

  test("c26_context_other_than_the_root_fails", async () => {
    // Each names the scanned node-app Dockerfile, from another context.
    for (const [context, dockerfile] of [
      [".", "images/node-app.Dockerfile"],
      ["../deployment", "images/node-app.Dockerfile"],
      ["./images", "node-app.Dockerfile"],
    ]) {
      expect(
        await expectOnlyBesideBuild("C26", {
          compose: webBuilds(context as string, dockerfile as string),
          files: DOCKERFILES,
        }),
        context,
      ).toBe("FAIL C26 web builds from a context other than the images workflow's");
    }
  });

  // As the images workflow refuses them (scripts/ci/list-dockerfiles.ts entryProblems): a symlinked Dockerfile or
  // folder, and an image name outside ^[a-z0-9-]+$. That workflow's discover job is not a required check, so C26 is.
  test("c26_symlinks_and_bad_image_names_fail", async () => {
    const files = { ...DOCKERFILES, "deployment/images/Web_App.Dockerfile": "FROM scratch\n" };
    const name = await expectOnlyBesideBuild("C26", {
      compose: webBuilds("..", "deployment/images/Web_App.Dockerfile"),
      files,
    });
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
      "FAIL C2 web has a build; dev and prod run only registry images",
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
      "FAIL C2 web has a build; dev and prod run only registry images",
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
      expect(await expectOnlyBesideBuild("C26", { compose: webBuilds("..", dockerfile), files }), dockerfile).toBe(
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
        await expectOnlyBesideBuild("C26", { compose: webBuilds(context as string, dockerfile as string), files }),
        dockerfile,
      ).toBe("FAIL C26 web builds an image whose name another Dockerfile also takes");
    }
  });

  // P1.33w, P1.34d item 6 (record 2026-10-12-p134c-p134d-local-dev-root-ca, point 6): the dev root CA's key folder,
  // beside the checkout like the secrets folder, is never sent to the daemon either.
  test("c26_build_context_reaching_dev_ca_fails", async () => {
    const reaches = "FAIL C26 web builds from a context that reaches the dev CA folder";
    const run = async (context: string, dockerfile: string, setUp: (root: string) => void = () => undefined) => {
      const s = stack({ compose: webBuilds(context, dockerfile), files: DOCKERFILES });
      mkdirSync(devCaOf(s.root), { mode: 0o700 });
      setUp(s.root);
      return preflight(["--env", "prod", "--compose", s.file], { root: s.root, run: fakeRun().run, ...fakeFs(s.root) });
    };
    expect((await run("../../unset-dev-ca", "../repo/deployment/images/node-app.Dockerfile")).lines).toContain(reaches);
    const within = (root: string) => mkdirSync(join(devCaOf(root), "sub"), { mode: 0o700 });
    expect(
      (await run("../../unset-dev-ca/sub", "../../repo/deployment/images/node-app.Dockerfile", within)).lines,
    ).toContain(reaches);
    // Reached only through a link to the folder.
    const link = (root: string) => void symlinkSync(devCaOf(root), join(dirname(root), "calink"));
    expect((await run("../../calink", "../repo/deployment/images/node-app.Dockerfile", link)).lines).toContain(reaches);
    // Before the folder exists too: a context that names it would send whatever lands there later.
    const s = stack({
      compose: webBuilds("../../unset-dev-ca", "../repo/deployment/images/node-app.Dockerfile"),
      files: DOCKERFILES,
    });
    const missingFolder = await preflight(["--env", "prod", "--compose", s.file], {
      root: s.root,
      run: fakeRun().run,
      ...fakeFs(s.root),
    });
    expect(missingFolder.lines).toContain(reaches);
    // The usual root context does not reach it: the folder sits beside the checkout, not in it. Only P1.35a's rule that
    // a prod host has no dev CA folder at all refuses.
    const usual = (await run("..", "deployment/images/node-app.Dockerfile")).lines;
    expect(usual.filter((line) => / C26 /.test(line))).toEqual(["FAIL C26 dev CA folder present on a prod host"]);
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
    // The context is judged hop by hop like a bind source (Amendment 6): a group-writable context fails.
    const open = (root: string) => {
      mkdirSync(join(dirname(root), "ctx"));
      chmodSync(join(dirname(root), "ctx"), 0o775);
    };
    expect((await run("../../ctx", "../repo/deployment/images/node-app.Dockerfile", open)).lines).toContain(
      "FAIL C26 web builds from a context that another user can change",
    );
    // A group-writable checkout: the env reader's walk of the project's .env, absent or not, stops the run first,
    // since another user could put one there (P1.34r).
    const checkout = await run("..", "deployment/images/node-app.Dockerfile", (root) => chmodSync(root, 0o775));
    expect(checkout.lines).toEqual([
      expect.stringMatching(/^ERROR \S+\/deployment\/\.env lies on a path that another user can change$/),
    ]);
    // The sibling layout passes.
    expect(failedBesideBuild((await run("..", "deployment/images/node-app.Dockerfile")).lines)).toEqual([]);
  });

  test("c26_edge_dockerfile_builds_from_its_own_folder", async () => {
    expect(
      failedBesideBuild((await check({ compose: webBuilds("./edge", "Dockerfile"), files: DOCKERFILES })).lines),
    ).toEqual([]);
    for (const [context, dockerfile] of [
      ["..", "deployment/edge/Dockerfile"],
      ["./edge/sites", "../Dockerfile"],
      [".", "edge/Dockerfile"],
    ]) {
      expect(
        await expectOnlyBesideBuild("C26", {
          compose: webBuilds(context as string, dockerfile as string),
          files: DOCKERFILES,
        }),
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
      expect(
        await expectOnlyBesideBuild("C26", { compose: webBuilds("..", dockerfile), files: DOCKERFILES }),
        dockerfile,
      ).toBe("FAIL C26 web builds from a Dockerfile the images workflow does not scan");
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
    expect(await expectOnlyBesideBuild("C27", { compose: pg, lock, files: DOCKERFILES })).toBe(
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

// P1.36k (architecture 2026-10-19 03:45Z and 03:50Z): a container cannot tell a local stack from staging, since both
// run UNSET_ENV=dev, so the runtime allowances meant for local alone are refused by key and by origin scheme here.
describe("preflight C29 (P1.36k)", () => {
  /** The all-good stack under `env` with `lines` added to web's environment. */
  // Under dev web's origin is on the dev app host (C18, P1.37 follow-up), so a case's own origin replaces DEV's there.
  const withWeb = (env: "dev" | "prod", lines: string): Stack => {
    if (env === "prod") return { compose: COMPOSE.replace("      FINGERPRINT_CHECK: arachnid", `$&\n${lines}`) };
    const own = lines.includes("PUBLIC_ORIGIN:") ? "      PUBLIC_ORIGIN: https://staging.unset.sh\n" : "";
    const staged = lines.replaceAll("app.example.test", "staging.unset.sh");
    const compose = DEV.replace(own, "").replace("      FINGERPRINT_CHECK: arachnid", `$&\n${staged}`);
    return { compose, pdsEnv: DEV_ENV };
  };

  test("c29_local_only_key_fails_under_dev_and_prod", async () => {
    for (const env of ["dev", "prod"] as const) {
      for (const [key, value] of [
        ["OAUTH_ALLOW_HTTP", '"true"'],
        ["OAUTH_ALLOW_HTTP", '"false"'],
        ["NETGUARD_ALLOW_LOOPBACK", '"true"'],
        ["DEV_VITE_ORIGIN", "http://localhost:5173"],
        ["DEV_VITE_ORIGIN", '""'],
      ]) {
        expect(await expectOnly("C29", withWeb(env, `      ${key}: ${value}`), env), `${env} ${key}`).toBe(
          `FAIL C29 key=${key} service=web it is for a local stack only`,
        );
      }
      // From an env file too, and in any service.
      const fromFile = env === "dev" ? { compose: DEV, pdsEnv: { ...DEV_ENV, OAUTH_ALLOW_HTTP: "true" } } : {};
      const prodFile = { pdsEnv: { OAUTH_ALLOW_HTTP: "true" } };
      expect(await expectOnly("C29", env === "dev" ? fromFile : prodFile, env)).toBe(
        "FAIL C29 key=OAUTH_ALLOW_HTTP service=pds it is for a local stack only",
      );
    }
  });

  test("c29_origin_not_https_fails_under_dev_and_prod", async () => {
    for (const env of ["dev", "prod"] as const) {
      for (const [key, value] of [
        ["PUBLIC_ORIGIN", "http://app.example.test"],
        ["MEDIA_ORIGIN", "http://media.example.net"],
        ["ASSETS_BASE", "http://assets.example.test/assets/"],
        ["PUBLIC_ORIGIN", "app.example.test"],
        ["PUBLIC_ORIGIN", '""'],
        ["MEDIA_ORIGIN", "HTTP://media.example.net"],
      ]) {
        // The real dev stack sets UNSET_SERVICE: http, so the reason must not hold "http" or it is withheld.
        const lines = `      UNSET_SERVICE: http\n      ${key}: ${value}`;
        expect(await expectOnly("C29", withWeb(env, lines), env), `${env} ${key} ${value}`).toBe(
          `FAIL C29 key=${key} service=web the origin lacks TLS`,
        );
      }
    }
  });

  test("c29_https_origins_pass", async () => {
    for (const env of ["dev", "prod"] as const) {
      const origins = [
        "      PUBLIC_ORIGIN: https://app.example.test",
        "      MEDIA_ORIGIN: https://media.example.net",
        "      ASSETS_BASE: https://app.example.test/assets/",
      ].join("\n");
      const result = await check(withWeb(env, origins), env);
      expect(
        result.lines.find((l) => / C29 /.test(l)),
        env,
      ).toBe("PASS C29 ok");
      // An empty ASSETS_BASE is the runtime's own default: the public origin's /assets/.
      const empty = await check(withWeb(env, '      ASSETS_BASE: ""'), env);
      expect(
        empty.lines.find((l) => / C29 /.test(l)),
        env,
      ).toBe("PASS C29 ok");
    }
  });
});

// P1.38d (ADR 0031 Decision 1): a public stack never serves a legal placeholder, so under dev and prod any environment
// value that still starts with "[to fill:" fails, naming the service and the keys, never the value.
describe("preflight C32 (P1.38d)", () => {
  const withWeb = (env: "dev" | "prod", lines: string): Stack => ({
    compose: (env === "dev" ? DEV : COMPOSE).replace("      FINGERPRINT_CHECK: arachnid", `$&\n${lines}`),
    ...(env === "dev" ? { pdsEnv: DEV_ENV } : {}),
  });
  const PLACEHOLDERS = '      SUPPORT_EMAIL: "[to fill: SUPPORT_EMAIL]"\n      PRIVACY_OFFICER_TITLE: "[to fill: x]"';

  test("c32_placeholder_fails_under_dev_and_prod", async () => {
    for (const env of ["dev", "prod"] as const) {
      expect(await expectOnly("C32", withWeb(env, PLACEHOLDERS), env), env).toBe(
        "FAIL C32 service=web still a placeholder to fill: SUPPORT_EMAIL, PRIVACY_OFFICER_TITLE",
      );
      // In any service.
      const edge = (env === "dev" ? DEV : COMPOSE).replace(
        "      ACME_EMAIL: edge@example.test",
        '$&\n      CONTACT: "[to fill: CONTACT]"',
      );
      expect(await expectOnly("C32", { compose: edge, ...(env === "dev" ? { pdsEnv: DEV_ENV } : {}) }, env), env).toBe(
        "FAIL C32 service=edge still a placeholder to fill: a name",
      );
    }
  });

  test("c32_names_only_printable_keys", async () => {
    // A key name is caller input (an env file can hold any, even a pasted token): only the legal pages' three
    // settings are printed (P1.37 follow-up).
    for (const env of ["dev", "prod"] as const) {
      const keys = '      sk_live_9f: "[to fill: x]"\n      JBSWY3DPEHPK3PXP: "[to fill: x]"\n';
      expect(await expectOnly("C32", withWeb(env, keys + PLACEHOLDERS), env), env).toBe(
        "FAIL C32 service=web still a placeholder to fill: a name, a name, SUPPORT_EMAIL, PRIVACY_OFFICER_TITLE",
      );
      // The third legal setting is printed by name too.
      const contact = '      PRIVACY_OFFICER_CONTACT: "[to fill: x]"';
      expect(await expectOnly("C32", withWeb(env, contact), env), env).toBe(
        "FAIL C32 service=web still a placeholder to fill: PRIVACY_OFFICER_CONTACT",
      );
    }
  });

  test("c32_filled_values_pass", async () => {
    for (const env of ["dev", "prod"] as const) {
      // Only a value that starts with the marker is one; the same words elsewhere in a value are the value's own.
      const filled = '      SUPPORT_EMAIL: "help@example.test"\n      PRIVACY_OFFICER_TITLE: "Officer [to fill: no]"';
      const result = await check(withWeb(env, filled), env);
      expect(
        result.lines.find((l) => / C32 /.test(l)),
        env,
      ).toBe("PASS C32 ok");
    }
  });

  test("c32_local_skips", () => {
    const serviceEnv = new Map([["web", new SecretMap([["SUPPORT_EMAIL", "[to fill: SUPPORT_EMAIL]"]])]]);
    expect(c32.run({ env: "local", serviceEnv } as unknown as Inputs, new AbortController().signal)).toEqual({
      pass: true,
      reason: "skipped: local stack",
    });
  });
});

// P1.36p (architecture 2026-10-19 04:53Z): under local and dev the PDS's upload bounds are exact. Its temporary blobs
// stay on the data volume, its upload limit is pinned, and its /tmp tmpfs is capped.
describe("preflight C22 pinned upload bounds (P1.36p)", () => {
  const PINNED_TMP = '"/tmp:uid=1000,gid=1000,mode=1777,size=20m"';
  const devWith = (pdsEnv: Record<string, string | null>, tmpfs = `    tmpfs: [${PINNED_TMP}]\n`): Stack => ({
    compose: DEV.replace(`    tmpfs: [${PINNED_TMP}]\n`, tmpfs),
    pdsEnv: { ...DEV_ENV, ...pdsEnv },
  });

  test("c22_temp_blob_location_set_fails", async () => {
    for (const location of ["/tmp/pds/blobs", "/home/node/tempt", ""]) {
      expect(await expectOnly("C22", devWith({ PDS_BLOBSTORE_DISK_TMP_LOCATION: location }), "dev"), location).toBe(
        "FAIL C22 PDS_BLOBSTORE_DISK_TMP_LOCATION is set",
      );
    }
  });

  test("c22_blob_upload_limit_not_pinned_fails", async () => {
    for (const limit of [null, "", "5242881", "5242879", "05242880", "5242880.0", "52428800"]) {
      expect(await expectOnly("C22", devWith({ PDS_BLOB_UPLOAD_LIMIT: limit }), "dev"), String(limit)).toBe(
        "FAIL C22 PDS_BLOB_UPLOAD_LIMIT is not the pinned limit",
      );
    }
  });

  test("c22_pds_tmp_not_capped_fails", async () => {
    for (const tmpfs of [
      "",
      '    tmpfs: ["/tmp:uid=1000,gid=1000,mode=1777"]\n',
      '    tmpfs: ["/tmp"]\n',
      '    tmpfs: ["/tmp:uid=1000,gid=1000,mode=1777,size=21m"]\n',
      '    tmpfs: ["/tmp:uid=1000,gid=1000,mode=1777,size=20480k"]\n',
      '    tmpfs: ["/tmp:uid=1000,gid=1000,mode=1777,size=20m,size=1g"]\n',
      `    tmpfs: [${PINNED_TMP}, "/tmp:uid=1000,gid=1000,mode=1777"]\n`,
      // A second, uncapped /tmp in the long form beside the pinned one.
      `    tmpfs: [${PINNED_TMP}]\n    volumes: [{type: tmpfs, target: /tmp}]\n`,
    ]) {
      expect(await expectOnly("C22", devWith({}, tmpfs), "dev"), tmpfs).toBe(
        "FAIL C22 the PDS's /tmp tmpfs is not capped as pinned",
      );
    }
    // The one capped tmpfs at the parser's other target leaves /tmp on the read-only root (C27 also refuses it).
    const elsewhere = devWith({}, '    tmpfs: ["/var/run/postgresql:uid=1000,gid=1000,mode=1777,size=20m"]\n');
    expect((await check(elsewhere, "dev")).lines.find((l) => / C22 /.test(l))).toBe(
      "FAIL C22 the PDS's /tmp tmpfs is not capped as pinned",
    );
  });

  test("c22_pinned_bounds_pass_and_prod_is_unchanged", async () => {
    expect((await check(devWith({}), "dev")).lines.find((l) => / C22 /.test(l))).toBe(
      "PASS C22 skipped: VIDEO_MASTER_MAX_BYTES is unset",
    );
    // Prod's bounds are set when it is planned (Phase 5): none of the three is judged there yet.
    const prod = await check({
      compose: COMPOSE.replace(`    tmpfs: [${PINNED_TMP}]\n`, ""),
      pdsEnv: { PDS_BLOB_UPLOAD_LIMIT: null },
    });
    expect(prod.lines.find((l) => / C22 /.test(l))).toBe("PASS C22 skipped: VIDEO_MASTER_MAX_BYTES is unset");
  });
});

// P1.37k (architecture 07:19Z on verify-1071, N2): the failing key and service print beside the verdict, each from a
// closed list and checked before printing, so a withheld reason no longer hides which key failed.
describe("preflight named key and service (P1.37k)", () => {
  const WITHHELD = "reason withheld (it contained a configured value)";
  const named = (outcome: Partial<Outcome>): Check => ({
    id: "CX",
    run: () => ({ pass: false, reason: "refused", ...outcome }),
  });

  test("a_failure_on_web_prints_its_key_and_service", async () => {
    // The real dev stack sets PG_USER: web, so the service name is also a configured value and must still print.
    const lines = '$&\n      OAUTH_ALLOW_HTTP: "true"\n      PG_USER: web';
    const compose = DEV.replace("      FINGERPRINT_CHECK: arachnid", lines);
    expect(await expectOnly("C29", { compose, pdsEnv: DEV_ENV }, "dev")).toBe(
      "FAIL C29 key=OAUTH_ALLOW_HTTP service=web it is for a local stack only",
    );
  });

  test("a_key_or_service_not_on_its_list_prints_nothing", async () => {
    const unlisted = named({ key: "PDS_ADMIN_PASSWORD" as never, service: "web" });
    expect((await check({}, "prod", { checks: [unlisted] })).lines).toEqual(["FAIL CX service=web refused"]);
    const elsewhere = named({ key: "OAUTH_ALLOW_HTTP", service: "not-in-this-stack" });
    expect((await check({}, "prod", { checks: [elsewhere] })).lines).toEqual(["FAIL CX key=OAUTH_ALLOW_HTTP refused"]);
    // A parsed name outside compose-spec's service-name characters is not printed either.
    const spaced = COMPOSE.replace("services:\n  edge:", "services:\n  'we b':\n    image: x\n  edge:");
    const odd = named({ key: "OAUTH_ALLOW_HTTP", service: "we b" });
    expect((await check({ compose: spaced }, "prod", { checks: [odd] })).lines).toEqual([
      "FAIL CX key=OAUTH_ALLOW_HTTP refused",
    ]);
  });

  test("a_reason_holding_a_configured_value_is_still_withheld_whole", async () => {
    const quoting: Check = {
      id: "CX",
      run: (inputs) => ({
        pass: false,
        reason: `saw ${inputs.serviceEnv.get("pds")?.use("PDS_HOSTNAME", (v) => v) ?? ""}`,
        key: "PUBLIC_ORIGIN",
        service: "pds",
      }),
    };
    expect((await check({}, "prod", { checks: [quoting] })).lines).toEqual([
      `FAIL CX key=PUBLIC_ORIGIN service=pds ${WITHHELD}`,
    ]);
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
      preflight(argv(file, ...extra), {
        root,
        run: fakeRun().run,
        environment: {},
        checks: [hostnameIs(want)],
        // The env reader walks with the run's lstat (P1.34r), so the parents above the temporary folder are faked.
        ...fakeFs(root),
      });
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
      (await preflight(argv(file, ...extra), { root, run: fakeRun().run, environment: {}, ...fakeFs(root) })).lines;
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
      const fromDotEnv = await preflight(argv(file), { root, run: fakeRun().run, environment: {}, ...fakeFs(root) });
      expect(fromDotEnv, name).toEqual({ code: 2, lines: [`ERROR ${name} is set in the env file`] });
      const flag = envFile(root, "flag.env", `${name}=\n`);
      const fromFlag = await preflight(argv(file, "--interpolation-env", flag), {
        root,
        run: fakeRun().run,
        environment: {},
        ...fakeFs(root),
      });
      expect(fromFlag, name).toEqual({ code: 2, lines: [`ERROR ${name} is set in the env file`] });
    }
  });

  test("interpolated_name_in_the_environment_cannot_run", async () => {
    // Compose takes a shell value over the env file (Docker docs "Interpolation"; compose-go Mapping.Merge), so a name
    // the files interpolate must not be set where the preflight runs.
    const { root, file } = stack({ compose: REF, dotEnv: "HOST_NAME=pds.example.test\n" });
    const deps = { root, run: fakeRun().run, checks: [hostnameIs("pds.example.test")], ...fakeFs(root) };
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
    if (noKey) rmSync(join(root, "deployment/sigstore/trusted_root.json"));
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
    const dev = { compose: DEV, pdsEnv: DEV_ENV, networks: DEV_TABLE };
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
      // The verifier on #789: a mutant dropping dev's trust material requirement survived nine samples. Both stages, and
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
      // The fixture lock's upstream images: the PDS, and Newt since P1.37v.
      "PASS C4 2 upstream images verified",
      "PASS C5 ok",
    ];
    const NO_LOCK = ["C2", "C3", "C4", "C5"].map(
      (id) => `FAIL ${id} input missing: <root>/deployment/images.lock.json`,
    );
    const seen: Record<string, string[]> = {};
    for (const [name, s, env, deps, noKey] of cases) seen[name] = await imageLines(s, env, deps, noKey);
    const NO_KEY = ["C3", "C4"].map((id) => `FAIL ${id} input missing: <root>/deployment/sigstore/trusted_root.json`);
    expect(seen).toEqual({
      prod: PASSED,
      dev: PASSED,
      "no lock": NO_LOCK,
      "dev no lock": NO_LOCK,
      "not ours": ["FAIL C2 edge image is not ghcr.io/undefined6799/... by digest", ...PASSED.slice(1)],
      unsigned: [PASSED[0], "FAIL C3 edge: signature does not verify: bad", ...PASSED.slice(2)],
      platform: [...PASSED.slice(0, 3), "FAIL C5 edge is not a multi-arch index"],
      "build only": ["FAIL C2 web has a build; dev and prod run only registry images", ...PASSED.slice(1)],
      "dev build only": ["FAIL C2 web has a build; dev and prod run only registry images", ...PASSED.slice(1)],
      "no key": [PASSED[0], ...NO_KEY, PASSED[3]],
      "dev no key": [PASSED[0], ...NO_KEY, PASSED[3]],
      "dev not ours": ["FAIL C2 edge image is not ghcr.io/undefined6799/... by digest", ...PASSED.slice(1)],
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
      - ./edge/sites/pds.caddy:/etc/caddy/sites/enabled/pds.caddy:ro
      - ./edge/local/app.caddy:/etc/caddy/sites/enabled/app.caddy:ro
      - ./edge/local/tls.caddy:/etc/caddy/snippets/tls.caddy:ro
    environment:
      PDS_HOST: pds.localhost
      PDS_UPSTREAM: pds:3000
      APP_HOST: app.localhost
      APP_UPSTREAM: web:3000
      ACME_EMAIL: edge@example.test
  pds:
    image: ${LOCKED_PDS}
    tmpfs: ["/tmp:uid=1000,gid=1000,mode=1777,size=20m"]
    env_file: ../../unset-dev-env/pds.env
    environment:
      PDS_HOSTNAME: pds.localhost
  web:
    build:
      context: ..
      dockerfile: deployment/images/node-app.Dockerfile
    user: "65532:65532"
    networks: [back]
    secrets: [db_password]
    environment:
      PUBLIC_ORIGIN: https://app.localhost
secrets:
  db_password:
    file: ../../unset-dev-secrets/db_password
  local_tls_cert:
    file: ../../unset-dev-secrets/local_tls_cert
  local_tls_key:
    file: ../../unset-dev-secrets/local_tls_key
networks:
  back: {}
`;
  /**
   * The handle domain is the PDS's own, and local runs without email: no SMTP URL is set (Alex's "Local only" mail card,
   * 2026-10-14T20:28:12Z; architecture record 2026-10-13-p127l-local-gaps, Amendment 6).
   */
  const LOCAL_ENV = {
    PDS_SERVICE_HANDLE_DOMAINS: ".pds.localhost",
    PDS_DID_PLC_URL: "https://plc.directory",
    PDS_EMAIL_SMTP_URL: null,
    PDS_MODERATION_EMAIL_SMTP_URL: null,
    PDS_MODERATION_EMAIL_ADDRESS: null,
    PDS_EMAIL_FROM_ADDRESS: null,
  };
  const LOCAL_FILES = {
    ...NODE_APP,
    "deployment/edge/Dockerfile": "FROM scratch\n",
    "deployment/edge/local/tls.caddy": readFileSync(join(EDGE_DIR, "local/tls.caddy"), "utf8"),
    "deployment/edge/local/app.caddy": readFileSync(join(EDGE_DIR, "local/app.caddy"), "utf8"),
    "deployment/images/bases.lock.json": BASES,
    "deployment/mirror.list.json": MIRROR,
  };
  const LOCAL_LAST = "LOCAL unsigned, local-only stack: never deploy it";
  /**
   * A throwaway dev root and leaves it signs, made by openssl as the runbook does (P1.33x): the root name-constrained to
   * the two local hosts, each leaf with `san` as its subjectAltName.
   */
  const pki = mkdtempSync(join(tmpdir(), "local-leaf-"));
  /** The runbook's name constraints (record 2026-10-12-p134c-p134d-local-dev-root-ca, item 2 and Amendment 2). */
  const LOCAL_CONSTRAINTS =
    "permitted;DNS:app.localhost,permitted;DNS:pds.localhost,excluded;IP:0.0.0.0/0.0.0.0,excluded;IP:::/::";
  dirs.push(pki);
  const openssl = (...args: string[]) => execFileSync("openssl", args, { cwd: pki, stdio: ["ignore", "pipe", "pipe"] });
  openssl(
    ..."req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -keyout root.key -out root.pem -days 30".split(
      " ",
    ),
    ...["-subj", "/CN=throwaway root", "-addext", "basicConstraints=critical,CA:TRUE,pathlen:0"],
    ...["-addext", "keyUsage=critical,keyCertSign,cRLSign"],
    ...["-addext", `nameConstraints=critical,${LOCAL_CONSTRAINTS}`],
  );
  const DEV_ROOT = readFileSync(join(pki, "root.pem"), "utf8");
  /** Another root under the same name with its own key, and the same key under another name: each signature check alone. */
  const rootLike = (out: string, key: string, subject: string) => {
    openssl(...`req -x509 -nodes -days 30 -out ${out} -subj`.split(" "), subject, ...key.split(" "));
    return readFileSync(join(pki, out), "utf8");
  };
  // Without key identifiers, so only the signature tells this root from the real one (OpenSSL's issuer check also
  // compares the leaf's authority key id with the root's subject key id when both are present).
  const SAME_NAME_ROOT = rootLike(
    "same-name.pem",
    "-newkey ec -pkeyopt ec_paramgen_curve:P-256 -keyout other.key -addext subjectKeyIdentifier=none",
    "/CN=throwaway root",
  );
  const SAME_KEY_ROOT = rootLike("same-key.pem", "-key root.key", "/CN=another root");
  let leaves = 0;
  const leafPem = (san: string | null, { days = 30, ca = false, issuer = "root", akid = true } = {}): string => {
    const name = `leaf${leaves++}`;
    openssl(
      ...`req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -keyout ${name}.key -out ${name}.pem`.split(" "),
      ...["-days", String(days), "-subj", "/CN=app.localhost", "-CA", `${issuer}.pem`, "-CAkey", `${issuer}.key`],
      ...["-addext", `basicConstraints=critical,CA:${ca ? "TRUE" : "FALSE"}`],
      ...(san === null ? [] : ["-addext", `subjectAltName=${san}`]),
      ...(akid ? [] : ["-addext", "authorityKeyIdentifier=none"]),
    );
    return readFileSync(join(pki, `${name}.pem`), "utf8");
  };
  const LEAF = leafPem("DNS:app.localhost,DNS:pds.localhost");
  // `openssl ca` sets exact validity dates, which `req -x509` (3.0) cannot: notBefore and notAfter as days from now.
  writeFileSync(
    join(pki, "ca.cnf"),
    "[ca]\ndefault_ca = d\n[d]\ndatabase = index.txt\nnew_certs_dir = .\nserial = serial\ndefault_md = sha256\n" +
      "policy = p\nunique_subject = no\ncopy_extensions = copy\n[p]\ncommonName = supplied\n",
  );
  writeFileSync(join(pki, "index.txt"), "");
  writeFileSync(join(pki, "serial"), "01\n");
  const stamp = (days: number) =>
    `${new Date(Date.now() + days * 86_400_000).toISOString().replace(/[-:T]/g, "").slice(2, 14)}Z`;
  const datedPem = (kind: "root" | "leaf", from: number, to: number): string => {
    const name = `dated${leaves++}`;
    const subject = kind === "root" ? "/CN=throwaway root" : "/CN=app.localhost";
    const ext =
      kind === "root"
        ? ["basicConstraints=critical,CA:TRUE,pathlen:0", "keyUsage=critical,keyCertSign,cRLSign"]
        : ["basicConstraints=critical,CA:FALSE", "subjectAltName=DNS:app.localhost,DNS:pds.localhost"];
    openssl(
      ...`req -new -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -keyout ${name}.key -out ${name}.csr`.split(" "),
      ...["-subj", subject, ...ext.flatMap((e) => ["-addext", e])],
    );
    const signer =
      kind === "root" ? ["-selfsign", "-keyfile", `${name}.key`] : ["-cert", "root.pem", "-keyfile", "root.key"];
    openssl(
      ...`ca -batch -notext -config ca.cnf -in ${name}.csr -out ${name}.pem`.split(" "),
      ...signer,
      ...["-startdate", stamp(from), "-enddate", stamp(to)],
    );
    return readFileSync(join(pki, `${name}.pem`), "utf8");
  };
  /** The edge Dockerfile itself, built from the root: the path is right, but C26 refuses the context. */
  const OFF_CONTEXT_EDGE = "      context: ..\n      dockerfile: deployment/edge/Dockerfile\n";
  /** The local stack after `edit`, with its leaf secret files written beside the other secrets. */
  async function local(
    edit: (text: string) => string = (text) => text,
    {
      links = {},
      remove = [],
      leaf = LEAF,
      devRoot = DEV_ROOT,
      caRoot = devRoot,
      setUp = () => undefined,
      owners = () => ({}),
      deps = {},
      ...s
    }: Stack & {
      links?: Record<string, string>;
      remove?: string[];
      leaf?: string | null;
      devRoot?: string | null;
      caRoot?: string | null;
      setUp?: (root: string) => void;
      /** Paths that read as owned by another uid (fakeFs), named once the stack's root is known. */
      owners?: (root: string) => Record<string, number>;
      deps?: Partial<Deps>;
    } = {},
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
    if (leaf !== null) writeFileSync(join(envOf(root), "local-leaf.pem"), leaf);
    if (devRoot !== null) {
      mkdirSync(join(dirname(root), "unset-dev-trust"), { recursive: true });
      writeFileSync(join(dirname(root), "unset-dev-trust/root.pem"), devRoot);
      chmodSync(join(dirname(root), "unset-dev-trust"), 0o755);
      chmodSync(join(dirname(root), "unset-dev-trust/root.pem"), 0o644);
    }
    // Local needs the dev CA (P1.35a): the folder with its key and its root, one link each.
    mkdirSync(devCaOf(root), { mode: 0o700 });
    writeFileSync(join(devCaOf(root), "root.key"), "fixture\n", { mode: 0o400 });
    if (caRoot !== null) writeFileSync(join(devCaOf(root), "root.pem"), caRoot, { mode: 0o600 });
    for (const [path, target] of Object.entries(links)) symlinkSync(target, join(root, path));
    for (const path of remove) rmSync(join(root, path));
    setUp(root);
    const result = await preflight(["--env", "local", "--compose", file], {
      root,
      run: fakeRun().run,
      ...fakeFs(root, WEB_UID, owners(root)),
      ...deps,
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

  test("local_c28_admits_only_the_public_plc", async () => {
    // ADR 0023 (Alex, 2026-10-16): we run no PLC of our own, so the local PDS publishes to plc.directory like dev and
    // prod, spelled out exactly; the local PLC's old URL, unset and look-alikes fail.
    const c28 = async (value: string | null) =>
      (await local((text) => text, { pdsEnv: { ...LOCAL_ENV, PDS_DID_PLC_URL: value } })).lines.find((line) =>
        / C28 /.test(line),
      );
    expect(await c28("https://plc.directory")).toBe("PASS C28 ok");
    expect(await c28(null)).toBe("FAIL C28 PDS_DID_PLC_URL missing");
    for (const value of [
      "",
      "http://plc:2582",
      "https://plc.directory/",
      "http://plc.directory",
      "https://plc.directory.example.test",
      "https://evil.example/https://plc.directory",
      "'https://plc.directory '",
      "https://user@plc.directory",
    ]) {
      expect(await c28(value), value).toBe("FAIL C28 PDS_DID_PLC_URL is not the public PLC");
    }
  });

  test("local_c29_keeps_local_only_keys", async () => {
    // P1.36k: the local-only keys and plain-http origins stay a local stack's to use, so C29 skips --env local.
    const keys = { OAUTH_ALLOW_HTTP: "true", NETGUARD_ALLOW_LOOPBACK: "true", PUBLIC_ORIGIN: "http://app.localhost" };
    const { code, lines } = await local((text) => text, { pdsEnv: { ...LOCAL_ENV, ...keys } });
    expect(lines.find((line) => / C29 /.test(line))).toBe("PASS C29 skipped: local stack");
    expect(code).toBe(0);
  });

  test("local_c22_pins_the_upload_bounds", async () => {
    // P1.36p: local judges the same three bounds as dev.
    const c22 = async (edit: (text: string) => string, env: Record<string, string | null> = {}) =>
      (await local(edit, { pdsEnv: { ...LOCAL_ENV, ...env } })).lines.find((line) => / C22 /.test(line));
    const same = (text: string) => text;
    expect(await c22(same)).toBe("PASS C22 skipped: VIDEO_MASTER_MAX_BYTES is unset");
    expect(await c22(same, { PDS_BLOBSTORE_DISK_TMP_LOCATION: "/tmp/pds/blobs" })).toBe(
      "FAIL C22 PDS_BLOBSTORE_DISK_TMP_LOCATION is set",
    );
    expect(await c22(same, { PDS_BLOB_UPLOAD_LIMIT: "10485760" })).toBe(
      "FAIL C22 PDS_BLOB_UPLOAD_LIMIT is not the pinned limit",
    );
    expect(await c22((text) => text.replace(",size=20m", ""))).toBe(
      "FAIL C22 the PDS's /tmp tmpfs is not capped as pinned",
    );
  });

  test("local_c17_plc_beside_the_pds_fails", () => {
    // P1.35w (architecture 2026-10-19 02:18Z, verify-903-6cc8ab0 F-3): ADR 0022 retired the local PLC, so the plc_pds
    // exemption is gone. A service named plc on plc_pds, running a well-formed localOnly plc entry of the base lock, is
    // a PDS neighbour like any other, under every env. pdsNeighbours is called directly, as C17 refuses plc_pds itself.
    const PLC = { ref: "docker.io/example/plc", tag: "0.0.1", digest: digest("e") };
    const bases = JSON.stringify({
      ...JSON.parse(BASES),
      plc: { ...PLC, source: "upstream", stage: "runtime", buildStage: false, localOnly: true },
    });
    const compose = LOCAL.replace(
      "    env_file: ../../unset-dev-env/pds.env\n",
      "    env_file: ../../unset-dev-env/pds.env\n    networks: [default, plc_pds]\n",
    )
      .replace(
        "\nsecrets:\n  db_password:",
        `\n  plc:\n    image: ${PLC.ref}:${PLC.tag}@${PLC.digest}\n    networks: [plc_pds]\nsecrets:\n  db_password:`,
      )
      .replace("\nnetworks:\n  back: {}\n", "\nnetworks:\n  back: {}\n  plc_pds:\n    internal: true\n");
    for (const env of ["local", "dev", "prod"]) {
      const { root, file } = stack({
        compose,
        pdsEnv: LOCAL_ENV,
        lock: env === "local" ? null : LOCK,
        files: { ...LOCAL_FILES, "deployment/images/bases.lock.json": bases },
      });
      const { inputs } = loadInputs(["--env", env, "--compose", file], { root, run: fakeRun().run, ...fakeFs(root) });
      expect(pdsNeighbours(inputs), env).toEqual(["plc shares a network with the pds"]);
    }
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

  test("local_c26_dev_ca_files_have_one_link", async () => {
    // P1.33w (architecture on verify-861; book edit 2026-10-14-p134d-split, last section): a second name for a CA file,
    // inside the checkout above all, is where a build context or a bind would carry the key; the path and identity
    // tests cannot see it, so every regular file in unset-dev-ca has exactly one link.
    const run = async (link: (root: string) => string | null) => {
      let key = "";
      const result = await local((text) => text, {
        setUp: (root: string) => {
          key = join(devCaOf(root), "root.key");
          const to = link(root);
          if (to !== null) linkSync(key, to);
        },
      });
      return { line: result.lines.find((line) => / C26 /.test(line)), key };
    };
    expect((await run(() => null)).line).toBe("PASS C26 ok");
    for (const where of [
      (root: string) => join(root, "deployment/ca-copy"),
      (root: string) => join(dirname(root), "ca-copy"),
    ]) {
      const { line, key } = await run(where);
      expect(line).toBe(`FAIL C26 dev CA file has extra hard links: ${key}`);
    }
  });

  test("c26_dev_ca_folder_is_judged_by_lstat_in_every_env", async () => {
    // P1.35a (architecture on verify-861-9ae3539, record 2026-10-12-p134c-p134d-local-dev-root-ca, last sections): the
    // folder is a real directory, walked by our own lstat recursion that follows no link; every error refuses, local
    // needs the folder, dev judges it when present, and prod refuses it outright.
    const c26 = (lines: string[]) => lines.find((line) => /^[A-Z]+ C26 /.test(line));
    const onLocal = async (setUp: (root: string) => void, deps: Partial<Deps> = {}) =>
      c26((await local((text) => text, { setUp, deps })).lines);
    const onEnv = async (env: "dev" | "prod", setUp: (root: string) => void) => {
      const s = stack();
      setUp(s.root);
      const result = await preflight(["--env", env, "--compose", s.file], {
        root: s.root,
        run: fakeRun().run,
        ...fakeFs(s.root),
      });
      return c26(result.lines);
    };
    const folder = (root: string) => devCaOf(root);
    const made = (root: string) => {
      mkdirSync(folder(root), { mode: 0o700 });
      writeFileSync(join(folder(root), "root.key"), "fixture\n", { mode: 0o400 });
    };
    let seen = "";
    const note = (path: string) => {
      seen = path;
      return path;
    };
    expect(await onLocal(() => undefined)).toBe("PASS C26 ok");
    // S1: local needs the folder; a link or a file in its place is not one.
    expect(await onLocal((root) => rmSync(folder(root), { recursive: true }))).toBe(
      "FAIL C26 input missing: unset-dev-ca",
    );
    const moved = (root: string) => {
      renameSync(folder(root), join(dirname(root), "store-ca"));
      symlinkSync("store-ca", note(folder(root)));
    };
    expect(await onLocal(moved)).toBe(`FAIL C26 dev CA folder is not a real directory: ${seen}`);
    const file = (root: string) => {
      rmSync(folder(root), { recursive: true });
      writeFileSync(note(folder(root)), "fixture\n");
    };
    expect(await onLocal(file)).toBe(`FAIL C26 dev CA folder is not a real directory: ${seen}`);
    // S3: root.pem at the top and sub/x below, each hard-linked into the checkout on its own, are each refused.
    for (const entry of ["root.pem", "sub/x"]) {
      const linked = (root: string) => {
        mkdirSync(join(folder(root), "sub"), { mode: 0o700 });
        for (const name of ["root.pem", "sub/x"]) writeFileSync(join(folder(root), name), "fixture\n");
        linkSync(note(join(folder(root), entry)), join(root, "deployment/ca-copy"));
      };
      expect(await onLocal(linked), entry).toBe(`FAIL C26 dev CA file has extra hard links: ${seen}`);
    }
    // N1: a link inside the folder, here to a folder outside it, is never followed.
    const pointing = (root: string) => {
      mkdirSync(join(dirname(root), "outside"));
      symlinkSync(join(dirname(root), "outside"), note(join(folder(root), "out")));
    };
    expect(await onLocal(pointing)).toBe(`FAIL C26 dev CA folder holds a link: ${seen}`);
    // Only regular files and real folders: a FIFO refuses even with one link.
    const fifo = (root: string) => void execFileSync("mkfifo", [note(join(folder(root), "pipe"))]);
    expect(await onLocal(fifo)).toBe(`FAIL C26 dev CA folder holds something other than files and folders: ${seen}`);
    // An entry the walk cannot read (mode 000, under any uid): a listing that throws and an entry lstat cannot see.
    const sub = (root: string) => mkdirSync(note(join(folder(root), "sub")), { mode: 0o700 });
    const denied = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    const unlisted = await onLocal(sub, {
      readdir: (path) => {
        if (path.endsWith("/unset-dev-ca/sub")) throw denied;
        return readdirSync(path, { encoding: "buffer" });
      },
    });
    expect(unlisted).toBe(`FAIL C26 dev CA folder entry cannot be read: ${seen}`);
    // The fixture's own lstat, which reads the secrets as the web uid's, for every path but the one it cannot see.
    let at = "";
    const blind = (hide: (root: string) => string) => (path: string) =>
      path === hide(at) ? null : (fakeFs(at).lstat?.(path) ?? null);
    const unseen = await onLocal(
      (root) => {
        at = root;
        sub(root);
      },
      { lstat: blind((root) => join(folder(root), "sub")) },
    );
    expect(unseen).toBe(`FAIL C26 dev CA folder entry cannot be read: ${seen}`);
    // The folder itself unreadable: lstat sees nothing, but it is there, so it is not absent either. (A realpath that
    // throws already fails C26 in the context checks that run first.)
    const hidden = await onLocal(
      (root) => {
        at = root;
      },
      { lstat: blind(folder) },
    );
    expect(hidden).toMatch(/^FAIL C26 dev CA folder cannot be read: \/.+\/unset-dev-ca$/);
    // S2: dev passes without the folder and judges it when present; prod refuses its presence.
    expect(await onEnv("dev", () => undefined)).toBe("PASS C26 ok");
    expect(await onEnv("dev", made)).toBe("PASS C26 ok");
    const hardLinked = (root: string) => {
      made(root);
      linkSync(note(join(folder(root), "root.key")), join(root, "deployment/ca-copy"));
    };
    expect(await onEnv("dev", hardLinked)).toBe(`FAIL C26 dev CA file has extra hard links: ${seen}`);
    expect(await onEnv("prod", () => undefined)).toBe("PASS C26 ok");
    expect(await onEnv("prod", made)).toBe("FAIL C26 dev CA folder present on a prod host");
  });

  test("c26_dev_ca_walk_edges_are_pinned", async () => {
    // P1.35m (verify-887 S1, S2, N1-N3; architecture 2026-10-15 02:08Z, last section of record
    // 2026-10-12-p134c-p134d-local-dev-root-ca): every depth, every entry type, names by their exact bytes, the folder's
    // own errors, and a folder swapped while it is walked.
    const c26 = (lines: string[]) => lines.find((line) => /^[A-Z]+ C26 /.test(line));
    const folder = (root: string) => devCaOf(root);
    const onLocal = async (setUp: (root: string) => void, deps: Partial<Deps> = {}) =>
      c26((await local((text) => text, { setUp, deps })).lines);
    const onEnv = async (env: "dev" | "prod", setUp: (root: string) => void, deps: Partial<Deps> = {}) => {
      const s = stack();
      setUp(s.root);
      const result = await preflight(["--env", env, "--compose", s.file], {
        root: s.root,
        run: fakeRun().run,
        ...fakeFs(s.root),
        ...deps,
      });
      return c26(result.lines);
    };
    const made = (root: string) => {
      mkdirSync(folder(root), { mode: 0o700 });
      writeFileSync(join(folder(root), "root.key"), "fixture\n", { mode: 0o400 });
    };
    let seen = "";
    const note = (path: string) => {
      seen = path;
      return path;
    };
    const other = (path: string) => `FAIL C26 dev CA folder holds something other than files and folders: ${path}`;
    // Depth 3: a hard-linked file and a FIFO are judged as at the top.
    const deep = (root: string) => mkdirSync(join(folder(root), "a/b"), { recursive: true, mode: 0o700 });
    const deepLink = (root: string) => {
      deep(root);
      writeFileSync(note(join(folder(root), "a/b/k")), "fixture\n");
      linkSync(seen, join(root, "deployment/ca-copy"));
    };
    expect(await onLocal(deepLink)).toBe(`FAIL C26 dev CA file has extra hard links: ${seen}`);
    const deepFifo = (root: string) => {
      deep(root);
      execFileSync("mkfifo", [note(join(folder(root), "a/b/pipe"))]);
    };
    expect(await onLocal(deepFifo)).toBe(other(seen));
    // A dot name is an entry like any other.
    const dot = (root: string) => linkSync(join(folder(root), "root.key"), note(join(folder(root), ".hidden")));
    expect(await onLocal(dot)).toBe(`FAIL C26 dev CA file has extra hard links: ${seen}`);
    // A socket and a device, through the lstat (mknod needs root): neither is a regular file.
    let at = "";
    const typed = (kind: "isSocket" | "isCharacterDevice" | "isBlockDevice") => (path: string) => {
      const info = fakeFs(at).lstat?.(path) ?? null;
      if (info === null || path !== join(folder(at), "node")) return info;
      return Object.assign(Object.create(Object.getPrototypeOf(info)), info, {
        isFile: () => false,
        isDirectory: () => false,
        isSymbolicLink: () => false,
        [kind]: () => true,
      });
    };
    for (const kind of ["isSocket", "isCharacterDevice", "isBlockDevice"] as const) {
      const node = (root: string) => {
        at = root;
        writeFileSync(note(join(folder(root), "node")), "fixture\n");
      };
      expect(await onLocal(node, { lstat: typed(kind) }), kind).toBe(other(seen));
    }
    // An entry the walk cannot see at depth 2.
    const blind = (hide: (root: string) => string) => (path: string) =>
      path === hide(at) ? null : (fakeFs(at).lstat?.(path) ?? null);
    const unseen = (root: string) => {
      at = root;
      deep(root);
      note(join(folder(root), "a/b"));
    };
    expect(await onLocal(unseen, { lstat: blind((root) => join(folder(root), "a/b")) })).toBe(
      `FAIL C26 dev CA folder entry cannot be read: ${seen}`,
    );
    // N3: the folder's own listing failing is the folder's error, not an entry's.
    const denied = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    const unlisted = await onLocal((root) => note(folder(root)), {
      readdir: (path) => {
        if (path.endsWith("/unset-dev-ca")) throw denied;
        return readdirSync(path, { encoding: "buffer" });
      },
    });
    expect(unlisted).toBe(`FAIL C26 dev CA folder cannot be read: ${seen}`);
    // Dev judges a present folder as local does: a link in its place, and a link inside it.
    const moved = (root: string) => {
      made(root);
      renameSync(folder(root), join(dirname(root), "store-ca"));
      symlinkSync("store-ca", note(folder(root)));
    };
    expect(await onEnv("dev", moved)).toBe(`FAIL C26 dev CA folder is not a real directory: ${seen}`);
    const inside = (root: string) => {
      made(root);
      mkdirSync(join(dirname(root), "outside"));
      symlinkSync(join(dirname(root), "outside"), note(join(folder(root), "out")));
    };
    expect(await onEnv("dev", inside)).toBe(`FAIL C26 dev CA folder holds a link: ${seen}`);
    // A folder lstat cannot see and realpath cannot resolve is there, so neither dev nor prod passes it.
    const realpathDenied = (path: string) => {
      if (path === folder(at)) throw denied;
      return statOrNull(path) === null ? null : realpathSync(path);
    };
    for (const env of ["dev", "prod"] as const) {
      const hidden = (root: string) => {
        at = root;
        made(root);
        note(folder(root));
      };
      expect(await onEnv(env, hidden, { lstat: blind(folder), realpath: realpathDenied }), env).toBe(
        `FAIL C26 dev CA folder cannot be read: ${seen}`,
      );
    }
    // N1: a self-loop link in the folder's place, with the local stack's builds, refuses by the folder's own message.
    const loop = (root: string) => {
      rmSync(folder(root), { recursive: true });
      symlinkSync("unset-dev-ca", note(folder(root)));
    };
    expect(await onLocal(loop)).toBe(`FAIL C26 dev CA folder is not a real directory: ${seen}`);
    // S2: names by their exact bytes. A name that is not UTF-8 is refused before any lstat, alone or beside a clean
    // file under the name the lossy decode would give it (U+FFFD), whether it is a hard-linked key or a link out.
    const bytes = (root: string) => Buffer.concat([Buffer.from(`${folder(root)}/`), Buffer.from([0xff])]);
    // P1.35p N3 (verify-901): the refusal names the entry by its raw bytes, escaped, with its folder.
    const notUtf8 = (path: string) => `FAIL C26 dev CA folder holds a name that is not UTF-8: ${path}/\\xff`;
    const lone = (root: string) => {
      note(folder(root));
      writeFileSync(bytes(root), "fixture\n");
    };
    expect(await onLocal(lone)).toBe(notUtf8(seen));
    const replaced = (root: string) => join(folder(root), "\u{fffd}");
    const beside = (root: string) => {
      note(folder(root));
      writeFileSync(replaced(root), "fixture\n");
      writeFileSync(join(root, "deployment/ca-copy"), "fixture\n");
      linkSync(join(root, "deployment/ca-copy"), bytes(root));
    };
    expect(await onLocal(beside)).toBe(notUtf8(seen));
    const besideLink = (root: string) => {
      note(folder(root));
      writeFileSync(replaced(root), "fixture\n");
      symlinkSync(dirname(root), bytes(root));
    };
    expect(await onLocal(besideLink)).toBe(notUtf8(seen));
    // A valid UTF-8 name holding U+FFFD is judged like any other, and printed escaped.
    const fffd = (root: string) => {
      writeFileSync(join(root, "deployment/ca-copy"), "fixture\n");
      linkSync(join(root, "deployment/ca-copy"), replaced(root));
    };
    expect(await onLocal(fffd)).toMatch(/^FAIL C26 dev CA file has extra hard links: \/.+\/unset-dev-ca\/\\u\{fffd\}$/);
    // A folder swapped for another while it is walked: the walk saw clean entries, but not the folder that stays.
    const swapped = await onLocal((root) => note(folder(root)), {
      readdir: (path) => {
        const names = readdirSync(path, { encoding: "buffer" });
        if (path === seen) {
          renameSync(seen, `${seen}-old`);
          mkdirSync(seen, { mode: 0o700 });
          for (const name of names) writeFileSync(join(seen, name.toString()), "fixture\n");
        }
        return names;
      },
    });
    expect(swapped).toBe(`FAIL C26 dev CA folder changed while it was checked: ${seen}`);
    // P1.35p N2 (verify-901): every folder the walk visits is checked again after it, not only the top one, so a
    // sub-folder swapped and left swapped refuses too. A swap made and reverted entirely within the walk (by the deploy
    // user or root) stays a residual.
    const sub = (root: string) => join(folder(root), "sub");
    const nested = (root: string) => {
      note(sub(root));
      mkdirSync(sub(root), { mode: 0o700 });
      writeFileSync(join(sub(root), "x"), "fixture\n");
    };
    const subSwapped = await onLocal(nested, {
      readdir: (path) => {
        const names = readdirSync(path, { encoding: "buffer" });
        if (path === seen) {
          renameSync(seen, join(dirname(dirname(seen)), "sub-old"));
          mkdirSync(seen, { mode: 0o700 });
          for (const name of names) writeFileSync(join(seen, name.toString()), "fixture\n");
        }
        return names;
      },
    });
    expect(subSwapped).toBe(`FAIL C26 dev CA folder changed while it was checked: ${seen}`);
    expect(await onLocal(nested)).toBe("PASS C26 ok");
  });

  test("preflight_prints_names_escaped", async () => {
    // P1.35m (architecture 2026-10-15 02:08Z, N2; SE-7): a name is the deploy user's text, and a person reads the
    // lines. A newline cannot forge a PASS line, and a carriage return and an erase cannot hide a FAIL on a terminal.
    for (const name of ["x\nPASS C26 ok", "x\r\x1b[2K"]) {
      let path = "";
      const { lines } = await local((text) => text, {
        setUp: (root) => {
          path = join(devCaOf(root), name);
          writeFileSync(join(root, "deployment/ca-copy"), "fixture\n");
          linkSync(join(root, "deployment/ca-copy"), path);
        },
      });
      expect(lines.filter((line) => /C26/.test(line))).toEqual([
        `FAIL C26 dev CA file has extra hard links: ${printable(path)}`,
      ]);
      expect(lines.every((line) => /^[\x20-\x7e]*$/.test(line))).toBe(true);
    }
    expect(printable("a\\b\x00\x1f\x7f\x80\x9f\xa0\u{fffd}\u{1f600}\ud800 é")).toBe(
      "a\\\\b\\x00\\x1f\\x7f\\x80\\x9f\\xa0\\u{fffd}\\u{1f600}\\u{d800} \\xe9",
    );
  });

  test("local_c17_unlisted_plc_network_fails", async () => {
    // Architecture 2026-10-15 02:32Z: under local, C17 expects networks.dev.json plus the local-only list, both ways.
    const { lines } = await local((text) =>
      text
        .replace("    networks: [back]", "    networks: [back, plc_web]")
        .replace("  back: {}", "  back: {}\n  plc_web:\n    internal: true"),
    );
    expect(lines.find((line) => / C17 /.test(line))).toBe("FAIL C17 network plc_web is not in the table");
    // Nor may the table admit it: networks.dev.json gets no local-only rows, under any env (verify-903 S3).
    const listed = { ...TABLE, plc_web: { internal: true, members: ["web"] } };
    const admitted = await local(
      (text) =>
        text
          .replace("    networks: [back]", "    networks: [back, plc_web]")
          .replace("  back: {}", "  back: {}\n  plc_web:\n    internal: true"),
      { networks: listed },
    );
    expect(admitted.lines.find((line) => / C17 /.test(line))).toBe(
      "FAIL C17 the network table lists plc_web, a local-only network",
    );
    const prod = await check({ networks: listed });
    expect(prod.lines.find((line) => / C17 /.test(line))).toBe(
      "FAIL C17 the network table lists plc_web, a local-only network",
    );
  });

  test("local_c17_runs_the_pds_neighbour_rule", async () => {
    // C17 judges the PDS's neighbours under local too (#742 item 11), even where the table admits one. The retired PLC
    // case calls pdsNeighbours directly (ADR 0022), so this is the case that reaches it through C17 (verify-903-2f7413d).
    const admitted = { ...TABLE, default: { internal: false, members: ["edge", "pds", "web"] } };
    const { lines } = await local((text) => text.replace("    networks: [back]", "    networks: [back, default]"), {
      networks: admitted,
    });
    expect(lines.find((line) => / C17 /.test(line))).toBe("FAIL C17 web shares a network with the pds");
  });

  test("local_c26_dev_trust_folder_holds_only_root_pem", async () => {
    // P1.33g (record 2026-10-12-p134c-p134d-local-dev-root-ca, "Architecture confirmation", condition 1): the folder
    // pds and web bind is a real directory holding exactly root.pem, a regular file with one link that no group or
    // other user can write. Every error refuses, naming the path.
    const c26 = (lines: string[]) => lines.find((line) => /^[A-Z]+ C26 /.test(line));
    const onLocal = async (setUp: (root: string) => void, options: { devRoot?: null; deps?: Partial<Deps> } = {}) =>
      c26((await local((text) => text, { setUp, ...options })).lines);
    const trust = (root: string) => join(dirname(root), "unset-dev-trust");
    let seen = "";
    const note = (path: string) => {
      seen = path;
      return path;
    };
    expect(await onLocal(() => undefined)).toBe("PASS C26 ok");
    expect(await onLocal(() => undefined, { devRoot: null })).toBe("FAIL C26 input missing: unset-dev-trust");
    const empty = (root: string) => rmSync(join(trust(root), "root.pem"));
    expect(await onLocal(empty)).toBe("FAIL C26 input missing: unset-dev-trust/root.pem");
    const extra = (root: string) => writeFileSync(note(join(trust(root), "extra.pem")), "fixture\n");
    expect(await onLocal(extra)).toBe(`FAIL C26 dev trust folder holds something other than root.pem: ${seen}`);
    // P1.35p N3 (verify-901): a name that is not UTF-8 is named by its raw bytes, escaped, as in the dev CA folder.
    const raw = (root: string) =>
      writeFileSync(Buffer.concat([Buffer.from(`${note(trust(root))}/`), Buffer.from([0x61, 0xff])]), "fixture\n");
    expect(await onLocal(raw)).toBe(`FAIL C26 dev trust folder holds something other than root.pem: ${seen}/a\\xff`);
    const linked = (root: string) => linkSync(note(join(trust(root), "root.pem")), join(root, "deployment/trust-copy"));
    expect(await onLocal(linked)).toBe(`FAIL C26 dev trust root has extra hard links: ${seen}`);
    for (const mode of [0o664, 0o646]) {
      const writable = (root: string) => chmodSync(note(join(trust(root), "root.pem")), mode);
      expect(await onLocal(writable), mode.toString(8)).toBe(
        `FAIL C26 dev trust root is writable by group or other: ${seen}`,
      );
    }
    const pointed = (root: string) => {
      renameSync(join(trust(root), "root.pem"), join(dirname(root), "elsewhere.pem"));
      symlinkSync(join(dirname(root), "elsewhere.pem"), note(join(trust(root), "root.pem")));
    };
    expect(await onLocal(pointed)).toBe(`FAIL C26 dev trust root is not a regular file: ${seen}`);
    const moved = (root: string) => {
      renameSync(trust(root), join(dirname(root), "store-trust"));
      symlinkSync("store-trust", note(trust(root)));
    };
    expect(await onLocal(moved)).toBe(`FAIL C26 dev trust folder is not a real directory: ${seen}`);
    const denied = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    const unlisted = await onLocal((root) => note(trust(root)), {
      deps: {
        readdir: (path) => {
          if (path.endsWith("/unset-dev-trust")) throw denied;
          return readdirSync(path, { encoding: "buffer" });
        },
      },
    });
    expect(unlisted).toBe(`FAIL C26 dev trust folder cannot be read: ${seen}`);
    // The fixture's own lstat for every path but the one it cannot see: there, but unreadable, so never absent.
    let at = "";
    const blind = (hide: (root: string) => string) => (path: string) =>
      path === hide(at) ? null : (fakeFs(at).lstat?.(path) ?? null);
    const unseen = async (hide: (root: string) => string) =>
      onLocal(
        (root) => {
          at = root;
          note(hide(root));
        },
        { deps: { lstat: blind(hide) } },
      );
    expect(await unseen(trust)).toBe(`FAIL C26 dev trust folder cannot be read: ${seen}`);
    expect(await unseen((root) => join(trust(root), "root.pem"))).toBe(
      `FAIL C26 dev trust root cannot be read: ${seen}`,
    );
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
      // Newt runs only under dev (P1.37v); a local stack has no tunnel, so its image may not stand in for a service.
      exact("newt"),
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

  test("local_c2_admits_the_node_base_on_the_token_reader_only", async () => {
    // Architecture record 2026-10-13-p127l-local-gaps, Amendment 2 point 2(b) and Amendment 4: the node runtime base
    // runs unbuilt only as pds-token-reader, with no network and only in the tools profile, by exact ref:tag@digest.
    const node = (JSON.parse(BASES) as Record<string, { ref: string; tag: string; digest: string }>).node as {
      ref: string;
      tag: string;
      digest: string;
    };
    const NODE = `${node.ref}:${node.tag}@${node.digest}`;
    const reader = (image: string, lines: string) =>
      `  pds-token-reader:\n    image: ${image}\n${lines}    logging:\n      driver: none\nsecrets:`;
    const TOOLS = "    profiles: [tools]\n    network_mode: none\n";
    const c2 = async (edit: (text: string) => string) => (await local(edit)).lines.find((line) => / C2 /.test(line));
    expect(await c2((text) => text.replace("secrets:\n  db_password", `${reader(NODE, TOOLS)}\n  db_password`))).toBe(
      "PASS C2 ok",
    );
    const refused: [string, (text: string) => string][] = [
      ["FAIL C2 pds runs the node base, which only pds-token-reader may", (text) => text.replace(LOCKED_PDS, NODE)],
      [
        "FAIL C2 pds-token-reader runs the node base outside the tools profile",
        (text) => text.replace("secrets:\n  db_password", `${reader(NODE, "    network_mode: none\n")}\n  db_password`),
      ],
      [
        "FAIL C2 pds-token-reader runs the node base with a network",
        (text) => text.replace("secrets:\n  db_password", `${reader(NODE, "")}\n  db_password`),
      ],
      [
        "FAIL C2 pds-token-reader image is not a run-only vendor image by tag and digest",
        (text) => text.replace("secrets:\n  db_password", `${reader(`${node.ref}:${node.tag}`, TOOLS)}\n  db_password`),
      ],
      // verify-851 S1: any other digest, digest with no tag, and another *-reader service are all refused.
      [
        "FAIL C2 pds-token-reader image is not a run-only vendor image by tag and digest",
        (text) =>
          text.replace(
            "secrets:\n  db_password",
            `${reader(`${node.ref}:${node.tag}@sha256:${"0".repeat(64)}`, TOOLS)}\n  db_password`,
          ),
      ],
      [
        "FAIL C2 pds-token-reader image is not a run-only vendor image by tag and digest",
        (text) =>
          text.replace("secrets:\n  db_password", `${reader(`${node.ref}@${node.digest}`, TOOLS)}\n  db_password`),
      ],
      [
        "FAIL C2 token-reader runs the node base, which only pds-token-reader may",
        (text) =>
          text.replace(
            "secrets:\n  db_password",
            `  token-reader:\n    image: ${NODE}\n${TOOLS}secrets:\n  db_password`,
          ),
      ],
    ];
    for (const [line, edit] of refused) expect(await c2(edit), line).toBe(line);
    // Only the runtime entry: a node builder stage in the lock is never run unbuilt, even as the reader.
    const builder = BASES.replace(
      '"stage": "runtime",\n    "buildStage": true',
      '"stage": "build",\n    "buildStage": true',
    );
    expect(builder).not.toBe(BASES);
    const asBuilder = await local(
      (text) => text.replace("secrets:\n  db_password", `${reader(NODE, TOOLS)}\n  db_password`),
      {
        files: { "deployment/images/bases.lock.json": builder },
      },
    );
    expect(asBuilder.lines.find((line) => / C2 /.test(line))).toBe(
      "FAIL C2 pds-token-reader image is not a run-only vendor image by tag and digest",
    );
  });

  test("local_c18_refuses_the_dev_mount", async () => {
    // P1.36c: the local edge takes neither the dev (tls) nor a dev site.
    const c18 = async (edit: (text: string) => string) => (await local(edit)).lines.find((line) => / C18 /.test(line));
    expect(await c18((text) => text)).toBe("PASS C18 ok");
    expect(await c18((text) => text.replace("./edge/local/tls.caddy:", "./edge/dev/tls.caddy:"))).toBe(
      "FAIL C18 the TLS snippet is not deployment/edge/local/tls.caddy",
    );
    expect(await c18((text) => text.replace("./edge/sites/pds.caddy:", "./edge/dev/pds.caddy:"))).toBe(
      "FAIL C18 the edge config is unreadable: pds.caddy: not mounted from sites/pds.caddy",
    );
  });

  test("local_c18_app_host_is_the_web_origins_host", async () => {
    // P1.33x (record 2026-10-12-p134c-p134d-local-dev-root-ca, Amendment 3): a missing or stale APP_HOST gives the edge
    // the wrong alias, so it must be a hostname and exactly the host of web's PUBLIC_ORIGIN. Reasons are fixed words.
    const c18 = async (edit: (text: string) => string) => (await local(edit)).lines.find((line) => / C18 /.test(line));
    expect(await c18((text) => text)).toBe("PASS C18 ok");
    const appHost = "      APP_HOST: app.localhost\n";
    const origin = "      PUBLIC_ORIGIN: https://app.localhost\n";
    const cases: [string, (text: string) => string][] = [
      ["FAIL C18 APP_HOST is missing", (text) => text.replace(appHost, "")],
      ["FAIL C18 APP_HOST is missing", (text) => text.replace(appHost, '      APP_HOST: ""\n')],
      ["FAIL C18 APP_HOST is not a hostname", (text) => text.replace(appHost, "      APP_HOST: app_localhost\n")],
      ["FAIL C18 APP_HOST is not a hostname", (text) => text.replace(appHost, "      APP_HOST: app.localhost:443\n")],
      [
        "FAIL C18 APP_HOST is not the host of web's PUBLIC_ORIGIN",
        (text) => text.replace(origin, "      PUBLIC_ORIGIN: https://old.localhost\n"),
      ],
      [
        "FAIL C18 APP_HOST is not the host of web's PUBLIC_ORIGIN",
        (text) => text.replace(origin, "      PUBLIC_ORIGIN: https://app.localhost.example.test\n"),
      ],
      // verify-869 S3: the host must equal APP_HOST, never merely end with it.
      [
        "FAIL C18 APP_HOST is not the host of web's PUBLIC_ORIGIN",
        (text) => text.replace(origin, "      PUBLIC_ORIGIN: https://old-app.localhost\n"),
      ],
      [
        "FAIL C18 APP_HOST is not the host of web's PUBLIC_ORIGIN",
        (text) => text.replace(origin, "      PUBLIC_ORIGIN: https://x.app.localhost\n"),
      ],
      // verify-869 S1 and S3: an IPv4 address (with an origin to match), uppercase and a trailing dot.
      [
        "FAIL C18 APP_HOST is not a hostname",
        (text) =>
          text
            .replace(appHost, "      APP_HOST: 192.0.2.1\n")
            .replace(origin, "      PUBLIC_ORIGIN: https://192.0.2.1\n"),
      ],
      ["FAIL C18 APP_HOST is not a hostname", (text) => text.replace(appHost, "      APP_HOST: APP.localhost\n")],
      ["FAIL C18 APP_HOST is not a hostname", (text) => text.replace(appHost, "      APP_HOST: app.localhost.\n")],
      ["FAIL C18 web's PUBLIC_ORIGIN is not a URL", (text) => text.replace(`    environment:\n${origin}`, "")],
      [
        "FAIL C18 web's PUBLIC_ORIGIN is not a URL",
        (text) => text.replace(origin, "      PUBLIC_ORIGIN: app.localhost\n"),
      ],
    ];
    for (const [line, edit] of cases) expect(await c18(edit), line).toBe(line);
    // P1.35p (architecture 04:03Z, "APP_HOST value under local"): APP_HOST is a proper name under .localhost, which the
    // dev root constrains, never PDS_HOST and never an address. Web's origin moves with it, so only this rule refuses.
    const both = (value: string) => (text: string) =>
      text
        .replace(appHost, `      APP_HOST: "${value}"\n`)
        .replace(origin, `      PUBLIC_ORIGIN: "https://${value}"\n`);
    const under = "FAIL C18 APP_HOST is not a name under .localhost";
    const values: [string, string][] = [
      [under, "app.example.com"],
      // ".localhost" is matched by whole labels (SE-7a): app.notlocalhost ends in "localhost", not in ".localhost".
      [under, "app.notlocalhost"],
      ["FAIL C18 APP_HOST is not a hostname", "localhost"],
      ["FAIL C18 APP_HOST is not a hostname", "127.0.0.1"],
      ["FAIL C18 APP_HOST is not a hostname", "[::1]"],
      ["FAIL C18 APP_HOST is PDS_HOST", "pds.localhost"],
    ];
    for (const [line, value] of values) expect(await c18(both(value)), value).toBe(line);
  });

  test("local_c18_pds_host_is_the_pds_hostname", async () => {
    // P1.35g (verify-876 S1, architecture ~00:27Z): under local nothing else ties the edge's PDS_HOST to the PDS's own
    // name (C21 is skipped), so PDS_HOST is a hostname, never an IPv4 address, and equals PDS_HOSTNAME once both are
    // lower case with no trailing dot and no port. Reasons name the variables and never echo a value.
    const c18 = async (edit: (text: string) => string, leaf?: string) =>
      (await local(edit, leaf === undefined ? {} : { leaf })).lines.find((line) => / C18 /.test(line));
    const pdsHost = "      PDS_HOST: pds.localhost\n";
    const hostname = "      PDS_HOSTNAME: pds.localhost\n";
    const named = (value: string) => (text: string) => text.replace(hostname, `      PDS_HOSTNAME: ${value}\n`);
    expect(await c18((text) => text)).toBe("PASS C18 ok");
    for (const value of ["PDS.localhost", "pds.localhost.", "pds.localhost:2583", '"PDS.Localhost.:443"']) {
      expect(await c18(named(value)), value).toBe("PASS C18 ok");
    }
    const cases: [string, (text: string) => string, string?][] = [
      ["FAIL C18 PDS_HOST is not the pds service's PDS_HOSTNAME", named("other.localhost")],
      ["FAIL C18 PDS_HOST is not the pds service's PDS_HOSTNAME", named("x.pds.localhost")],
      [
        "FAIL C18 input missing: the pds service's PDS_HOSTNAME",
        (text) => text.replace(`    environment:\n${hostname}`, ""),
      ],
      ["FAIL C18 input missing: the edge's PDS_HOST", (text) => text.replace(pdsHost, "")],
      // verify-888 N6: an empty value is as missing as an absent one.
      ["FAIL C18 input missing: the edge's PDS_HOST", (text) => text.replace(pdsHost, '      PDS_HOST: ""\n')],
      ["FAIL C18 input missing: the pds service's PDS_HOSTNAME", named('""')],
      // verify-888 N4: each red on the mismatch alone, killing normalHost's mutants P15, P16 and P18.
      ["FAIL C18 PDS_HOST is not the pds service's PDS_HOSTNAME", named('"pds.localhost:abc"')],
      ["FAIL C18 PDS_HOST is not the pds service's PDS_HOSTNAME", named("pds.localhost..")],
      ["FAIL C18 PDS_HOST is not the pds service's PDS_HOSTNAME", named('" pds.localhost"')],
      ["FAIL C18 PDS_HOSTNAME is an IP address", named("192.0.2.2")],
      ["FAIL C18 PDS_HOST is not a hostname", (text) => text.replace(pdsHost, "      PDS_HOST: pds_localhost\n")],
      // The IPv4 red fixture: a leaf naming the address and an edge serving it, with the PDS named the same.
      [
        "FAIL C18 PDS_HOST is not a hostname",
        (text) => named("192.0.2.2")(text.replace(pdsHost, "      PDS_HOST: 192.0.2.2\n")),
        leafPem("DNS:app.localhost,DNS:192.0.2.2"),
      ],
    ];
    for (const [line, edit, leaf] of cases) expect(await c18(edit, leaf), line).toBe(line);
  });

  test("local_c18_judges_the_leaf_copy", async () => {
    // P1.33x (record 2026-10-12-p134c-p134d-local-dev-root-ca, Amendment 2 and the 2026-10-14 ruling): the public copy
    // of the leaf names exactly APP_HOST and PDS_HOST, no IP, is no CA, comes from the dev root and has 14 days left.
    const c18 = async (options: { leaf?: string | null; devRoot?: string | null }) =>
      (await local((text) => text, options)).lines.find((line) => / C18 /.test(line));
    expect(await c18({})).toBe("PASS C18 ok");
    // The order of the names does not matter.
    expect(await c18({ leaf: leafPem("DNS:pds.localhost,DNS:app.localhost") })).toBe("PASS C18 ok");
    expect(await c18({ leaf: null })).toMatch(/^FAIL C18 input missing: unset-dev-env\/local-leaf\.pem$/);
    expect(await c18({ devRoot: null })).toMatch(/^FAIL C18 input missing: unset-dev-trust\/root\.pem$/);
    const names = "FAIL C18 the local leaf's names are not exactly APP_HOST and PDS_HOST";
    const cases: [string, { leaf?: string; devRoot?: string }][] = [
      // An unrelated DNS leaf, a leaf missing one host, one with a third, and a CN-only leaf with no SAN at all.
      [names, { leaf: leafPem("DNS:other.localhost,DNS:pds.localhost") }],
      [names, { leaf: leafPem("DNS:app.localhost") }],
      [names, { leaf: leafPem("DNS:app.localhost,DNS:pds.localhost,DNS:x.app.localhost") }],
      [names, { leaf: leafPem(null) }],
      [names, { leaf: leafPem("DNS:app.localhost,email:a@example.test") }],
      // IP names, alone or beside the two hosts.
      ["FAIL C18 the local leaf has an IP name", { leaf: leafPem("IP:127.0.0.1") }],
      ["FAIL C18 the local leaf has an IP name", { leaf: leafPem("DNS:app.localhost,DNS:pds.localhost,IP:::1") }],
      // A sub-CA, and a leaf from another root.
      ["FAIL C18 the local leaf is a CA", { leaf: leafPem("DNS:app.localhost,DNS:pds.localhost", { ca: true }) }],
      [
        "FAIL C18 the local leaf is not issued by the dev root",
        { leaf: LEAF, devRoot: leafPem("DNS:app.localhost,DNS:pds.localhost", { ca: true }) },
      ],
      [
        "FAIL C18 the local leaf is not issued by the dev root",
        { leaf: leafPem("DNS:app.localhost,DNS:pds.localhost", { akid: false }), devRoot: SAME_NAME_ROOT },
      ],
      ["FAIL C18 the local leaf is not issued by the dev root", { devRoot: SAME_KEY_ROOT }],
      [
        "FAIL C18 the local leaf expires within 14 days",
        { leaf: leafPem("DNS:app.localhost,DNS:pds.localhost", { days: 13 }) },
      ],
      ["FAIL C18 the local leaf copy is not one certificate", { leaf: `${LEAF}${LEAF}` }],
      ["FAIL C18 the local leaf copy is not one certificate", { leaf: readFileSync(join(pki, "root.key"), "utf8") }],
      ["FAIL C18 the dev root is not one certificate", { devRoot: "" }],
      // verify-869 S3: names the DNS pattern refuses, and a PEM with anything after it or CRLF line ends.
      [names, { leaf: leafPem("DNS:*.localhost,DNS:pds.localhost") }],
      [names, { leaf: leafPem("DNS:APP.localhost,DNS:pds.localhost") }],
      [names, { leaf: leafPem("DNS:app.localhost.,DNS:pds.localhost") }],
      ["FAIL C18 the local leaf copy is not one certificate", { leaf: `${LEAF}junk\n` }],
      ["FAIL C18 the local leaf copy is not one certificate", { leaf: LEAF.replace(/\n/g, "\r\n") }],
      // verify-869 S2: both ends of the one link are inside their dates, and the margin is 14 days, not 13.
      ["FAIL C18 the local leaf is not yet valid", { leaf: datedPem("leaf", 1, 60) }],
      ["FAIL C18 the local leaf expires within 14 days", { leaf: datedPem("leaf", -1, 13.5) }],
      ["FAIL C18 the dev root has expired", { devRoot: datedPem("root", -60, -1) }],
      ["FAIL C18 the dev root is not yet valid", { devRoot: datedPem("root", 1, 60) }],
      // verify-876 N4: text before the certificate, and the certificate followed by its key.
      ["FAIL C18 the local leaf copy is not one certificate", { leaf: `note\n${LEAF}` }],
      [
        "FAIL C18 the local leaf copy is not one certificate",
        { leaf: `${LEAF}${readFileSync(join(pki, "leaf0.key"), "utf8")}` },
      ],
    ];
    for (const [line, options] of cases) expect(await c18(options), line).toBe(line);
    // Fifteen days left passes, and so does an hour past fourteen: the margin is exactly 14 days (verify-876 N2).
    expect(await c18({ leaf: leafPem("DNS:app.localhost,DNS:pds.localhost", { days: 15 }) })).toBe("PASS C18 ok");
    expect(await c18({ leaf: datedPem("leaf", -1, 14 + 1 / 24) })).toBe("PASS C18 ok");
  });

  test("local_c18_dev_root_is_the_cas_constrained_root", async () => {
    // P1.33g (record 2026-10-12-p134c-p134d-local-dev-root-ca, "Architecture confirmation", conditions 2 and 3): the
    // copy pds and web trust is the dev CA's own root, byte for byte, holds no key, is a CA, and carries the runbook's
    // name constraints: the two local hosts permitted and every IPv4 and IPv6 address excluded.
    const c18 = async (options: { leaf?: string; devRoot?: string; caRoot?: string | null }) =>
      (await local((text) => text, options)).lines.find((line) => / C18 /.test(line));
    const rootWith = (name: string, extensions: string[]) => {
      openssl(
        ...`req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -keyout ${name}.key -out ${name}.pem`.split(
          " ",
        ),
        ...["-days", "30", "-subj", "/CN=throwaway root", ...extensions.flatMap((e) => ["-addext", e])],
      );
      return {
        devRoot: readFileSync(join(pki, `${name}.pem`), "utf8"),
        leaf: leafPem("DNS:app.localhost,DNS:pds.localhost", { issuer: name }),
      };
    };
    const CA = ["basicConstraints=critical,CA:TRUE,pathlen:0", "keyUsage=critical,keyCertSign,cRLSign"];
    const EXCLUDED = "excluded;IP:0.0.0.0/0.0.0.0,excluded;IP:::/::";
    const swapped = `permitted;DNS:pds.localhost,permitted;DNS:app.localhost,${EXCLUDED}`;
    expect(await c18(rootWith("swapped", [...CA, `nameConstraints=critical,${swapped}`]))).toBe("PASS C18 ok");
    const copy =
      "FAIL C18 the dev root copy is not the dev CA's root: unset-dev-trust/root.pem and unset-dev-ca/root.pem";
    expect(await c18({ caRoot: SAME_KEY_ROOT })).toBe(copy);
    expect(await c18({ caRoot: `${DEV_ROOT}\n` })).toBe(copy);
    expect(await c18({ caRoot: null })).toBe("FAIL C18 input missing: unset-dev-ca/root.pem");
    const key = readFileSync(join(pki, "root.key"), "utf8");
    expect(await c18({ devRoot: `${DEV_ROOT}${key}` })).toBe("FAIL C18 the dev root copy holds a private key");
    expect(await c18({ devRoot: `${key}${DEV_ROOT}` })).toBe("FAIL C18 the dev root copy holds a private key");
    const notCa = rootWith("not-ca", [
      "basicConstraints=critical,CA:FALSE",
      `nameConstraints=critical,${LOCAL_CONSTRAINTS}`,
    ]);
    expect(await c18(notCa)).toBe("FAIL C18 the dev root is not a CA");
    const unconstrained = "FAIL C18 the dev root does not carry the local name constraints";
    const roots: [string, string[]][] = [
      ["none", CA],
      ["one-host", [...CA, `nameConstraints=critical,permitted;DNS:app.localhost,${EXCLUDED}`]],
      ["third-host", [...CA, `nameConstraints=critical,${LOCAL_CONSTRAINTS},permitted;DNS:x.localhost`]],
      ["ip-open", [...CA, "nameConstraints=critical,permitted;DNS:app.localhost,permitted;DNS:pds.localhost"]],
      [
        "v4-only",
        [
          ...CA,
          "nameConstraints=critical,permitted;DNS:app.localhost,permitted;DNS:pds.localhost,excluded;IP:0.0.0.0/0.0.0.0",
        ],
      ],
      ["not-critical", [...CA, `nameConstraints=${LOCAL_CONSTRAINTS}`]],
    ];
    for (const [name, extensions] of roots) expect(await c18(rootWith(name, extensions)), name).toBe(unconstrained);

    // P1.35p N3 (verify-896): basicConstraints critical with cA true and pathlen 0, keyUsage critical with exactly
    // keyCertSign and cRLSign, as the runbook's recipe makes them. Each of these passed on main.
    const NC = `nameConstraints=critical,${LOCAL_CONSTRAINTS}`;
    const KU = "keyUsage=critical,keyCertSign,cRLSign";
    const basic = "FAIL C18 the dev root's basic constraints are not critical CA:TRUE, pathlen:0";
    const usage = "FAIL C18 the dev root's key usage is not critical keyCertSign and cRLSign";
    const loose: [string, string[], string][] = [
      ["no-pathlen", ["basicConstraints=critical,CA:TRUE", KU, NC], basic],
      ["pathlen-1", ["basicConstraints=critical,CA:TRUE,pathlen:1", KU, NC], basic],
      ["basic-not-critical", ["basicConstraints=CA:TRUE,pathlen:0", KU, NC], basic],
      ["digital-signature", [CA[0] as string, `${KU},digitalSignature`, NC], usage],
      ["usage-not-critical", [CA[0] as string, "keyUsage=keyCertSign,cRLSign", NC], usage],
    ];
    for (const [name, extensions, line] of loose) expect(await c18(rootWith(name, extensions)), name).toBe(line);
  });

  test("local_c18_walks_the_dev_root_as_der", async () => {
    // P1.35p S1 (verify-896): the name constraints are found by a strict DER walk of the root's own PEM bytes, not a
    // byte search of node:crypto's re-encoding. Each root below keeps the dev root's key and name, so the leaf still
    // verifies; only its extensions or its encoding change, and none is signed anew, since C18 checks the leaf's
    // signature with the root's key and never the root's own.
    const c18 = async (devRoot: string) =>
      (await local((text) => text, { devRoot })).lines.find((line) => / C18 /.test(line));
    const pemBytes = (pem: string) => Buffer.from(pem.replace(/-----[A-Z ]+-----|\n/g, ""), "base64");
    const pem = (bytes: Buffer) =>
      `-----BEGIN CERTIFICATE-----\n${bytes
        .toString("base64")
        .match(/.{1,64}/g)
        ?.join("\n")}\n-----END CERTIFICATE-----\n`;
    const [certificate] = children(pemBytes(DEV_ROOT));
    const [tbs, algorithm, signature] = children((certificate as Tlv).value) as [Tlv, Tlv, Tlv];
    const fields = children(tbs.value);
    const list = children((children((fields.at(-1) as Tlv).value)[0] as Tlv).value).map((tlv) => tlv.bytes);
    const isNameConstraints = (ext: Buffer) =>
      (children(children(ext)[0]?.value as Buffer)[0] as Tlv).value.toString("hex") === "551d1e";
    const constraints = list.find(isNameConstraints) as Buffer;
    /** The dev root with its extension list edited, and its outer SEQUENCE written by `outer`. */
    const rebuilt = (edit: (ext: Buffer[]) => Buffer[], outer = (body: Buffer) => der(0x30, body)) => {
      const extensions = der(0xa3, der(0x30, ...edit(list)));
      const body = der(0x30, ...fields.slice(0, -1).map((field) => field.bytes), extensions);
      return pem(outer(Buffer.concat([body, algorithm.bytes, signature.bytes])));
    };
    expect(await c18(rebuilt((ext) => ext))).toBe("PASS C18 ok");
    // Base64 with stray bits in its last character decodes the same in OpenSSL and Buffer, but only canonical text is
    // walked, so the bytes C18 judges are exactly the text.
    // An unknown, non-critical extension of 0 to 2 octets sets the length so the base64 always ends in padding.
    const padded = [0, 1, 2]
      .map((n) =>
        rebuilt((ext) => [...ext, der(0x30, der(0x06, Buffer.from([0x2a, 0x03, 0x05])), der(0x04, Buffer.alloc(n)))]),
      )
      .find((text) => /=\n-----END/.test(text)) as string;
    const stray = padded.replace(/([A-Za-z0-9+/])(=+\n-----END)/, (_, last: string, end: string) => {
      const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
      return `${alphabet[alphabet.indexOf(last) ^ 1]}${end}`;
    });
    expect(await c18(padded)).toBe("PASS C18 ok");
    expect(await c18(stray)).toBe("FAIL C18 the dev root is not one certificate");
    const notDer = "FAIL C18 the dev root is not DER";
    const unconstrained = "FAIL C18 the dev root does not carry the local name constraints";
    // The expected extension's bytes hidden inside another extension (OID 1.2.3.4), which a byte search finds.
    const hidden = der(0x30, der(0x06, Buffer.from([0x2a, 0x03, 0x04])), der(0x04, constraints));
    expect(await c18(rebuilt((ext) => ext.map((e) => (e === constraints ? hidden : e))))).toBe(unconstrained);
    expect(await c18(rebuilt((ext) => [...ext, constraints]))).toBe("FAIL C18 the dev root repeats an extension");
    // A long-form length where the short form fits: the whole certificate's (node:crypto's raw re-encodes it, so the
    // byte search passed), and the name constraints extension's own.
    const long = (body: Buffer) =>
      Buffer.concat([Buffer.from([0x30, 0x83, 0, body.length >> 8, body.length & 0xff]), body]);
    expect(await c18(rebuilt((ext) => ext, long))).toBe(notDer);
    const longExtension = Buffer.concat([Buffer.from([0x30, 0x81]), constraints.subarray(1)]);
    expect(await c18(rebuilt((ext) => ext.map((e) => (e === constraints ? longExtension : e))))).toBe(notDer);
    // An extra permitted subtree, and trailing bytes after the expected value inside its OCTET STRING.
    const [oid, flag, value] = children((children(constraints)[0] as Tlv).value) as [Tlv, Tlv, Tlv];
    const withValue = (bytes: Buffer) => der(0x30, oid.bytes, flag.bytes, der(0x04, bytes));
    const trailing = withValue(Buffer.concat([value.value, Buffer.from([0x05, 0x00])]));
    expect(await c18(rebuilt((ext) => ext.map((e) => (e === constraints ? trailing : e))))).toBe(unconstrained);
    const [subtrees] = children(value.value) as [Tlv];
    const [permitted, excluded] = children(subtrees.value) as [Tlv, Tlv];
    const third = der(0x30, der(0x82, Buffer.from("x.localhost", "ascii")));
    const wider = withValue(der(0x30, der(0xa0, permitted.value, third), excluded.bytes));
    expect(await c18(rebuilt((ext) => ext.map((e) => (e === constraints ? wider : e))))).toBe(unconstrained);
  });

  test("local_c18_reads_each_root_only_as_a_regular_file", async () => {
    // P1.35p S2 (verify-896): a FIFO with no writer at either root path blocked a plain read for ever, so the run never
    // ended. Each is read the way env files are (regular-file.ts) and refused at once, naming the path.
    const fifo = (path: string) => {
      mkdirSync(dirname(path), { recursive: true });
      execFileSync("mkfifo", ["-m", "0644", path]);
    };
    const c18 = async (options: Parameters<typeof local>[1]) =>
      (await local((text) => text, options)).lines.find((line) => / C18 /.test(line));
    expect(await c18({ devRoot: null, setUp: (root) => fifo(join(dirname(root), "unset-dev-trust/root.pem")) })).toBe(
      "FAIL C18 unset-dev-trust/root.pem is not a regular file",
    );
    expect(await c18({ caRoot: null, setUp: (root) => fifo(join(devCaOf(root), "root.pem")) })).toBe(
      "FAIL C18 unset-dev-ca/root.pem is not a regular file",
    );
    expect(await c18({ leaf: null, setUp: (root) => fifo(join(envOf(root), "local-leaf.pem")) })).toBe(
      "FAIL C18 unset-dev-env/local-leaf.pem is not a regular file",
    );
  });

  test("local_c9_dev_trust_folder_owner_and_mode", async () => {
    // P1.35p N4/N5 (verify-896): the folder pds and web read the dev root from, and its root.pem, belong to the deploy
    // user or root; no group or other user can write the folder, and root.pem is exactly 0444 or 0644, so the services
    // can read it and nobody else can change it. C26 keeps judging the folder's shape and C18 what root.pem holds.
    const trust = (root: string) => join(dirname(root), "unset-dev-trust");
    const c9Line = async (options: Parameters<typeof local>[1]) =>
      (await local((text) => text, options)).lines.find((line) => / C9 /.test(line));
    expect(await c9Line({})).toMatch(/^PASS C9 /);
    expect(await c9Line({ setUp: (root) => chmodSync(join(trust(root), "root.pem"), 0o444) })).toMatch(/^PASS C9 /);
    expect(await c9Line({ owners: (root) => ({ [trust(root)]: 0, [join(trust(root), "root.pem")]: 0 }) })).toMatch(
      /^PASS C9 /,
    );
    const folder = /^FAIL C9 dev trust folder can be changed by another user: \/.+\/unset-dev-trust$/;
    expect(await c9Line({ setUp: (root) => chmodSync(trust(root), 0o777) })).toMatch(folder);
    expect(await c9Line({ setUp: (root) => chmodSync(trust(root), 0o775) })).toMatch(folder);
    expect(await c9Line({ owners: (root) => ({ [trust(root)]: 4242 }) })).toMatch(folder);
    const mode = /^FAIL C9 dev trust root must have mode 0444 or 0644: \/.+\/unset-dev-trust\/root\.pem$/;
    expect(await c9Line({ setUp: (root) => chmodSync(join(trust(root), "root.pem"), 0o600) })).toMatch(mode);
    expect(await c9Line({ setUp: (root) => chmodSync(join(trust(root), "root.pem"), 0o664) })).toMatch(mode);
    expect(await c9Line({ owners: (root) => ({ [join(trust(root), "root.pem")]: 4242 }) })).toMatch(
      /^FAIL C9 dev trust root is not owned by the deploy user or root: \/.+\/root\.pem$/,
    );
  });

  test("dev_trust_folder_rules_name_every_env", async () => {
    // P1.35p N9 (verify-896; the P1.34z pattern): only local judges the trust folder, dev and prod are named, and any
    // other env is refused rather than skipped, in C9 and C26 alike.
    const { root } = await local();
    const argv = ["--env", "local", "--compose", join(root, "deployment/compose.yaml")];
    const { inputs } = loadInputs(argv, { root, run: fakeRun().run, ...fakeFs(root) });
    const staging = { ...inputs, env: "staging" } as unknown as Inputs;
    const refused = { pass: false, reason: "the dev trust folder has no rule for the env staging" };
    expect(c9.run(staging, AbortSignal.timeout(1000))).toEqual(refused);
    expect(c26.run(staging, AbortSignal.timeout(1000))).toEqual(refused);
  });

  test("local_dev_trust_survivors_on_disk", async () => {
    // P1.35p N6 (verify-896): what only a file on disk shows. A dot-named file beside root.pem (a listing that skips
    // dot names would miss it) and a SEC1 key block, which says EC PRIVATE KEY rather than PRIVATE KEY. A CA:TRUE leaf
    // is already pinned in local_c18_judges_the_leaf_copy.
    const dot = await local((text) => text, {
      setUp: (root) => writeFileSync(join(dirname(root), "unset-dev-trust/.hidden"), "x"),
    });
    expect(dot.lines.find((line) => / C26 /.test(line))).toMatch(
      /^FAIL C26 dev trust folder holds something other than root\.pem: \/.+\/unset-dev-trust\/\.hidden$/,
    );
    const sec1 = execFileSync("openssl", ["ec", "-in", join(pki, "root.key")], { stdio: ["ignore", "pipe", "pipe"] });
    expect(sec1.toString()).toMatch(/^-----BEGIN EC PRIVATE KEY-----\n/);
    for (const devRoot of [`${DEV_ROOT}${sec1}`, `${sec1}${DEV_ROOT}`]) {
      const { lines } = await local((text) => text, { devRoot });
      expect(lines.find((line) => / C18 /.test(line))).toBe("FAIL C18 the dev root copy holds a private key");
    }
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

  test("local_without_mail_passes", async () => {
    // Alex's "Local only" mail card (2026-10-14T20:28:12Z; record 2026-10-13-p127l-local-gaps, Amendment 6).
    const { lines, code } = await local((text) => text);
    expect(failed(lines)).toEqual([]);
    expect(lines).toContain("PASS C11 skipped: local runs without email");
    expect(lines).toContain("PASS C19 skipped: local runs without email");
    expect(code).toBe(0);
  });

  test("local_c30_four_names", async () => {
    // P1.36q red 5: one env per host, so a six-name pds.env under --env local fails, beside C11's and C19's refusals.
    const mail = {
      PDS_EMAIL_SMTP_URL: "smtps://mail.example.test:465",
      PDS_MODERATION_EMAIL_SMTP_URL: "smtps://m.test",
    };
    const { lines } = await local((text) => text, { pdsEnv: { ...LOCAL_ENV, ...mail } });
    expect(failed(lines)).toEqual(["C11", "C19", "C30"]);
    expect(lines).toContain("FAIL C30 PDS_EMAIL_SMTP_URL is in the pds env file, which under local holds only its set");
  });

  test("local_any_smtp_key_refused", async () => {
    // So local cannot half-configure mail: any mail key, even a valid or empty value, fails its check.
    const keys = [
      ["C11", "PDS_EMAIL_SMTP_URL"],
      ["C19", "PDS_MODERATION_EMAIL_SMTP_URL"],
      ["C19", "PDS_MODERATION_EMAIL_ADDRESS"],
      ["C11", "PDS_EMAIL_FROM_ADDRESS"],
    ] as const;
    for (const [id, name] of keys) {
      for (const value of ["smtps://mail.example.test:465", "smtp://mailpit:1025", "moderation@example.test", ""]) {
        const { lines } = await local((text) => text, { pdsEnv: { ...LOCAL_ENV, [name]: value } });
        // The URLs are pds.env names, which local's exact set (C30) refuses too; the addresses are compose literals.
        const viaFile = name.endsWith("_SMTP_URL") ? ["C30"] : [];
        expect(failed(lines), `${name}=${value}`).toEqual([id, ...viaFile]);
        expect(lines).toContain(`FAIL ${id} ${name} is set; local runs without email`);
      }
    }
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
    // Local never takes the dev files (P1.38e): not dev/tls.caddy as its (tls), nor dev/app.caddy as its app site.
    expect(await c18((text) => text.replace("./edge/local/tls.caddy:", "./edge/dev/tls.caddy:"))).toBe(
      "FAIL C18 the TLS snippet is not deployment/edge/local/tls.caddy",
    );
    expect(await c18((text) => text.replace("./edge/local/app.caddy:", "./edge/dev/app.caddy:"))).toBe(
      "FAIL C18 the edge config is unreadable: app.caddy: not mounted from local/app.caddy",
    );
    expect(await c18(volume("../../unset-dev-ca/root.key:/srv/root.key:ro"))).toBe(
      "FAIL C18 the edge binds more than its sites and the local files",
    );
    // The app site is one of the site file mounts now (P1.33y); local_c18_mounts_each_site_file judges those.
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

  test("local_c18_mounts_each_site_file", async () => {
    // P1.33y (book edit 2026-10-13-p134o-after-791, Amendment 1; local-gaps Amendment 3 S2): under local the edge mounts
    // every sites/*.caddy and local/app.caddy as its own read-only file, never the sites directory.
    const c18 = async (edit: (text: string) => string) => (await local(edit)).lines.find((line) => / C18 /.test(line));
    const pds = "      - ./edge/sites/pds.caddy:/etc/caddy/sites/enabled/pds.caddy:ro\n";
    const app = "      - ./edge/local/app.caddy:/etc/caddy/sites/enabled/app.caddy:ro\n";
    expect(await c18((text) => text)).toBe("PASS C18 ok");
    const cases: [string, (text: string) => string][] = [
      [
        "FAIL C18 the local edge mounts a directory at /etc/caddy/sites/enabled",
        (text) => text.replace(pds, "      - ./edge/sites/enabled:/etc/caddy/sites/enabled:ro\n"),
      ],
      [
        "FAIL C18 the local edge mounts a directory at /etc/caddy/sites/enabled",
        (text) => text.replace(pds, `${pds}      - ./edge/sites/enabled:/etc/caddy/sites/enabled/:ro\n`),
      ],
      ["FAIL C18 the site pds.caddy is not mounted read-only", (text) => text.replace(pds, pds.replace(":ro\n", "\n"))],
      [
        "FAIL C18 the site pds.caddy is not a bind mount",
        (text) =>
          text
            .replace(pds, "      - sites:/etc/caddy/sites/enabled/pds.caddy:ro\n")
            .replace("\nsecrets:", "\nvolumes:\n  sites: {}\nsecrets:"),
      ],
      [
        "FAIL C18 input missing: the edge's site mounts in /etc/caddy/sites/enabled",
        (text) => text.replace(pds, "").replace(app, ""),
      ],
      ["FAIL C18 the edge config is unreadable: app.caddy: not mounted", (text) => text.replace(app, "")],
      ["FAIL C18 the edge config is unreadable: pds.caddy: not mounted", (text) => text.replace(pds, "")],
      [
        "FAIL C18 the edge config is unreadable: second.caddy: not a site the local stack mounts",
        (text) => text.replace(app, `${app}${app.replace("enabled/app", "enabled/second")}`),
      ],
      [
        "FAIL C18 the edge mounts over /etc/caddy/sites/enabled/more/pds.caddy",
        (text) => text.replace(pds, `${pds}${pds.replace("enabled/pds", "enabled/more/pds")}`),
      ],
    ];
    for (const [line, edit] of cases) expect(await c18(edit), line).toBe(line);
    // verify-876 N5: a site whose source is absent names that input, rather than ending in a check error.
    expect(await c18((text) => text.replace("./edge/sites/pds.caddy:", "./edge/sites/absent.caddy:"))).toMatch(
      /^FAIL C18 input missing: \/.+\/edge\/sites\/absent\.caddy$/,
    );
    // verify-888 N6: any lstat error but ENOENT is a check error, never input missing; a path through a regular file
    // answers ENOTDIR. And an absent source is named before the local file mounts are judged (edge.ts:280-283).
    expect(await c18((text) => text.replace("./edge/sites/pds.caddy:", "./edge/sites/pds.caddy/x.caddy:"))).toBe(
      "FAIL C18 check error",
    );
    const tls = "      - ./edge/local/tls.caddy:/etc/caddy/snippets/tls.caddy:ro\n";
    expect(await c18((text) => text.replace(tls, ""))).toBe("FAIL C18 the TLS snippet is not mounted");
    expect(
      await c18((text) => text.replace(tls, "").replace("./edge/sites/pds.caddy:", "./edge/sites/absent.caddy:")),
    ).toMatch(/^FAIL C18 input missing: \/.+\/edge\/sites\/absent\.caddy$/);
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
      const mount = (text: string, sites: string) => {
        const anchor = `      - ./edge/${sites}:ro\n`;
        expect(text).toContain(anchor);
        return text.replace(anchor, `$&      - ./edge/local/${file}:${target}:ro\n`);
      };
      // Under dev the dev (tls) and the two dev sites are the file mounts allowed (P1.38e), so the local (tls) fails as
      // a second (tls), and local/app.caddy as an app site not from dev/.
      const devLine =
        file === "tls.caddy"
          ? "FAIL C18 the edge mounts /etc/caddy/snippets/tls.caddy more than once"
          : "FAIL C18 the edge config is unreadable: app.caddy: not mounted from dev/app.caddy";
      for (const [env, s, line] of [
        [
          "dev",
          {
            compose: mount(DEV, "dev/pds.caddy:/etc/caddy/sites/enabled/pds.caddy"),
            pdsEnv: DEV_ENV,
            files: { [`deployment/edge/local/${file}`]: readFileSync(join(EDGE_DIR, "local", `${file}`), "utf8") },
          },
          devLine,
        ],
        [
          "prod",
          { compose: mount(COMPOSE, "sites/enabled:/etc/caddy/sites/enabled") },
          `FAIL C18 the edge mounts over ${target}`,
        ],
      ] as const) {
        const { lines } = await check(s, env);
        expect(lines, `${env} ${file}`).toContain(line);
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
      ".staging.unset.im",
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

// P1.37y (ADR 0036 Decision 2): under dev with --source, a service may build from the checkout instead of running a
// lock image; C2 admits the build when C26 passes it and nothing stands beside it. Nothing changes without the flag.
describe("--source builds staging from the checkout (P1.37y)", () => {
  const BUILD = "    build:\n      context: ..\n      dockerfile: deployment/images/node-app.Dockerfile\n";
  const DOCKERFILE = { "deployment/images/node-app.Dockerfile": "FROM scratch\n" };
  /** A dev stack whose web service is written as `edit` makes it, run with `flags` after the usual arguments. */
  async function source(
    edit: (dev: string) => string,
    flags: string[] = ["--source"],
    files: Record<string, string> = DOCKERFILE,
  ) {
    const { root, file } = stack({
      compose: edit(DEV),
      pdsEnv: DEV_ENV,
      report: PART_A_DONE,
      networks: DEV_TABLE,
      files,
    });
    return runPreflight(["--env", "dev", "--compose", file, ...flags], { root, run: fakeRun().run, ...fakeFs(root) });
  }
  const builtWeb = (dev: string) => dev.replace(`    image: ${WEB}\n`, BUILD);

  test("source_admits_a_build_c26_passes_and_says_so", async () => {
    const result = await source(builtWeb);
    expect(failed(result.lines)).toEqual([]);
    expect(result.lines).toContain("PASS C2 ok");
    expect(result.lines.at(-1)).toBe(SOURCE_LAST_LINE);
    expect(result.code).toBe(0);
    // The flag changes nothing else: C3 to C5 still verify the lock (no UNSIGNED line).
    expect(result.lines.some((line) => line.startsWith("UNSIGNED"))).toBe(false);
  });

  test("source_judges_a_built_edge_by_its_dockerfile", async () => {
    // Codex on #1309: C18 took the edge by the lock's image only, so a built edge failed every --source run. Built
    // from deployment/edge/Dockerfile it passes; built from another scanned Dockerfile it fails C18 by name.
    const edgeBuild = "    build:\n      context: ./edge\n      dockerfile: Dockerfile\n";
    const files = { "deployment/edge/Dockerfile": "FROM scratch\n" };
    const ok = await source((dev) => dev.replace(`    image: ${EDGE}\n`, edgeBuild), ["--source"], files);
    expect(failed(ok.lines)).toEqual([]);
    expect(ok.lines).toContain("PASS C18 ok");
    const other = await source((dev) => dev.replace(`    image: ${EDGE}\n`, BUILD), ["--source"], DOCKERFILE);
    expect(other.lines).toContain("FAIL C18 the edge is not built from deployment/edge/Dockerfile");
  });

  test("source_refuses_a_build_beside_an_image", async () => {
    const result = await source((dev) => dev.replace(`    image: ${WEB}\n`, `$&${BUILD}`));
    expect(result.lines).toContain("FAIL C2 web has both an image and a build");
    expect(result.lines.at(-1)).toBe(SOURCE_LAST_LINE);
  });

  test("source_refuses_a_build_c26_refuses", async () => {
    // A Dockerfile the images workflow does not scan fails C26, and so C2 under --source.
    const other = BUILD.replace("deployment/images/node-app.Dockerfile", "deployment/images/node-app.txt");
    const result = await source((dev) => dev.replace(`    image: ${WEB}\n`, other), ["--source"], {
      "deployment/images/node-app.txt": "FROM scratch\n",
    });
    expect(result.lines).toContain("FAIL C2 web builds from a Dockerfile C26 refuses");
    expect(failed(result.lines)).toContain("C26");
  });

  test("without_source_a_build_still_fails_c2_and_no_source_line_prints", async () => {
    const result = await source(builtWeb, []);
    expect(result.lines).toContain("FAIL C2 web has a build; dev and prod run only registry images");
    expect(result.lines).not.toContain(SOURCE_LAST_LINE);
  });

  test("source_is_dev_only_and_given_once", async () => {
    const { root, file } = stack({});
    const run = async (env: string, flags: string[]) =>
      (await runPreflight(["--env", env, "--compose", file, ...flags], { root, run: fakeRun().run, ...fakeFs(root) }))
        .lines;
    expect(await run("prod", ["--source"])).toEqual(["ERROR --source is for --env dev only"]);
    expect(await run("local", ["--source"])).toEqual(["ERROR --source is for --env dev only"]);
    expect(await run("dev", ["--source", "--source"])).toEqual(["ERROR --source may be given once"]);
  });
});
