// P1.35t: the steps of the local-stack workflow (.github/workflows/local-stack.yml; book edit
// 2026-10-19-p135t-local-stack-ci-job and architecture's 02:15Z ruling in it). It makes the sibling folders with values
// generated for this run, starts the deliberately broken red stack, waits once for the containers, runs the client_id
// probe from inside the PDS, prints the allowed diagnostics and removes the folders.
//
//   node scripts/ci/local-stack.ts -- folders | red-up | red-down | wait | probe green|red | diagnose | clean
//
// Values come from node:crypto and are masked (raw, base64 and URL-encoded, each line of a multi-line value) before
// anything is written (D2). Shapes and modes are docs/human/runbooks/dev-stack-secrets.md's. The folders sit beside the
// checkout, never in it. Nothing here runs `docker compose config`, `docker inspect`, `env` or `printenv`: they print
// the environment. The PDS publishes to plc.directory (C28, ADR 0023), but no step creates an account.
import { spawnSync } from "node:child_process";
import { generateKeyPairSync, type KeyObject, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Compose's project name, from `name:` in compose.local.yaml (tests/support/local-stack.ts PROJECT). */
const PROJECT = "unset-local";
export const APP_HOST = "app.unset.localhost";
export const PDS_HOST = "pds.unset.localhost";
/** Web's client_id: its metadata URL (infrastructure/pds/oauth/oauth-client.ts clientMetadata). */
export const CLIENT_ID = `https://${APP_HOST}/oauth-client-metadata.json`;
/**
 * The red stack's one passing result: Node's fetch rejects the edge's leaf because the PDS trusts no dev root. The
 * cause code is OpenSSL's X509_V_ERR_UNABLE_TO_VERIFY_LEAF_SIGNATURE as Node names it (nodejs.org/api/errors.html,
 * "OpenSSL errors"); that this is the code Node 26 gives here is unverified until the red run shows it.
 */
export const RED_ERROR = "UNABLE_TO_VERIFY_LEAF_SIGNATURE";
/** The one bounded wait (D4): every container up, or the job fails. */
export const HEALTH_WAIT_MS = 180_000;
const POLL_MS = 3_000;
const PROBE_MS = 15_000;
/** The services `up` starts; pds-token-reader is a tools profile and never starts. */
export const SERVICES = ["postgres", "migrate", "pds", "edge", "web"] as const;
const ONE_SHOT = "migrate";

const ROOT = resolve(import.meta.dirname, "../..");
const PARENT = dirname(ROOT);
const FOLDERS = ["unset-dev-env", "unset-dev-secrets", "unset-dev-ca", "unset-dev-trust"] as const;
const ENV_FILE = join(PARENT, "unset-dev-env/dev-public.env");
const COMPOSE = join(ROOT, "deployment/compose.local.yaml");
// Beside compose.local.yaml, so its relative paths resolve the same way without moving Compose's base directory
// (preflight.test.ts no_repository_script_passes_project_directory). It holds no value, only the edited file.
const RED_COMPOSE = join(ROOT, "deployment/compose.local.red.yaml");
const TRUST_MOUNT = "      - ../../unset-dev-trust:/etc/unset-dev-trust:ro";
const TRUST_ENV = "      NODE_EXTRA_CA_CERTS: /etc/unset-dev-trust/root.pem";

/** The `::add-mask::` lines for a value: raw, base64 and URL-encoded, each line of a multi-line value on its own. */
export function maskLines(value: string): string[] {
  const parts = value.split("\n").filter((line) => line.trim() !== "");
  const forms = [value, ...parts].flatMap((v) => [v, Buffer.from(v).toString("base64"), encodeURIComponent(v)]);
  return [...new Set(forms.filter((v) => v.trim() !== "" && !v.includes("\n")))].map((v) => `::add-mask::${v}`);
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes: Uint8Array): string {
  let n = BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
  let out = "";
  for (; n > 0n; n /= 58n) out = BASE58[Number(n % 58n)] + out;
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = `1${out}`;
  }
  return out;
}

/** A P-256 public key as atproto's did:key: varint 0x1200, the compressed point, base58btc (atproto.com/specs/cryptography). */
export function p256DidKey(publicKey: KeyObject): string {
  const { x, y } = publicKey.export({ format: "jwk" });
  const yBytes = Buffer.from(y as string, "base64url");
  const prefix = (yBytes.at(-1) ?? 0) % 2 === 0 ? 0x02 : 0x03;
  return `did:key:z${base58(Uint8Array.from([0x80, 0x24, prefix, ...Buffer.from(x as string, "base64url")]))}`;
}

const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
/** A secp256k1 private key as 64 hex digits: 32 random bytes, which must lie in [1, n). */
export function secp256k1PrivateHex(bytes: Buffer): string {
  const value = BigInt(`0x${bytes.toString("hex")}`);
  if (bytes.length !== 32 || value === 0n || value >= SECP256K1_N) throw new Error("not a secp256k1 private key");
  return bytes.toString("hex");
}

/** The generated values, by the runbook's shapes. Nothing is written yet. */
export function generate() {
  const password = (): string => randomBytes(32).toString("base64");
  const ec = (): { privateKey: KeyObject; publicKey: KeyObject } => generateKeyPairSync("ec", { namedCurve: "P-256" });
  const oauth = ec().privateKey.export({ format: "jwk" });
  return {
    migrator: password(),
    superuser: password(),
    tap: password(),
    web: password(),
    api: password(),
    indexer: password(),
    keyring: JSON.stringify({ active: "k1", keys: { k1: randomBytes(32).toString("base64") } }),
    oauthKeys: JSON.stringify([{ ...oauth, kid: "web-ci", alg: "ES256" }]),
    jwtSecret: randomBytes(32).toString("hex"),
    adminPassword: randomBytes(32).toString("hex"),
    rotationKey: secp256k1PrivateHex(randomBytes(32)),
    recoveryDidKey: p256DidKey(ec().publicKey),
    rootKey: ec().privateKey.export({ format: "pem", type: "pkcs8" }) as string,
    leafKey: ec().privateKey.export({ format: "pem", type: "pkcs8" }) as string,
  };
}

function must(file: string, args: string[]): string {
  const out = spawnSync(file, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  if (out.status !== 0) throw new Error(`${file} ${args[0] ?? ""} failed`);
  return out.stdout;
}

/** Makes the four sibling folders (runbook "Where the folder lives", "Layout" and "dev root and leaf"). */
function folders(): void {
  const v = generate();
  for (const value of Object.values(v)) for (const line of maskLines(value)) process.stdout.write(`${line}\n`);
  process.umask(0o077);
  const at = (path: string): string => join(PARENT, path);
  for (const folder of FOLDERS) mkdirSync(at(folder), { mode: 0o700 });
  // The trust folder is bound into pds and web, which run as other uids; mkdir's mode is masked by the umask above.
  chmodSync(at("unset-dev-trust"), 0o755);
  writeFileSync(
    at("unset-dev-env/dev-public.env"),
    [
      `WEB_PUBLIC_ORIGIN=https://${APP_HOST}`,
      `WEB_ALLOWED_HOSTS=${APP_HOST}`,
      "WEB_MEDIA_ORIGIN=https://media.example.net",
      `APP_HOST=${APP_HOST}`,
      `PDS_HOSTNAME=${PDS_HOST}`,
      `PDS_SERVICE_HANDLE_DOMAINS=.${PDS_HOST}`,
      "EDGE_ACME_EMAIL=edge@example.test",
      "WEB_OAUTH_ACTIVE_KID=web-ci",
      "",
    ].join("\n"),
  );
  writeFileSync(
    at("unset-dev-env/pds.env"),
    [
      `PDS_JWT_SECRET=${v.jwtSecret}`,
      `PDS_ADMIN_PASSWORD=${v.adminPassword}`,
      `PDS_PLC_ROTATION_KEY_K256_PRIVATE_KEY_HEX=${v.rotationKey}`,
      `PDS_RECOVERY_DID_KEY=${v.recoveryDidKey}`,
      "",
    ].join("\n"),
  );
  const scratch = at("unset-dev-secrets/.new");
  const secret = (uid: number, name: string, value: string): void => {
    writeFileSync(scratch, value);
    must("sudo", ["install", "-o", `${uid}`, "-g", `${uid}`, "-m", "0400", scratch, at(`unset-dev-secrets/${name}`)]);
  };
  secret(999, "pg_superuser_password", v.superuser);
  secret(999, "pg_migrator_password", v.migrator);
  secret(999, "pg_tap_password", v.tap);
  secret(65532, "migrate_pg_password", v.migrator);
  secret(65532, "pg_web_password", v.web);
  secret(65532, "pg_api_password", v.api);
  secret(65532, "pg_indexer_password", v.indexer);
  secret(65532, "web_seal_keyring", v.keyring);
  secret(65532, "web_oauth_client_keys", v.oauthKeys);
  writeFileSync(at("unset-dev-ca/root.key"), v.rootKey, { mode: 0o400 });
  writeFileSync(at("unset-dev-ca/leaf.key"), v.leafKey);
  const ca = (name: string): string => at(`unset-dev-ca/${name}`);
  must("openssl", [
    ...["req", "-x509", "-new", "-key", ca("root.key"), "-sha256", "-days", "825"],
    ...["-subj", "/CN=unset local dev root", "-addext", "basicConstraints=critical,CA:TRUE,pathlen:0"],
    ...["-addext", "keyUsage=critical,keyCertSign,cRLSign", "-addext"],
    `nameConstraints=critical,permitted;DNS:${APP_HOST},permitted;DNS:${PDS_HOST},excluded;IP:0.0.0.0/0.0.0.0,excluded;IP:::/::`,
    ...["-out", ca("root.pem")],
  ]);
  must("install", ["-m", "0644", ca("root.pem"), at("unset-dev-trust/root.pem")]);
  must("openssl", [
    ...["req", "-x509", "-new", "-key", ca("leaf.key"), "-CA", ca("root.pem"), "-CAkey", ca("root.key")],
    ...["-days", "397", "-sha256", "-subj", `/CN=${APP_HOST}`, "-addext", "basicConstraints=critical,CA:FALSE"],
    ...["-addext", "keyUsage=critical,digitalSignature", "-addext", "extendedKeyUsage=serverAuth"],
    ...["-addext", `subjectAltName=DNS:${APP_HOST},DNS:${PDS_HOST}`, "-out", ca("leaf.pem")],
  ]);
  secret(65532, "local_tls_cert", readFileSync(ca("leaf.pem"), "utf8"));
  secret(65532, "local_tls_key", v.leafKey);
  must("install", ["-m", "0600", ca("leaf.pem"), at("unset-dev-env/local-leaf.pem")]);
  for (const path of [scratch, ca("leaf.key"), ca("leaf.pem")]) rmSync(path);
}

/**
 * The red stack (item 4): compose.local.yaml without P1.34d's trust mount and NODE_EXTRA_CA_CERTS on pds and web, so
 * the PDS cannot verify the edge's leaf. Both lines are removed exactly twice, or the file has drifted and this throws.
 */
export function redCompose(text: string): string {
  const lines = text.split("\n");
  for (const line of [TRUST_MOUNT, TRUST_ENV]) {
    if (lines.filter((l) => l === line).length !== 2)
      throw new Error("compose.local.yaml no longer has the trust lines");
  }
  // web's trust mount is its only volume; Compose refuses a bare `volumes:` (null), so the emptied list is written `[]`.
  return lines
    .filter((l) => l !== TRUST_MOUNT && l !== TRUST_ENV)
    .join("\n")
    .replace(/^ {4}volumes:\n(?! {6}- )/gm, "    volumes: []\n");
}

type PsRow = { Service?: unknown; State?: unknown; Health?: unknown; ExitCode?: unknown };

/** Reads `docker compose ps --format json`: one JSON object per line, or one array (older Compose). */
export function psRows(stdout: string): PsRow[] {
  const text = stdout.trim();
  if (text === "") return [];
  if (text.startsWith("[")) return JSON.parse(text) as PsRow[];
  return text.split("\n").map((line) => JSON.parse(line) as PsRow);
}

type RowVerdict = "up" | "starting" | `failed: ${string}`;

/** One service's row: migrate is a one-shot that must exit 0; the rest run and, where the image checks, are healthy. */
function rowVerdict(service: string, row: PsRow | undefined): RowVerdict {
  if (row === undefined) return `failed: ${service} missing`;
  if (service === ONE_SHOT) {
    if (row.State !== "exited") return "starting";
    return row.ExitCode === 0 ? "up" : `failed: ${service} exited`;
  }
  if (row.State === "created" || row.State === "restarting") return "starting";
  if (row.State !== "running") return `failed: ${service} ${String(row.State)}`;
  if (row.Health === "unhealthy") return `failed: ${service} unhealthy`;
  return row.Health === "starting" ? "starting" : "up";
}

/** Every service up, the first failure, or still starting. */
export function servicesVerdict(rows: readonly PsRow[]): RowVerdict {
  const verdicts = SERVICES.map((service) =>
    rowVerdict(
      service,
      rows.find((r) => r.Service === service),
    ),
  );
  return verdicts.find((v) => v.startsWith("failed")) ?? (verdicts.every((v) => v === "up") ? "up" : "starting");
}

/**
 * The in-container probe's verdict: green wants web's client metadata naming its own client_id, red wants exactly
 * RED_ERROR. Only the fields the probe needs (book edit 2026-10-19-p135t, option (b)): client_id is the fetched URL,
 * and redirect_uris and jwks_uri sit on the same origin. The full schema check is P1.29t's (tests/support/local-stack.ts).
 */
export function probeVerdict(mode: "green" | "red", stdout: string): string | null {
  let result: { status?: unknown; body?: unknown; code?: unknown };
  try {
    result = JSON.parse(stdout.trim());
  } catch {
    return "probe printed no result";
  }
  if (mode === "red") return result.code === RED_ERROR ? null : `red probe did not fail with ${RED_ERROR}`;
  if (result.status !== 200) return "client_id GET did not return 200";
  const body = result.body as { client_id?: unknown; redirect_uris?: unknown; jwks_uri?: unknown };
  const sameOrigin = (uri: unknown): boolean => typeof uri === "string" && uri.startsWith(`https://${APP_HOST}/`);
  const metadata =
    typeof body === "object" &&
    body !== null &&
    body.client_id === CLIENT_ID &&
    Array.isArray(body.redirect_uris) &&
    body.redirect_uris.length > 0 &&
    body.redirect_uris.every(sameOrigin) &&
    sameOrigin(body.jwks_uri);
  return metadata ? null : "client_id GET did not return web's metadata";
}

/** Runs inside the PDS container under its own environment: one GET, no redirect, its result as one JSON line. */
const IN_CONTAINER = `fetch(process.argv[1],{redirect:"error",signal:AbortSignal.timeout(${PROBE_MS})})
.then(async(r)=>console.log(JSON.stringify({status:r.status,body:await r.json().catch(()=>null)})))
.catch((e)=>console.log(JSON.stringify({code:e?.cause?.code??e?.name??"unknown"})))`;

const compose = (file: string): string[] => ["compose", "-p", PROJECT, "-f", file, "--env-file", ENV_FILE];

function wait(): void {
  const deadline = Date.now() + HEALTH_WAIT_MS;
  for (;;) {
    const verdict = servicesVerdict(psRows(must("docker", [...compose(COMPOSE), "ps", "--all", "--format", "json"])));
    if (verdict === "up") return;
    if (verdict !== "starting") throw new Error(verdict);
    if (Date.now() > deadline) throw new Error(`containers not up within ${HEALTH_WAIT_MS} ms`);
    spawnSync("sleep", [`${POLL_MS / 1000}`]);
  }
}

function probe(mode: "green" | "red"): void {
  const out = must("docker", [...compose(COMPOSE), "exec", "-T", "pds", "node", "-e", IN_CONTAINER, CLIENT_ID]);
  const problem = probeVerdict(mode, out);
  if (problem !== null) throw new Error(problem);
  process.stdout.write(`${mode} probe: as intended\n`);
}

function diagnose(): void {
  spawnSync("docker", [...compose(COMPOSE), "ps", "--all"], { stdio: "inherit" });
  for (const service of SERVICES) {
    spawnSync("docker", [...compose(COMPOSE), "logs", "--no-color", "--tail=200", service], { stdio: "inherit" });
  }
}

const USAGE = "usage: local-stack.ts -- folders | red-up | red-down | wait | probe green|red | diagnose | clean";

function main(argv: readonly string[]): void {
  const [separator, command, mode, ...rest] = argv;
  if (separator !== "--" || rest.length > 0) throw new Error(USAGE);
  if (command === "probe" && (mode === "green" || mode === "red")) {
    probe(mode);
    return;
  }
  if (mode !== undefined) throw new Error(USAGE);
  switch (command) {
    case "folders":
      folders();
      break;
    case "red-up":
      writeFileSync(RED_COMPOSE, redCompose(readFileSync(COMPOSE, "utf8")));
      must("docker", [...compose(RED_COMPOSE), "up", "-d", "--build"]);
      break;
    case "red-down":
      must("docker", [...compose(RED_COMPOSE), "down"]);
      rmSync(RED_COMPOSE);
      break;
    case "wait":
      wait();
      break;
    case "diagnose":
      diagnose();
      break;
    case "clean":
      must("sudo", ["rm", "-rf", "--", ...FOLDERS.map((folder) => join(PARENT, folder))]);
      break;
    default:
      throw new Error(USAGE);
  }
}

if (import.meta.main) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`local-stack: ${(error as Error).message}\n`);
    process.exitCode = 1;
  }
}
