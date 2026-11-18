import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net"; // guard-allow: egress test, finds a free local port
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { PROBE_DID } from "../../../interfaces/pds-admin/pds.ts";
import { type FakePds, fakePds, PASSWORD, PDS_DID, payloadFor, signed, tempDir, webKey } from "./harness.ts";

const MAIN = join(import.meta.dirname, "../../../interfaces/pds-admin/main.ts");
const children: ChildProcess[] = [];
let pds: FakePds | undefined;
afterEach(async () => {
  for (const child of children.splice(0)) child.kill();
  await pds?.close();
});

const freePort = () =>
  new Promise<number>((resolve) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });

function secrets(key: ReturnType<typeof webKey>, omit?: string): string {
  const dir = tempDir();
  const files: Record<string, string> = {
    pds_admin_password: PASSWORD,
    pds_admin_log_key: randomBytes(32).toString("base64"),
    "pds_admin_keys.json": JSON.stringify([
      {
        kid: key.kid,
        iss: "web",
        publicKeyPem: key.publicKey.export({ type: "spki", format: "pem" }),
        verbs: ["invite.issue"],
      },
    ]),
  };
  for (const [name, text] of Object.entries(files)) if (name !== omit) writeFileSync(join(dir, name), text);
  return dir;
}

function env(url: URL, secretsDir: string, stateDir: string, port: number): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    PDS_ADMIN_ENV: "dev",
    PDS_DID,
    PDS_INTERNAL_URL: url.origin,
    SIGNUPS_OPEN: "true",
    STATE_DIR: stateDir,
    PDS_ADMIN_SECRETS_DIR: secretsDir,
    PORT: String(port),
  };
}

async function start(environment: NodeJS.ProcessEnv): Promise<string> {
  const child = spawn(process.execPath, [MAIN], { env: environment, stdio: "ignore" });
  children.push(child);
  return up(environment);
}

/** The service's base URL once its health answers. */
async function up(environment: NodeJS.ProcessEnv): Promise<string> {
  const base = `http://127.0.0.1:${environment.PORT}`;
  for (let i = 0; i < 100; i++) {
    const up = await fetch(`${base}/health`).then(
      () => true,
      () => false,
    );
    if (up) return base;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("pds-admin did not start");
}

describe("boot", () => {
  test("envelope.jti_survives_restart: a jti accepted before a restart is refused after it", async () => {
    pds = await fakePds();
    const key = webKey();
    const environment = env(pds.url, secrets(key), tempDir(), await freePort());
    const envelope = signed(key, payloadFor());
    const post = (base: string) =>
      fetch(`${base}/v1/invite.issue`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(envelope),
      });
    expect((await post(await start(environment))).status).toBe(200);
    for (const child of children.splice(0)) child.kill();
    await new Promise((r) => setTimeout(r, 100));
    expect((await post(await start(environment))).status).toBe(403);
    expect(readFileSync(join(environment.STATE_DIR as string, "log.jsonl"), "utf8")).toContain('"reason":"replay"');
  });

  test.each(["pds_admin_password", "pds_admin_keys.json", "pds_admin_log_key"])(
    "boot.missing_secret: no %s → exit 1, and no secret on stderr",
    (omit) => {
      const key = webKey();
      const dir = secrets(key, omit);
      const result = spawnSync(process.execPath, [MAIN], {
        env: env(new URL("http://127.0.0.1:1"), dir, tempDir(), 1),
        encoding: "utf8",
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toBe(`pds-admin: secret ${omit} cannot be read\n`);
      expect(result.stderr).not.toContain(PASSWORD);
    },
  );

  test("a PDS URL that resolves to a public address refuses to boot", () => {
    const key = webKey();
    const result = spawnSync(process.execPath, [MAIN], {
      env: env(new URL("http://93.184.215.14"), secrets(key), tempDir(), 1),
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toBe("pds-admin: PDS_INTERNAL_URL resolves to a public address\n");
  });

  describe("the admin password (P2.09e)", () => {
    const WRONG = "secret pds_admin_password is not the PDS's admin password";
    /** Runs main to its exit while this process keeps serving the fake PDS; its exit code and stderr. */
    const exited = (child: ChildProcess) => {
      let stderr = "";
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      return new Promise<{ code: number | null; stderr: string }>((resolve) =>
        child.on("exit", (code) => resolve({ code, stderr })),
      );
    };
    const run = (environment: NodeJS.ProcessEnv) => {
      const child = spawn(process.execPath, [MAIN], { env: environment, stdio: ["ignore", "ignore", "pipe"] });
      children.push(child);
      return child;
    };

    test("boot.password_refused: a 401 to the probe → exit 1 naming the secret, never its value", async () => {
      pds = await fakePds();
      pds.password = "the-pds-has-another-password";
      const result = await exited(run(env(pds.url, secrets(webKey()), tempDir(), await freePort())));
      expect(result).toEqual({ code: 1, stderr: `pds-admin: ${WRONG}\n` });
      expect(pds.seen.map((s) => s.path)).toEqual([
        `/xrpc/com.atproto.admin.getAccountInfo?did=${encodeURIComponent(PROBE_DID)}`,
      ]);
    });

    test("boot.password_accepted: the probe's NotFound means the password works, and it starts", async () => {
      pds = await fakePds();
      pds.password = PASSWORD;
      pds.account = "not_found";
      await start(env(pds.url, secrets(webKey()), tempDir(), await freePort()));
      expect(pds.seen.map((s) => s.path)).toContain(
        `/xrpc/com.atproto.admin.getAccountInfo?did=${encodeURIComponent(PROBE_DID)}`,
      );
    });

    test("boot.pds_unreachable: it starts, and the first 401 later stops it", async () => {
      const pdsPort = await freePort();
      const key = webKey();
      const environment = env(new URL(`http://127.0.0.1:${pdsPort}`), secrets(key), tempDir(), await freePort());
      const child = run(environment);
      const done = exited(child);
      const base = await up(environment);
      pds = await fakePds(pdsPort);
      pds.password = "the-pds-has-another-password";
      await fetch(`${base}/v1/invite.issue`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(signed(key, payloadFor())),
      }).catch(() => undefined);
      expect(await done).toEqual({ code: 1, stderr: `pds-admin: ${WRONG}; stopping\n` });
    });
  });
});
