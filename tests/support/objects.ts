// The one way tests run the object store (P2.18s, ADR 0041): SeaweedFS by digest, started by `docker run` like
// Postgres (P1.11g), with an identities file that scopes each key the way the stack does. Only tests use it; the
// stack's service and its lock entry arrive with the compose change.
import { randomBytes } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanUpAtExit, docker, OWNER_LABEL } from "./docker.ts";

/** chrislusf/seaweedfs 4.53 by index digest (Docker Hub, published 2026-11-08; Apache-2.0). */
export const OBJECTS_IMAGE =
  "docker.io/chrislusf/seaweedfs:4.53@sha256:ccad23e18639c8b98cee17e7100b95830a06077b56d8e5b006d6dcf8ec5e94a0";

const CALL_MS = 60_000;

export type ObjectsKey = { readonly keyId: string; readonly secret: string };
export type ObjectsContainer = { readonly name: string; readonly origin: string; readonly admin: ObjectsKey };

/** A key named `name` allowed exactly `actions` (SeaweedFS's s3.json action strings, e.g. `Read:bucket/prefix/*`). */
export type Identity = { readonly name: string; readonly actions: readonly string[] };

const STARTED = new Set<string>();
const DIRS = new Set<string>();

const newKey = (): ObjectsKey => ({
  keyId: randomBytes(8).toString("hex"),
  secret: randomBytes(24).toString("base64url"),
});

function run(args: readonly string[]): string {
  const ran = docker(args, { timeoutMs: CALL_MS });
  if (ran.code !== 0) throw new Error(`docker ${args[0]} failed: ${ran.err.trim()}`);
  return ran.out.trim();
}

/**
 * Starts the store with an admin key plus one key per identity, and waits until its S3 port answers. Returns the
 * container and each identity's key by name.
 */
export async function startObjects(
  identities: readonly Identity[],
): Promise<{ store: ObjectsContainer; keys: Record<string, ObjectsKey> }> {
  const admin = newKey();
  const keys = Object.fromEntries(identities.map((identity) => [identity.name, newKey()]));
  const config = {
    identities: [
      { name: "admin", credentials: [{ accessKey: admin.keyId, secretKey: admin.secret }], actions: ["Admin"] },
      ...identities.map((identity) => ({
        name: identity.name,
        credentials: [{ accessKey: keys[identity.name]?.keyId, secretKey: keys[identity.name]?.secret }],
        actions: identity.actions,
      })),
    ],
  };
  const dir = mkdtempSync(join(tmpdir(), "unset-objects-"));
  DIRS.add(dir);
  chmodSync(dir, 0o755);
  writeFileSync(join(dir, "s3.json"), JSON.stringify(config));
  chmodSync(join(dir, "s3.json"), 0o644);
  const name = `unset-objects-${process.pid}-${randomBytes(4).toString("hex")}`;
  STARTED.add(name);
  // The image's `server` entrypoint passes -volume.max=0 and a 1 GB volume size, so the store makes one volume per GB
  // free on /data, and each bucket's first write grows 7 (deployment/images/objects.Dockerfile). On Docker's own disk
  // that made the tests depend on its free space: below about 21 GB a third bucket got a 500 (P1.38w). A 40 GB tmpfs,
  // the size objects.image.test.ts gives the stack's image, holds 39 volumes on any machine; it takes memory only for
  // what is written.
  run(
    ["run", "-d", "--rm", "--name", name, "--label", `${OWNER_LABEL}=${process.pid}`, "-p", "127.0.0.1::8333"]
      .concat(["--tmpfs", "/data:size=40g", "-v", `${dir}:/etc/seaweedfs-test:ro`, OBJECTS_IMAGE])
      .concat(["server", "-s3", "-s3.config=/etc/seaweedfs-test/s3.json", "-dir=/data"]),
  );
  const port = run(["port", name, "8333/tcp"]).split("\n")[0]?.split(":").at(-1) ?? "";
  const origin = `http://127.0.0.1:${port}`;
  await waitUntilServing(origin);
  return { store: { name, origin, admin }, keys };
}

/** The S3 port answers once the filer behind it is up; an unsigned request then gets 403, never a reset. */
async function waitUntilServing(origin: string, timeoutMs = 60_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const ping = { signal: AbortSignal.timeout(2_000) };
      const res = await fetch(`${origin}/`, ping); // guard-allow: egress the loopback store this file started
      if (res.status === 403) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`object store at ${origin} did not answer within ${timeoutMs} ms`);
}

/** Removes every store this process started and their config folders. For afterAll. */
export function stopAllObjects(): void {
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

export const STOP_OBJECTS_MS = 2 * CALL_MS;

// A run that vitest ends on Ctrl-C or SIGTERM skips every afterAll; the stores still go (P1.38w).
cleanUpAtExit(stopAllObjects);
