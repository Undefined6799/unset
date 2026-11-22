// Starts the real Synapse and MAS that chat-two-browsers.chromium.spec.ts runs against (fixtures/chat-servers.ts), with
// our settings, and writes the CHAT_E2E_* variables that point the spec at them: `node chat-servers-up.ts <env-file>`.
// e2e.yml's chromium leg runs it beside the web servers. It keeps running until SIGTERM or SIGINT, then removes all it
// made; a failed start exits non-zero and writes no file.
//
// What runs is the stack's (deployment/compose.dev.source.yaml, services synapse and mas): Synapse from our own image,
// built here from deployment/images/synapse.Dockerfile as images.yml builds it, MAS 1.29.0 from our GHCR mirror by the
// digest bases.lock.json pins, each with the stack's user, read-only root, dropped capabilities, no-new-privileges and
// tmpfs, on the stack's chat networks with their subnets, internal flag and fixed addresses, and with
// deployment/chat/dev/{homeserver,log,mas}.yaml, secrets as files under /run/secrets owned and moded as the runbook
// (docs/human/runbooks/chat-servers.md) makes them. Postgres is the one way tests run it (tests/support/postgres.ts)
// with chat-databases.sh, as synapse.image.test.ts does. One value differs: the chat domain is unset.cc, the name the
// spec's door and page use (fixtures/chat-servers.ts), where staging has staging.unset.cc (ADR 0025); only the three
// lines that name it change, and the start fails if any of them is not as expected.
//
// The runner reaches the listeners on the containers' own addresses: on an internal network "the host may communicate
// with any container IP directly" (docs.docker.com/reference/cli/docker/network/create/, "--internal", read
// 2026-11-22). The URLs are the listeners the stack's edge and chat-admin use: Synapse's first client listener, and
// MAS's chat-admin listener, which serves oauth (the client-credentials token) and the admin API, as compose gives
// chat-admin MAS_TOKEN_URL and MAS_ADMIN_URL.
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanUpAtExit, docker, OWNER_LABEL } from "../../support/docker.ts";
import { buildTestImage, removeTestImage } from "../../support/image-build.ts";
import { randomPassword, startPostgres } from "../../support/postgres.ts";
import {
  type Attachment,
  chatNetworks,
  endpoints,
  masImage,
  type NetworkSpec,
  withServerName,
} from "./chat-servers-config.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const DEPLOYMENT = join(ROOT, "deployment");
const CHAT = join(DEPLOYMENT, "chat", "dev");
const CALL_MS = 60_000;
const BUILD_MS = 900_000;
const PULL_MS = 600_000;
const READY_MS = 180_000;

const made = { containers: [] as string[], networks: [] as string[], images: [] as string[], dirs: [] as string[] };

function run(args: readonly string[], timeoutMs = CALL_MS, input?: string): string {
  const ran = docker(args, { timeoutMs, ...(input === undefined ? {} : { input }) });
  if (ran.code !== 0) throw new Error(`docker ${args[0]} failed: ${`${ran.out}${ran.err}`.trim().slice(-4_000)}`);
  return ran.out.trim();
}

function folder(prefix: string, files: Record<string, string>, mode: number): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.dirs.push(dir);
  chmodSync(dir, 0o755);
  for (const [name, value] of Object.entries(files)) {
    writeFileSync(join(dir, name), value);
    chmodSync(join(dir, name), mode);
  }
  return dir;
}

/** Owns every file in `dir` by `uid` at 0400, as the runbook has them, through the Synapse image's own Python. */
function own(image: string, dir: string, uid: number): void {
  const script = `import glob, os\nfor p in glob.glob('/s/*'):\n    os.chown(p, ${uid}, ${uid})\n    os.chmod(p, 0o400)`;
  const args = ["run", "--rm", "--network", "none", "--user", "0", "-v", `${dir}:/s`];
  run([...args, "--entrypoint", "/opt/synapse/bin/python", image, "-c", script]);
}

/** Creates `name` from `image` on its attachments (the first at create, the rest connected), then starts it. */
function start(
  name: string,
  alias: string,
  attachments: readonly Attachment[],
  named: Record<string, string>,
  image: string,
  args: readonly string[],
): void {
  const [first, ...rest] = attachments;
  if (first === undefined) throw new Error(`${alias} has no network`);
  const ip = (a: Attachment) => (a.address === undefined ? [] : ["--ip", a.address]);
  const label = ["--label", `${OWNER_LABEL}=${process.pid}`];
  made.containers.push(name);
  const network = ["--network", named[first.network] ?? "", "--network-alias", alias, ...ip(first)];
  run(["create", "--name", name, ...label, ...network, ...args, image]);
  for (const a of rest) run(["network", "connect", "--alias", alias, ...ip(a), named[a.network] ?? "", name]);
  run(["start", name]);
}

const probe = (url: string) => fetch(url, { signal: AbortSignal.timeout(2_000) }); // guard-allow: egress test, the local chat servers only

async function ready(url: string, container: string): Promise<void> {
  const until = Date.now() + READY_MS;
  while (Date.now() < until) {
    const answered = await probe(url).then(
      (r) => r.ok,
      () => false,
    );
    if (answered) return;
    if (run(["inspect", "-f", "{{.State.Running}}", container]) !== "true") break;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`${container} never answered ${url}`);
}

function tearDown(): void {
  for (const name of made.containers) {
    const logs = docker(["logs", "--tail", "200", name], { timeoutMs: CALL_MS });
    process.stderr.write(`--- ${name} ---\n${logs.out}${logs.err}\n`);
    docker(["rm", "-f", name], { timeoutMs: CALL_MS });
  }
  for (const network of made.networks) docker(["network", "rm", network], { timeoutMs: CALL_MS });
  for (const image of made.images) {
    try {
      removeTestImage(image, { timeoutMs: CALL_MS });
    } catch (failure) {
      process.stderr.write(`${String(failure)}\n`);
    }
  }
  for (const dir of made.dirs) rmSync(dir, { recursive: true, force: true });
}

const hex = () => randomBytes(32).toString("hex");
const hardening = (uid: number) => [
  ...["--user", `${uid}:${uid}`, "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true"],
  ...["--tmpfs", `/tmp:uid=${uid},gid=${uid},mode=1777`],
];

/** The stack's chat networks under this run's names, each internal and on its subnet as compose has it. */
function makeNetworks(networks: Record<string, NetworkSpec>, prefix: string): Record<string, string> {
  const named: Record<string, string> = {};
  for (const [name, spec] of Object.entries(networks)) {
    const made_ = `${prefix}-${name}`;
    named[name] = made_;
    made.networks.push(made_);
    const internal = spec.internal ? ["--internal"] : [];
    run(["network", "create", ...internal, ...(spec.subnet ? ["--subnet", spec.subnet] : []), made_]);
  }
  return named;
}

/** Postgres with the synapse and mas roles and databases chat-databases.sh makes; returns their passwords. */
async function startDatabase(attachments: readonly Attachment[], named: Record<string, string>) {
  const synapse = randomPassword();
  const mas = randomPassword();
  const pg = await startPostgres({
    initDir: join(DEPLOYMENT, "postgres", "init"),
    secrets: {
      pg_migrator_password: randomPassword(),
      pg_tap_password: randomPassword(),
      pg_synapse_password: synapse,
      pg_mas_password: mas,
    },
  });
  const script = readFileSync(join(DEPLOYMENT, "postgres", "chat", "chat-databases.sh"), "utf8");
  run(["exec", "-i", "-u", "postgres", pg.name, "bash", "-s"], CALL_MS, script);
  for (const a of attachments) run(["network", "connect", "--alias", "postgres", named[a.network] ?? "", pg.name]);
  return { synapse, mas };
}

/** The secret files homeserver.yaml and mas.yaml name, as the runbook makes them, and chat-admin's client secret. */
function makeSecrets(image: string, pg: { synapse: string; mas: string }) {
  const shared = hex();
  const clientSecret = hex();
  const masKey = generateKeyPairSync("rsa", { modulusLength: 4096 }).privateKey;
  const generate = ["run", "--rm", "--network", "none", "--entrypoint", "/opt/synapse/bin/generate_signing_key"];
  const synapse = folder(
    "unset-e2e-synapse-secrets-",
    {
      synapse_pgpass: `postgres:5432:synapse:synapse:${pg.synapse}\n`,
      synapse_signing_key: `${run([...generate, image])}\n`,
      synapse_macaroon_secret_key: hex(),
      synapse_form_secret: hex(),
      synapse_mas_secret: shared,
    },
    0o600,
  );
  const mas = folder(
    "unset-e2e-mas-secrets-",
    {
      mas_pg_password: pg.mas,
      mas_synapse_secret: shared,
      mas_encryption: hex(),
      mas_signing_key: String(masKey.export({ type: "pkcs8", format: "pem" })),
      mas_chat_admin_client_secret: clientSecret,
    },
    0o600,
  );
  own(image, synapse, 991);
  own(image, mas, 65532);
  const client = join(folder("unset-e2e-chat-client-", { secret: clientSecret }, 0o600), "secret");
  return { synapse, mas, client };
}

async function main(envFile: string): Promise<void> {
  const compose = chatNetworks(readFileSync(join(DEPLOYMENT, "compose.dev.source.yaml"), "utf8"));
  const read = (name: string) => readFileSync(join(CHAT, name), "utf8");
  const config = withServerName(read("homeserver.yaml"), read("mas.yaml"));
  const at = endpoints(config.homeserver, config.mas);
  const prefix = `unset-e2e-${randomBytes(4).toString("hex")}`;

  const synapseImage = buildTestImage(join(DEPLOYMENT, "images", "synapse.Dockerfile"), ROOT, { timeoutMs: BUILD_MS });
  made.images.push(synapseImage);
  const masRef = masImage();
  run(["pull", "--quiet", masRef], PULL_MS);
  const named = makeNetworks(compose.networks, prefix);
  const secrets = makeSecrets(synapseImage, await startDatabase(compose.postgres, named));
  const files = (name: string, contents: Record<string, string>) => folder(`${prefix}-${name}-`, contents, 0o644);
  const masConfig = files("mas", { "mas.yaml": config.mas });
  const synapseConfig = files("synapse", { "homeserver.yaml": config.homeserver, "log.yaml": read("log.yaml") });

  const mount = (from: string, to: string) => ["-v", `${from}:${to}:ro`];
  start(`${prefix}-mas`, "mas", compose.mas, named, masRef, [
    ...hardening(65532),
    ...mount(`${masConfig}/mas.yaml`, "/config/mas.yaml"),
    ...mount(secrets.mas, "/run/secrets"),
    ...["-e", "MAS_CONFIG=/config/mas.yaml"],
  ]);
  await ready(at.masHealth, `${prefix}-mas`);
  start(`${prefix}-synapse`, "synapse", compose.synapse, named, synapseImage, [
    ...hardening(991),
    ...["--tmpfs", "/data/media:uid=991,gid=991,mode=0700"],
    ...mount(`${synapseConfig}/homeserver.yaml`, "/config/homeserver.yaml"),
    ...mount(`${synapseConfig}/log.yaml`, "/config/log.yaml"),
    ...mount(secrets.synapse, "/run/secrets"),
  ]);
  await ready(`${at.synapse}/health`, `${prefix}-synapse`);

  const env = {
    CHAT_E2E_SYNAPSE_URL: at.synapse,
    CHAT_E2E_MAS_URL: at.mas,
    CHAT_E2E_MAS_ADMIN_URL: at.masAdmin,
    CHAT_E2E_MAS_CLIENT_ID: at.clientId,
    CHAT_E2E_MAS_CLIENT_SECRET_FILE: secrets.client,
  };
  // Whole or not at all: the workflow waits for the file to exist.
  writeFileSync(
    `${envFile}.part`,
    Object.entries(env)
      .map(([k, v]) => `${k}=${v}\n`)
      .join(""),
  );
  renameSync(`${envFile}.part`, envFile);
  process.stdout.write(`chat servers ready: ${Object.keys(env).join(" ")}\n`);
}

if (import.meta.main) {
  const envFile = process.argv[2];
  if (envFile === undefined) throw new Error("usage: chat-servers-up.ts <env-file>");
  cleanUpAtExit(tearDown);
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => process.exit(0));
  main(envFile).then(
    () => setInterval(() => undefined, 1 << 30),
    (failure: unknown) => {
      process.stderr.write(
        `chat servers failed to start: ${failure instanceof Error ? failure.message : String(failure)}\n`,
      );
      process.exit(1);
    },
  );
}
