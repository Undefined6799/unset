// P2.18p: the PDS's own S3 blobstore code, from the pinned PDS image, against the store with the PDS's scoped key.
// It runs @atproto/aws's S3BlobStore (packages/aws/src/s3.ts at atproto fb16c8e0) with the settings compose gives
// the PDS: put a temporary blob, make it permanent, read it back, quarantine and unquarantine it, delete it. That
// proves the PDS's AWS SDK and the store agree (the SDK's default checksums included, which nothing else checks),
// without an account or the whole stack. The PDS container shares the store's network namespace and nothing else.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AwsClient } from "aws4fetch";
import { afterAll, describe, expect, test } from "vitest";
import { docker, killBefore } from "../../support/docker.ts";
import { STOP_OBJECTS_MS, startObjects, stopAllObjects } from "../../support/objects.ts";

type LockEntry = { ref: string; tag: string; digest: string };
const bases = JSON.parse(
  readFileSync(join(import.meta.dirname, "../../../deployment/images/bases.lock.json"), "utf8"),
) as Record<string, LockEntry>;
const PDS = bases.pds === undefined ? undefined : `${bases.pds.ref}:${bases.pds.tag}@${bases.pds.digest}`;
const TEST_MS = 300_000;
const RUN_MS = killBefore(240_000);
const DID = "did:plc:abcdefghijklmnopqrstuvwx";
const CID = "bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku";

// Runs in the PDS image's node. The key pair comes in by environment, the test's own random pair; only the outcome
// and an error's name and message are printed.
const SCRIPT = `
const pds = require.resolve("@atproto/pds");
const { S3BlobStore } = require(require.resolve("@atproto/aws", { paths: [pds] }));
const store = S3BlobStore.creator({
  bucket: "unset-pds", endpoint: "http://127.0.0.1:8333", region: "us-east-1", forcePathStyle: true,
  credentials: { accessKeyId: process.env.KEY_ID, secretAccessKey: process.env.SECRET }, uploadTimeoutMs: 20000,
})(${JSON.stringify(DID)});
const cid = { toString: () => ${JSON.stringify(CID)} };
(async () => {
  const key = await store.putTemp(Buffer.from("blob-bytes"));
  await store.makePermanent(key, cid);
  const bytes = Buffer.from(await store.getBytes(cid)).toString();
  await store.quarantine(cid);
  await store.unquarantine(cid);
  const stored = await store.hasStored(cid);
  await store.deleteMany([cid]);
  console.log(JSON.stringify({ bytes, stored, after: await store.hasStored(cid) }));
})().catch((error) => {
  console.error(error.name + ": " + error.message);
  process.exit(1);
});
`;

afterAll(stopAllObjects, STOP_OBJECTS_MS);

describe("the PDS's blobstore in the object store (P2.18p)", () => {
  test("pds_blobstore_round_trip", { timeout: TEST_MS }, async () => {
    expect(PDS).toBeDefined();
    const { store, keys } = await startObjects([
      { name: "pds", actions: ["Read:unset-pds", "Write:unset-pds", "List:unset-pds"] },
    ]);
    const admin = new AwsClient({
      accessKeyId: store.admin.keyId,
      secretAccessKey: store.admin.secret,
      service: "s3",
      region: "us-east-1",
    });
    const created = await fetch(await admin.sign(`${store.origin}/unset-pds`, { method: "PUT" })); // guard-allow: egress the loopback store this file started
    expect(created.status).toBe(200);
    const run = docker(
      ["run", "--rm", "--network", `container:${store.name}`, "--read-only", "--user", "1000:1000"]
        .concat(["-e", `KEY_ID=${keys.pds?.keyId}`, "-e", `SECRET=${keys.pds?.secret}`])
        .concat(["--entrypoint", "node", PDS as string, "-e", SCRIPT]),
      { timeoutMs: RUN_MS },
    );
    expect(run.code, run.err.slice(-2000)).toBe(0);
    expect(JSON.parse(run.out.trim().split("\n").at(-1) ?? "{}")).toEqual({
      bytes: "blob-bytes",
      stored: true,
      after: false,
    });
  });
});
