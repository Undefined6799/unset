// The built Synapse image runs the stack's own config (P6.02; ADR 0086 Decision 1): deployment/chat/dev/homeserver.yaml
// and log.yaml, read-only, as 991 with every capability dropped, against Postgres in the database chat-databases.sh
// makes, with its secrets as files. It serves the client API, loads the server rule from the image (ADR 0085), and
// stops when that module is misconfigured, so a broken rule never runs a server without it. It builds an image, so it
// lives in an *.image.test.ts file (P1.28r): CI runs it after the unit tests, and a local run without Docker fails
// rather than skips. The build copies infrastructure/matrix/synapse-module/, which lands with #1864.
import { randomBytes } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { docker, killBefore, withCleanup } from "../../tests/support/docker.ts";
import { buildTestImage, removeTestImage } from "../../tests/support/image-build.ts";
import { randomPassword, STOP_ALL_MS, startPostgres, stopAllPostgres } from "../../tests/support/postgres.ts";

const DEPLOYMENT = join(import.meta.dirname, "..");
const REPO = join(DEPLOYMENT, "..");
const CHAT = join(DEPLOYMENT, "chat", "dev");
const BUILD_CALL_MS = killBefore(600_000);
const CALL_MS = 60_000;
const TEST_MS = 600_000 + 12 * CALL_MS;
const HARDENING = ["--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges"];

afterAll(stopAllPostgres, STOP_ALL_MS);

function run(args: readonly string[]): string {
  const ran = docker(args, { timeoutMs: CALL_MS });
  if (ran.code !== 0) throw new Error(`docker ${args[0]} failed: ${ran.err.trim().slice(-2_000)}`);
  return ran.out.trim();
}

/** A folder Synapse's 991 can read, holding the stack's config files, `homeserver.yaml` possibly changed. */
function configDir(homeserver: string): string {
  const dir = mkdtempSync(join(tmpdir(), "unset-synapse-config-"));
  chmodSync(dir, 0o755);
  writeFileSync(join(dir, "homeserver.yaml"), homeserver);
  writeFileSync(join(dir, "log.yaml"), readFileSync(join(CHAT, "log.yaml")));
  for (const file of ["homeserver.yaml", "log.yaml"]) chmodSync(join(dir, file), 0o644);
  return dir;
}

/** The secret files homeserver.yaml names, the signing key made by the image's own generate_signing_key. */
function secretsDir(image: string, pgPassword: string): string {
  const dir = mkdtempSync(join(tmpdir(), "unset-synapse-secrets-"));
  chmodSync(dir, 0o755);
  const signingKey = run(["run", "--rm", ...HARDENING, "--entrypoint", "/opt/synapse/bin/generate_signing_key", image]);
  const files: Record<string, string> = {
    synapse_signing_key: `${signingKey}\n`,
    synapse_macaroon_secret_key: randomBytes(32).toString("hex"),
    synapse_form_secret: randomBytes(32).toString("hex"),
    synapse_mas_secret: randomBytes(32).toString("hex"),
    // libpq's passfile: host:port:database:user:password.
    synapse_pgpass: `postgres:5432:synapse:synapse:${pgPassword}\n`,
  };
  for (const [name, value] of Object.entries(files)) {
    writeFileSync(join(dir, name), value);
    chmodSync(join(dir, name), 0o644);
  }
  // As the runbook has them: owned by 991 and 0400. libpq ignores a passfile that its group or others can read
  // (PostgreSQL 18 libpq docs, "The Password File"), so a looser mode would fail this test with "no password supplied".
  // The distroless runtime has no shell (ADR 0086 Decision 1), so the image's own Python does it.
  const own = ["run", "--rm", "--network", "none", "--user", "0", "-v", `${dir}:/s`];
  const chown = "import glob, os\nfor p in glob.glob('/s/*'):\n    os.chown(p, 991, 991)\n    os.chmod(p, 0o400)";
  run([...own, "--entrypoint", "/opt/synapse/bin/python", image, "-c", chown]);
  return dir;
}

/**
 * The chat networks a Synapse listener binds an address on (homeserver.yaml; preflight C36 SYNAPSE_NETWORKS): each
 * test network has the reviewed subnet, and Synapse holds the reviewed address on it before it starts, as Compose
 * gives it.
 */
const LISTENER_NETWORKS = [
  { subnet: "10.250.38.48/29", address: "10.250.38.51" },
  { subnet: "10.250.38.0/29", address: "10.250.38.2" },
  { subnet: "10.250.38.32/29", address: "10.250.38.35" },
] as const;

/**
 * Starts the image on `network` (Postgres's) and the listener networks with the stack's mounts; returns the
 * container's name.
 */
function startSynapse(
  image: string,
  network: string,
  listenerNetworks: readonly string[],
  config: string,
  secrets: string,
): string {
  const name = `unset-test-synapse-${randomBytes(6).toString("hex")}`;
  run([
    "create",
    "--name",
    name,
    "--network",
    network,
    ...HARDENING,
    "-v",
    `${config}:/config:ro`,
    "-v",
    `${secrets}:/run/secrets:ro`,
    "--tmpfs",
    "/data:uid=991,gid=991,mode=0700",
    "--tmpfs",
    "/tmp",
    image,
  ]);
  for (const [i, { address }] of LISTENER_NETWORKS.entries())
    run(["network", "connect", "--ip", address, listenerNetworks[i] ?? "", name]);
  run(["start", name]);
  return name;
}

/** The answer Synapse gives on its listener at `address` to GET `path`, once it serves, or why it never did. */
function answer(name: string, path: string, address: string = LISTENER_NETWORKS[0].address): string {
  const fetch = `import urllib.request; print(urllib.request.urlopen('http://${address}:8008${path}', timeout=2).read().decode())`;
  for (let attempt = 0; attempt < 60; attempt++) {
    const ran = docker(["exec", name, "/opt/synapse/bin/python", "-c", fetch], { timeoutMs: CALL_MS });
    if (ran.code === 0) return ran.out.trim();
    if (run(["inspect", "-f", "{{.State.Running}}", name]) !== "true") return `stopped: ${logs(name)}`;
    docker(["exec", name, "/opt/synapse/bin/python", "-c", "import time; time.sleep(1)"], { timeoutMs: CALL_MS });
  }
  return `no answer: ${logs(name)}`;
}

function logs(name: string): string {
  const ran = docker(["logs", "--tail", "40", name], { timeoutMs: CALL_MS });
  return `${ran.out}${ran.err}`.trim().slice(-4_000);
}

/** Waits until the container stops on its own and returns its exit code and log tail. */
function exited(name: string): { code: string; logs: string } {
  const code = run(["wait", name]);
  return { code, logs: logs(name) };
}

describe("synapse image", () => {
  test(
    "synapse_image_runs_the_stack_config_with_the_server_rule",
    async () => {
      const image = buildTestImage(join(import.meta.dirname, "synapse.Dockerfile"), REPO, { timeoutMs: BUILD_CALL_MS });
      const network = `unset-test-chat-${randomBytes(6).toString("hex")}`;
      const pgPassword = randomPassword();
      const pg = await startPostgres({
        initDir: join(DEPLOYMENT, "postgres", "init"),
        secrets: {
          pg_migrator_password: randomPassword(),
          pg_tap_password: randomPassword(),
          pg_synapse_password: pgPassword,
          pg_mas_password: randomPassword(),
        },
      });
      const script = readFileSync(join(DEPLOYMENT, "postgres", "chat", "chat-databases.sh"), "utf8");
      const made = docker(["exec", "-i", "-u", "postgres", pg.name, "bash", "-s"], {
        timeoutMs: CALL_MS,
        input: script,
      });
      expect(made.code, made.err).toBe(0);
      run(["network", "create", network]);
      const listenerNetworks = LISTENER_NETWORKS.map(({ subnet }) => {
        const named = `unset-test-chat-${randomBytes(6).toString("hex")}`;
        run(["network", "create", "--internal", "--subnet", subnet, named]);
        return named;
      });
      const started: string[] = [];
      withCleanup(
        () => {
          run(["network", "connect", "--alias", "postgres", network, pg.name]);
          const homeserver = readFileSync(join(CHAT, "homeserver.yaml"), "utf8");
          const secrets = secretsDir(image, pgPassword);

          const synapse = startSynapse(image, network, listenerNetworks, configDir(homeserver), secrets);
          started.push(synapse);
          expect(answer(synapse, "/health")).toBe("OK");
          // Each listener serves the client API on its own addresses, and nothing answers on any other.
          for (const { address } of LISTENER_NETWORKS)
            expect(JSON.parse(answer(synapse, "/_matrix/client/versions", address)).versions).toContain("v1.11");
          const loopback = docker(
            [
              "exec",
              synapse,
              "/opt/synapse/bin/python",
              "-c",
              "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8008/health', timeout=2)",
            ],
            { timeoutMs: CALL_MS },
          );
          expect(loopback.err).toContain("Connection refused");
          // As 991, never root, and nothing it imports is the OIDC or JWT library.
          expect(run(["exec", synapse, "id", "-u"])).toBe("991");
          const authlib = docker(["exec", synapse, "/opt/synapse/bin/python", "-c", "import authlib"], {
            timeoutMs: CALL_MS,
          });
          expect(authlib.err).toContain("No module named 'authlib'");
          // Synapse made its schema in its own database, as its own role.
          expect(pg.sql("synapse", "SELECT tableowner FROM pg_tables WHERE tablename = 'events'")).toBe("synapse");

          // The rule loads from the image: given a config it refuses, Synapse stops instead of serving without it.
          const refused = homeserver.replace(
            "  - module: unset_chat_policy.RoomPolicy\n    config: {}",
            "  - module: unset_chat_policy.RoomPolicy\n    config: { allow_plaintext: true }",
          );
          expect(refused).not.toBe(homeserver);
          const broken = startSynapse(image, network, listenerNetworks, configDir(refused), secrets);
          started.push(broken);
          const stopped = exited(broken);
          expect(stopped.code).not.toBe("0");
          expect(stopped.logs).toContain("unset_chat_policy.RoomPolicy takes no config");
        },
        () => {
          for (const name of started) docker(["rm", "-f", name], { timeoutMs: CALL_MS });
          docker(["network", "disconnect", "-f", network, pg.name], { timeoutMs: CALL_MS });
          for (const named of [network, ...listenerNetworks]) docker(["network", "rm", named], { timeoutMs: CALL_MS });
          removeTestImage(image, { timeoutMs: CALL_MS });
        },
      );
    },
    TEST_MS,
  );
});
