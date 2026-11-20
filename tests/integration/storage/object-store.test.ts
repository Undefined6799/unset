// P2.18s (ADR 0041): the object-store adapter against the real store (TE-2), with keys scoped the way the stack
// scopes them. The request path through net-guard is P2.18k's tests; here the adapter's own fetch is the platform's.
import { createObjectStore, type ObjectStore } from "@unset/infrastructure-storage";
import { AwsClient } from "aws4fetch";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  type ObjectsContainer,
  type ObjectsKey,
  STOP_OBJECTS_MS,
  startObjects,
  stopAllObjects,
} from "../../support/objects.ts";

const BUCKET = "unset-private";
const DID = "did:plc:abcdefghijklmnopqrstuvwx";
let store: ObjectsContainer;
let keys: Record<string, ObjectsKey>;

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const text = (data: Uint8Array | null): string | null => (data === null ? null : new TextDecoder().decode(data));
const adapter = (key: ObjectsKey | undefined, origin = store.origin): ObjectStore => {
  if (key === undefined) throw new Error("no such key");
  return createObjectStore({ origin, bucket: BUCKET, keyId: key.keyId, secret: key.secret, fetch });
};

/** A raw signed request as `key`, for what the adapter does not offer. */
async function signed(key: ObjectsKey | undefined, method: string, path: string): Promise<Response> {
  if (key === undefined) throw new Error("no such key");
  const client = new AwsClient({
    accessKeyId: key.keyId,
    secretAccessKey: key.secret,
    service: "s3",
    region: "us-east-1",
  });
  return fetch(await client.sign(`${store.origin}${path}`, { method }));
}

/** A raw signed request as the admin identity, to check what the adapter wrote. */
const asAdmin = (method: string, path: string): Promise<Response> => signed(store.admin, method, path);

beforeAll(async () => {
  ({ store, keys } = await startObjects([
    {
      name: "web",
      actions: [`Read:${BUCKET}/drafts/*`, `Write:${BUCKET}/drafts/*`, `Tagging:${BUCKET}/drafts/*`, `List:${BUCKET}`],
    },
    { name: "media", actions: [`Read:${BUCKET}/drafts/*`, `Read:${BUCKET}/media/*`] },
    // The media process's identity exactly as the stacks write it (scripts/ci/local-stack.ts objectsIdentities; book
    // P2.19): one action, reading drafts.
    { name: "mediaProcess", actions: [`Read:${BUCKET}/drafts/*`] },
  ]));
  expect((await asAdmin("PUT", `/${BUCKET}`)).status).toBe(200);
  // The first write into a fresh store allocates its volumes, which takes seconds; pay that here, not in a test.
  expect((await asAdmin("PUT", `/${BUCKET}/warm-up`)).status).toBe(200);
}, 120_000);
afterAll(stopAllObjects, STOP_OBJECTS_MS);

describe("object store", () => {
  test("objects_round_trip", async () => {
    const web = adapter(keys.web);
    const key = `drafts/${DID}/i/0b6f/avatar_256.webp`;
    expect(await web.put(key, bytes("pixels"), "image/webp")).toEqual({ ok: true });
    expect(text(((await web.get(key)) as { bytes: Uint8Array | null }).bytes)).toBe("pixels");
    expect(await web.get(`drafts/${DID}/i/0b6f/missing.webp`)).toEqual({ ok: true, bytes: null });
    const head = await asAdmin("HEAD", `/${BUCKET}/${key}`);
    expect(head.headers.get("content-type")).toBe("image/webp");
  });

  test("objects_tags", async () => {
    const web = adapter(keys.web);
    const key = `drafts/${DID}/v/1/upload`;
    expect(await web.put(key, bytes("v"), "video/mp4", { lifecycle: "expire" })).toEqual({ ok: true });
    expect(await (await asAdmin("GET", `/${BUCKET}/${key}?tagging`)).text()).toContain(
      "<Key>lifecycle</Key><Value>expire</Value>",
    );
    expect(await web.setTags(key, {})).toEqual({ ok: true });
    expect(await (await asAdmin("GET", `/${BUCKET}/${key}?tagging`)).text()).not.toContain("lifecycle");
  });

  test("objects_list_pages", async () => {
    const web = adapter(keys.web);
    const prefix = `drafts/${DID}/i/many/`;
    for (let i = 0; i < 1005; i += 1) await web.put(`${prefix}${String(i).padStart(4, "0")}`, bytes("x"), "text/plain");
    const listed = await web.list(prefix);
    expect(listed.ok && listed.keys.length).toBe(1005);
    expect(listed.ok && listed.keys[1004]).toBe(`${prefix}1004`);
  }, 120_000);

  test("objects_delete_prefix", async () => {
    const web = adapter(keys.web);
    const prefix = `drafts/${DID}/i/many/`;
    const kept = `drafts/${DID}/i/other/a`;
    await web.put(kept, bytes("k"), "text/plain");
    expect(await web.deletePrefix(prefix)).toEqual({ ok: true, deleted: 1005 });
    expect(await web.list(prefix)).toEqual({ ok: true, keys: [] });
    expect(text(((await web.get(kept)) as { bytes: Uint8Array | null }).bytes)).toBe("k");
    expect(await web.deletePrefix(prefix)).toEqual({ ok: true, deleted: 0 });
  }, 120_000);

  test("objects_key_scoped_to_prefix", async () => {
    const web = adapter(keys.web);
    const media = adapter(keys.media);
    const draft = `drafts/${DID}/i/scoped/a`;
    await web.put(draft, bytes("d"), "text/plain");
    expect(await web.put(`media/${DID}/r/1/360.mp4`, bytes("m"), "video/mp4")).toEqual({
      ok: false,
      code: "objects.unavailable",
    });
    expect(text(((await media.get(draft)) as { bytes: Uint8Array | null }).bytes)).toBe("d");
    expect(await media.put(draft, bytes("overwrite"), "text/plain")).toEqual({
      ok: false,
      code: "objects.unavailable",
    });
    expect(await media.deletePrefix(`drafts/${DID}/`)).toEqual({ ok: false, code: "objects.unavailable" });
    expect(text(((await web.get(draft)) as { bytes: Uint8Array | null }).bytes)).toBe("d");
  });

  // P2.19: the media process's identity can read a draft and nothing else. A direct delete, a listing, a read outside
  // drafts/ and a multipart-uploads listing are each refused. SeaweedFS 4.53 checks the multipart listing as Read on
  // the bucket itself (weed/s3api/s3api_server.go:1029, ACTION_READ; auth_credentials.go:2109-2160 CanDo matches
  // `Read:<bucket>` against the identity's patterns), which `Read:unset-private/drafts/*` does not match.
  test("objects_media_process_reads_drafts_only", async () => {
    const web = adapter(keys.web);
    const media = adapter(keys.mediaProcess);
    const draft = `drafts/${DID}/i/media-only/a`;
    const outside = `pds/${DID}/blob`;
    await web.put(draft, bytes("d"), "text/plain");
    expect((await asAdmin("PUT", `/${BUCKET}/${outside}`)).status).toBe(200);
    expect(text(((await media.get(draft)) as { bytes: Uint8Array | null }).bytes)).toBe("d");
    expect((await signed(keys.mediaProcess, "DELETE", `/${BUCKET}/${draft}`)).status).toBe(403);
    expect(await media.list(`drafts/${DID}/`)).toEqual({ ok: false, code: "objects.unavailable" });
    expect(await media.get(outside)).toEqual({ ok: false, code: "objects.unavailable" });
    expect((await signed(keys.mediaProcess, "GET", `/${BUCKET}?uploads`)).status).toBe(403);
    expect(text(((await web.get(draft)) as { bytes: Uint8Array | null }).bytes)).toBe("d");
  });

  test("objects_errors_carry_no_key", async () => {
    const wrong = adapter({ keyId: keys.web?.keyId ?? "", secret: "not-the-secret" });
    const result = await wrong.get(`drafts/${DID}/i/0b6f/avatar_256.webp`);
    expect(result).toEqual({ ok: false, code: "objects.unavailable" });
    expect(JSON.stringify(result)).not.toContain(DID);
  });
});
