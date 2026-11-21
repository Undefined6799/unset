// The one way tests run Synapse (P6.10a): the pinned upstream image started by `docker run`, like Postgres (P1.11g)
// and the object store (P2.18s), with infrastructure/matrix/synapse-module mounted read-only on PYTHONPATH and loaded
// through `modules:`, as the stack will load it. Only tests use it so far; the stack's service and its lock and mirror
// entries arrive with the compose change (P6.02). Hardening: --rm, a read-only root, every capability dropped, no
// new privileges, Synapse's own uid, the port published on 127.0.0.1 only, and removal even on failure.
// The config is a test homeserver, not the stack's: users come from Synapse's shared-secret registration, so MAS is not
// needed to test a rule that only looks at events and room creation. Synapse keeps its own state in SQLite inside the
// container's tmpfs; nothing of ours is stored there, so TE-2's real-Postgres rule (our data) does not apply.
import { createHmac, randomBytes } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { docker } from "./docker.ts";

/** matrixdotorg/synapse v1.165.0 by index digest (Docker Hub; read 2026-11-21 with `docker pull`). */
export const SYNAPSE_IMAGE =
  "docker.io/matrixdotorg/synapse:v1.165.0@sha256:673b4223c81a7634fd07d832b939a58f97081cfdaae7cdd2d1664cdcf7611b62";

/** The module folder, mounted read-only at /modules. */
export const MODULE_DIR = join(import.meta.dirname, "..", "..", "infrastructure", "matrix", "synapse-module");

const CALL_MS = 120_000;
const OWNER_LABEL = "sh.unset.test-owner";
/** The image's own synapse user (its Dockerfile's UID/GID default, 991). */
const SYNAPSE_UID = "991:991";
const STARTED = new Set<string>();
const DIRS = new Set<string>();

export type Synapse = { readonly name: string; readonly origin: string; readonly secret: string };
export type MatrixUser = { readonly userId: string; readonly token: string };

function run(args: readonly string[]): string {
  const ran = docker(args, { timeoutMs: CALL_MS });
  if (ran.code !== 0) throw new Error(`docker ${args[0]} failed: ${ran.err.trim().slice(-2_000)}`);
  return ran.out.trim();
}

/**
 * How long a plain room's messages live. The module pins rooms to 30 days; `allowedLifetimeMax` caps that on the server
 * (as the stack's 30d does), so a test can shorten it without changing the rule, and `purgeInterval` runs the purge job.
 */
export type Retention = { readonly allowedLifetimeMax: string; readonly purgeInterval: string };
const STACK_RETENTION: Retention = { allowedLifetimeMax: "30d", purgeInterval: "12h" };

/** A homeserver with the stack's chat settings and `module` loaded. */
function homeserverYaml(secret: string, module: string, retention: Retention): string {
  const unlimited = "{ per_second: 1000, burst_count: 1000 }";
  return [
    "server_name: unset.test",
    "pid_file: /data/homeserver.pid",
    "listeners:",
    "  - { port: 8008, type: http, tls: false, bind_addresses: ['0.0.0.0'], resources: [{ names: [client] }] }",
    "database: { name: sqlite3, args: { database: /data/homeserver.db } }",
    "signing_key_path: /data/signing.key",
    "media_store_path: /data/media",
    "report_stats: false",
    "trusted_key_servers: []",
    "federation_domain_whitelist: []",
    `registration_shared_secret: "${secret}"`,
    `macaroon_secret_key: "${randomBytes(24).toString("hex")}"`,
    `form_secret: "${randomBytes(24).toString("hex")}"`,
    // The module encrypts every room not asked for as plain; `all` would encrypt the plain kind too.
    'encryption_enabled_by_default_for_room_type: "off"',
    "enable_search: false",
    "retention:",
    "  enabled: true",
    `  allowed_lifetime_max: ${retention.allowedLifetimeMax}`,
    `  purge_jobs: [{ interval: ${retention.purgeInterval} }]`,
    `rc_message: ${unlimited}`,
    `rc_registration: ${unlimited}`,
    `rc_joins: { local: ${unlimited}, remote: ${unlimited} }`,
    `rc_invites: { per_room: ${unlimited}, per_user: ${unlimited}, per_issuer: ${unlimited} }`,
    `rc_third_party_invite: ${unlimited}`,
    `rc_room_creation: ${unlimited}`,
    "modules:",
    `  - module: ${module}`,
    "    config: {}",
    "",
  ].join("\n");
}

/** Starts Synapse with `module` (a dotted class path under the module folder) and waits until it answers. */
export async function startSynapse(
  module = "unset_chat_policy.RoomPolicy",
  retention: Retention = STACK_RETENTION,
): Promise<Synapse> {
  const secret = randomBytes(24).toString("hex");
  const dir = mkdtempSync(join(tmpdir(), "unset-synapse-"));
  DIRS.add(dir);
  chmodSync(dir, 0o755);
  writeFileSync(join(dir, "homeserver.yaml"), homeserverYaml(secret, module, retention));
  chmodSync(join(dir, "homeserver.yaml"), 0o644);
  const name = `unset-synapse-${process.pid}-${randomBytes(4).toString("hex")}`;
  STARTED.add(name);
  const hardening = ["--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--user", SYNAPSE_UID];
  const mounts = ["-v", `${dir}:/conf:ro`, "-v", `${MODULE_DIR}:/modules:ro`, "--tmpfs", "/tmp"];
  const data = ["--tmpfs", `/data:uid=${SYNAPSE_UID.split(":")[0]},gid=${SYNAPSE_UID.split(":")[1]},mode=0700`];
  const env = ["-e", "PYTHONPATH=/modules", "-e", "PYTHONDONTWRITEBYTECODE=1"];
  const start = "python -m synapse.app.homeserver -c /conf/homeserver.yaml";
  run(
    ["run", "-d", "--rm", "--name", name, "--label", `${OWNER_LABEL}=${process.pid}`, "-p", "127.0.0.1::8008"]
      .concat(hardening, mounts, data, env, ["--entrypoint", "sh", SYNAPSE_IMAGE])
      .concat(["-c", `${start} --generate-keys && exec ${start}`]),
  );
  const port = run(["port", name, "8008/tcp"]).split("\n")[0]?.split(":").at(-1) ?? "";
  const origin = `http://127.0.0.1:${port}`;
  await waitUntilServing(name, origin);
  return { name, origin, secret };
}

/** The client API answers /versions once Synapse has loaded its modules; a module that fails to load stops it. */
async function waitUntilServing(name: string, origin: string, timeoutMs = 90_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const ping = { signal: AbortSignal.timeout(2_000) };
      const res = await fetch(`${origin}/_matrix/client/versions`, ping); // guard-allow: egress the loopback Synapse this file started
      if (res.status === 200) return;
    } catch {
      // not listening yet
    }
    const state = docker(["inspect", "-f", "{{.State.Running}}", name], { timeoutMs: CALL_MS });
    if (state.code !== 0 || state.out.trim() !== "true") throw new Error(`synapse ${name} stopped: ${logsOf(name)}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`synapse at ${origin} did not answer within ${timeoutMs} ms: ${logsOf(name)}`);
}

function logsOf(name: string): string {
  const logs = docker(["logs", "--tail", "40", name], { timeoutMs: CALL_MS });
  return `${logs.out}${logs.err}`.trim().slice(-4_000);
}

/**
 * Registers a user through Synapse's shared-secret admin API: a nonce, then an HMAC-SHA1 over
 * nonce NUL user NUL password NUL "notadmin" (element-hq/synapse v1.165.0 docs/admin_api/register_api.md).
 */
export async function registerUser(synapse: Synapse, username: string): Promise<MatrixUser> {
  const url = `${synapse.origin}/_synapse/admin/v1/register`;
  const nonced = await fetch(url); // guard-allow: egress the loopback Synapse this file started
  const { nonce } = (await nonced.json()) as { nonce: string };
  const password = randomBytes(18).toString("base64url");
  const mac = createHmac("sha1", synapse.secret)
    .update([nonce, username, password, "notadmin"].join("\0"))
    .digest("hex");
  const body = JSON.stringify({ nonce, username, password, admin: false, mac });
  const post = { method: "POST", headers: { "content-type": "application/json" }, body };
  const res = await fetch(url, post); // guard-allow: egress the loopback Synapse this file started
  if (res.status !== 200) throw new Error(`register ${username}: ${res.status} ${await res.text()}`);
  const registered = (await res.json()) as { user_id: string; access_token: string };
  return { userId: registered.user_id, token: registered.access_token };
}

export type Answer = { readonly status: number; readonly body: Record<string, unknown> };

/** One client-server API call (spec v1.18 /_matrix/client/v3) as `user`. */
export async function clientCall(
  synapse: Synapse,
  user: MatrixUser,
  method: string,
  path: string,
  body?: unknown,
): Promise<Answer> {
  const headers = { authorization: `Bearer ${user.token}`, "content-type": "application/json" };
  const init = { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
  const res = await fetch(`${synapse.origin}/_matrix/client/v3${path}`, init); // guard-allow: egress the loopback Synapse this file started
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** Rows of one read-only query on Synapse's own database, run inside the container. */
export function synapseRows(synapse: Synapse, query: string, params: readonly string[]): unknown[][] {
  const script = [
    "import json, sqlite3, sys",
    "db = sqlite3.connect('file:/data/homeserver.db?mode=ro', uri=True)",
    "print(json.dumps(db.execute(sys.argv[1], sys.argv[2:]).fetchall()))",
  ].join("\n");
  return JSON.parse(run(["exec", synapse.name, "python", "-c", script, query, ...params])) as unknown[][];
}

/** Removes every Synapse this process started and their config folders. For afterAll. */
export function stopAllSynapse(): void {
  const failures: string[] = [];
  for (const name of STARTED) {
    const ran = docker(["rm", "-f", "-v", name], { timeoutMs: CALL_MS });
    if (ran.code !== 0 && !ran.err.includes("No such container")) failures.push(name);
  }
  STARTED.clear();
  for (const dir of DIRS) rmSync(dir, { recursive: true, force: true });
  DIRS.clear();
  if (failures.length > 0) throw new Error(`could not remove ${failures.join(", ")}`);
}

export const STOP_SYNAPSE_MS = 2 * CALL_MS;
