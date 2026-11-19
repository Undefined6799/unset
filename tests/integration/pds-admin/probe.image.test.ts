// P2.09e: pds-admin's password probe against the real PDS, the base lock's pinned image (compose's PDS is that image
// with only the OAuth UI swapped, deployment/pds/pds.Dockerfile, so its XRPC and auth code are these). The fake PDS in
// harness.ts only encodes what the probe expects; this shows the pinned PDS answers that way: the right password reaches
// getAccountInfo and is NotFound for the probe's DID, a wrong one is 401, and a malformed DID is 400 whatever the
// password, because the XRPC server checks parameters before auth.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { createPds, probePassword } from "../../../interfaces/pds-admin/pds.ts";
import { docker, killBefore } from "../../support/docker.ts";

type LockEntry = { ref: string; tag: string; digest: string };
const bases = JSON.parse(
  readFileSync(join(import.meta.dirname, "../../../deployment/images/bases.lock.json"), "utf8"),
) as Record<string, LockEntry>;
const PDS = bases.pds === undefined ? undefined : `${bases.pds.ref}:${bases.pds.tag}@${bases.pds.digest}`;
const TEST_MS = 300_000;
const RUN_MS = killBefore(200_000);
const SHORT_MS = killBefore(20_000);
const PASSWORD = randomBytes(24).toString("hex");

/** The PDS's settings for a throwaway start: disk blobs and data on its tmpfs, no crawler, no PLC call made. */
const ENV = {
  PDS_HOSTNAME: "pds.test",
  PDS_PORT: "3000",
  PDS_DATA_DIRECTORY: "/tmp",
  PDS_BLOBSTORE_DISK_LOCATION: "/tmp/blocks",
  PDS_JWT_SECRET: randomBytes(32).toString("hex"),
  PDS_ADMIN_PASSWORD: PASSWORD,
  PDS_PLC_ROTATION_KEY_K256_PRIVATE_KEY_HEX: randomBytes(32).toString("hex"),
  PDS_DID_PLC_URL: "http://127.0.0.1:1",
  PDS_CRAWLERS: "",
  PDS_INVITE_REQUIRED: "true",
};

const get = (url: string) => fetch(url); // guard-allow: egress test, the loopback port this file published

async function healthy(origin: string): Promise<boolean> {
  for (let i = 0; i < 120; i++) {
    const ok = await get(`${origin}/xrpc/_health`).then(
      (res) => res.ok,
      () => false,
    );
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

describe("the password probe against the pinned PDS (P2.09e)", () => {
  test("probe_answers_match_the_pinned_pds", { timeout: TEST_MS }, async () => {
    expect(PDS).toBeDefined();
    const name = `unset-test-pds-probe-${randomBytes(6).toString("hex")}`;
    const env = Object.entries(ENV).flatMap(([key, value]) => ["-e", `${key}=${value}`]);
    const started = docker(
      ["run", "-d", "--name", name, "--read-only", "--user", "1000:1000", "--cap-drop", "ALL"].concat([
        "--tmpfs",
        "/tmp:uid=1000,gid=1000,mode=1777",
        "-p",
        "127.0.0.1::3000",
        ...env,
        PDS as string,
      ]),
      { timeoutMs: RUN_MS },
    );
    try {
      expect(started.code, started.err.slice(-2000)).toBe(0);
      const port = docker(["port", name, "3000/tcp"], { timeoutMs: SHORT_MS }).out.trim().split(":").at(-1);
      const origin = `http://127.0.0.1:${port}`;
      const up = await healthy(origin);
      expect(up, docker(["logs", "--tail", "40", name], { timeoutMs: SHORT_MS }).err.slice(-2000)).toBe(true);
      expect(await probePassword(createPds(new URL(origin), PASSWORD))).toBe("accepted");
      expect(await probePassword(createPds(new URL(origin), "not-the-admin-password"))).toBe("refused");
      // Parameters before auth: a malformed DID is 400 even with the wrong password, so the probe's DID must be valid.
      const malformed = await createPds(new URL(origin), "not-the-admin-password").getAccountInfo("not-a-did");
      expect(malformed.status).toBe(400);
    } finally {
      docker(["rm", "-f", name], { timeoutMs: SHORT_MS });
    }
  });
});
