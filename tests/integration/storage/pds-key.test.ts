// P2.18p (ADR 0041 Decision 3 and 5): the PDS's key against the real store, scoped exactly as the runbook writes its
// identity into objects_s3. It reaches every call @atproto/aws's S3BlobStore makes on unset-pds (packages/aws/src/
// s3.ts at atproto fb16c8e0: put under tmp/, copy to blocks/ and quarantine/, get, head, delete, multi-object
// delete), and nothing else: not members' drafts in unset-private, not a bucket of its own, not without a signature.
import { createHash } from "node:crypto";
import { AwsClient } from "aws4fetch";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  type ObjectsContainer,
  type ObjectsKey,
  STOP_OBJECTS_MS,
  startObjects,
  stopAllObjects,
} from "../../support/objects.ts";

/** The pds identity's actions, as docs/human/runbooks/object-store.md writes them. */
const PDS_ACTIONS = ["Read:unset-pds", "Write:unset-pds", "List:unset-pds"];
const DID = "did:plc:abcdefghijklmnopqrstuvwx";
const CID = "bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku";
let store: ObjectsContainer;
let keys: Record<string, ObjectsKey>;

/** One signed request as `key` (the admin identity when none is named). */
async function as(key: ObjectsKey, method: string, path: string, init: RequestInit = {}): Promise<Response> {
  const client = new AwsClient({
    accessKeyId: key.keyId,
    secretAccessKey: key.secret,
    service: "s3",
    region: "us-east-1",
  });
  return fetch(await client.sign(`${store.origin}${path}`, { ...init, method })); // guard-allow: egress the loopback store this file started
}
const pds = (method: string, path: string, init?: RequestInit) => as(keys.pds as ObjectsKey, method, path, init);

beforeAll(async () => {
  ({ store, keys } = await startObjects([{ name: "pds", actions: PDS_ACTIONS }]));
  for (const bucket of ["unset-pds", "unset-private"])
    expect((await as(store.admin, "PUT", `/${bucket}`)).status).toBe(200);
  // The first write into a fresh store allocates its volumes, which takes seconds; pay that here, not in a test.
  expect((await as(store.admin, "PUT", "/unset-private/drafts/x/warm-up", { body: "x" })).status).toBe(200);
}, 120_000);
afterAll(stopAllObjects, STOP_OBJECTS_MS);

describe("the PDS's key (P2.18p)", () => {
  test("pds_key_reaches_its_bucket", async () => {
    const tmp = `/unset-pds/tmp/${DID}/upload1`;
    const block = `/unset-pds/blocks/${DID}/${CID}`;
    expect((await pds("PUT", tmp, { body: "blob" })).status).toBe(200);
    // makePermanent: copyObject, then deleteObject of the temporary one.
    const copied = await pds("PUT", block, { headers: { "x-amz-copy-source": tmp } });
    expect(copied.status).toBe(200);
    expect((await pds("DELETE", tmp)).status).toBe(204);
    expect(await (await pds("GET", block)).text()).toBe("blob");
    expect((await pds("HEAD", block)).status).toBe(200);
    // quarantine and unquarantine are the same copy and delete under quarantine/.
    const quarantined = `/unset-pds/quarantine/${DID}/${CID}`;
    expect((await pds("PUT", quarantined, { headers: { "x-amz-copy-source": block } })).status).toBe(200);
    expect((await pds("DELETE", block)).status).toBe(204);
    // deleteMany: the multi-object delete.
    const body = `<Delete><Object><Key>quarantine/${DID}/${CID}</Key></Object><Quiet>true</Quiet></Delete>`;
    const md5 = createHash("md5").update(body).digest("base64");
    const deleted = await pds("POST", "/unset-pds?delete", { body, headers: { "content-md5": md5 } });
    expect(deleted.status, await deleted.text()).toBe(200);
    expect((await pds("GET", quarantined)).status).toBe(404);
  });

  test("pds_key_denied_elsewhere", async () => {
    // Members' drafts: no read, write, list or delete.
    expect((await pds("GET", "/unset-private/drafts/x/warm-up")).status).toBe(403);
    expect((await pds("PUT", `/unset-private/drafts/${DID}/i/1/a`, { body: "x" })).status).toBe(403);
    expect((await pds("GET", "/unset-private?list-type=2")).status).toBe(403);
    expect((await pds("DELETE", "/unset-private/drafts/x/warm-up")).status).toBe(403);
    expect((await as(store.admin, "GET", "/unset-private/drafts/x/warm-up")).status).toBe(200);
    // No bucket of its own, and no removing its bucket.
    expect((await pds("PUT", "/unset-pds-2")).status).toBe(403);
    expect((await pds("DELETE", "/unset-pds")).status).toBe(403);
    // Nothing without a signature, in its own bucket either.
    expect((await pds("PUT", `/unset-pds/blocks/${DID}/${CID}`, { body: "blob" })).status).toBe(200);
    const anonymous = await fetch(`${store.origin}/unset-pds/blocks/${DID}/${CID}`); // guard-allow: egress the loopback store this file started
    expect(anonymous.status).toBe(403);
  });
});
