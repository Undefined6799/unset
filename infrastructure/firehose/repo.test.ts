// P3.05s (repo.ts): a getRepo backfill is read through net-guard and verified before any record is returned. The
// stand-in PDS is a local HTTP server serving a real signed repo built with @atproto/repo (an unmanaged dependency,
// rule TE-1).
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Secp256k1Keypair } from "@atproto/crypto";
import { concatBytesAsync, getFullRepo, MemoryBlockstore, Repo, WriteOpAction } from "@atproto/repo";
import { createNetGuard } from "@unset/infrastructure-net-guard";
import { afterEach, describe, expect, test } from "vitest";
import { createRepoReader, type RepoReaderOptions } from "./repo.ts";

const DID = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
const PROFILE = "sh.unset.profile";
const SECTION = "sh.unset.card";

type Answer = { status: number; body: Uint8Array; type?: string };

const closers: (() => void)[] = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

async function stubPds(answer: () => Answer): Promise<{ url: URL; asked: string[] }> {
  const asked: string[] = [];
  const server = createServer((request, response) => {
    asked.push(request.url ?? "");
    const { status, body, type } = answer();
    response.writeHead(status, { "content-type": type ?? "application/vnd.ipld.car" });
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(() => server.close());
  return { url: new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}`), asked };
}

async function signedRepoCar(key: Secp256k1Keypair): Promise<Uint8Array> {
  const storage = new MemoryBlockstore();
  const repo = await Repo.create(storage, DID, key, [
    { action: WriteOpAction.Create, collection: PROFILE, rkey: "self", record: { $type: PROFILE, displayName: "Ada" } },
    {
      action: WriteOpAction.Create,
      collection: SECTION,
      rkey: "3jzfcijpj2z2a",
      record: { $type: SECTION, content: { $type: `${SECTION}#readme`, text: "hi" }, createdAt: "t" },
    },
    { action: WriteOpAction.Create, collection: "app.bsky.feed.post", rkey: "3jzfcijpj2z2b", record: { text: "x" } },
  ]);
  return concatBytesAsync(getFullRepo(storage, repo.cid));
}

function reader(service: URL, keys: (fresh: boolean) => string, extra: Partial<RepoReaderOptions> = {}) {
  return createRepoReader({
    service,
    guard: createNetGuard({ internalHosts: [], allowLoopback: false, commit: "c".repeat(40) }),
    signingKey: async (_did, { fresh }) => keys(fresh),
    collections: [PROFILE, SECTION],
    timeoutMs: 2_000,
    maxBytes: 1024 * 1024,
    ...extra,
  });
}

const signal = () => AbortSignal.timeout(5_000);

describe("createRepoReader", () => {
  test("repo.returns_the_verified_records_of_the_asked_collections", async () => {
    const key = await Secp256k1Keypair.create();
    const car = await signedRepoCar(key);
    const pds = await stubPds(() => ({ status: 200, body: car }));
    const snapshot = await reader(pds.url, () => key.did())(DID, signal());
    expect(pds.asked).toEqual([`/xrpc/com.atproto.sync.getRepo?did=${encodeURIComponent(DID)}`]);
    expect(snapshot.rev).toMatch(/^[a-z2-7]{13}$/);
    expect(snapshot.records.map((r) => [r.collection, r.rkey])).toEqual([
      [SECTION, "3jzfcijpj2z2a"],
      [PROFILE, "self"],
    ]);
    // A repo lists its records in key order (atproto.com/specs/repository), so a card comes before the profile.
    expect(snapshot.records[1]).toMatchObject({ kind: "put", record: { $type: PROFILE, displayName: "Ada" } });
  });

  test("repo.refuses_a_repo_signed_with_another_key", async () => {
    const car = await signedRepoCar(await Secp256k1Keypair.create());
    const other = await Secp256k1Keypair.create();
    const pds = await stubPds(() => ({ status: 200, body: car }));
    const keysAsked: boolean[] = [];
    const read = reader(pds.url, (fresh) => {
      keysAsked.push(fresh);
      return other.did();
    });
    await expect(read(DID, signal())).rejects.toMatchObject({ reason: "unverified" });
    expect(keysAsked).toEqual([false, true]); // a rotated key is looked up once before giving up
  });

  test("repo.uses_a_fresh_key_after_rotation", async () => {
    const key = await Secp256k1Keypair.create();
    const stale = await Secp256k1Keypair.create();
    const car = await signedRepoCar(key);
    const pds = await stubPds(() => ({ status: 200, body: car }));
    const snapshot = await reader(pds.url, (fresh) => (fresh ? key.did() : stale.did()))(DID, signal());
    expect(snapshot.records).toHaveLength(2);
  });

  test("repo.refuses_a_repo_of_another_did", async () => {
    const key = await Secp256k1Keypair.create();
    const car = await signedRepoCar(key);
    const pds = await stubPds(() => ({ status: 200, body: car }));
    const read = reader(pds.url, () => key.did());
    await expect(read("did:plc:bbbbbbbbbbbbbbbbbbbbbbbb", signal())).rejects.toMatchObject({ reason: "unverified" });
  });

  test("repo.refuses_a_tampered_block", async () => {
    const key = await Secp256k1Keypair.create();
    const car = await signedRepoCar(key);
    const tampered = new TextEncoder().encode("Eve");
    const at = Buffer.from(car).indexOf("Ada");
    const body = Uint8Array.from(car);
    body.set(tampered, at);
    const pds = await stubPds(() => ({ status: 200, body }));
    await expect(reader(pds.url, () => key.did())(DID, signal())).rejects.toMatchObject({ reason: "unverified" });
  });

  test.each([
    [400, "not_found"],
    [404, "not_found"],
    [502, "unavailable"],
  ])("repo.status_%i_is_%s", async (status, reason) => {
    const pds = await stubPds(() => ({ status, body: new Uint8Array(), type: "application/vnd.ipld.car" }));
    await expect(reader(pds.url, () => "unused")(DID, signal())).rejects.toMatchObject({ reason });
  });

  test("repo.reads_a_json_xrpc_error_as_its_status", async () => {
    // The PDS answers a missing or deactivated repo with a JSON XRPC error, not a CAR.
    const error = new TextEncoder().encode(JSON.stringify({ error: "RepoNotFound", message: "Could not find repo" }));
    const pds = await stubPds(() => ({ status: 400, body: error, type: "application/json" }));
    await expect(reader(pds.url, () => "unused")(DID, signal())).rejects.toMatchObject({ reason: "not_found" });
  });

  test("repo.success_must_be_a_car", async () => {
    const pds = await stubPds(() => ({ status: 200, body: new TextEncoder().encode("{}"), type: "application/json" }));
    await expect(reader(pds.url, () => "unused")(DID, signal())).rejects.toMatchObject({ reason: "unavailable" });
  });

  test("repo.refuses_a_repo_over_the_size_cap", async () => {
    const key = await Secp256k1Keypair.create();
    const car = await signedRepoCar(key);
    const pds = await stubPds(() => ({ status: 200, body: car }));
    const read = reader(pds.url, () => key.did(), { maxBytes: 64 });
    await expect(read(DID, signal())).rejects.toMatchObject({ reason: "unavailable" });
  });

  test("repo.asks_only_the_configured_origin", async () => {
    const pds = await stubPds(() => ({ status: 200, body: new Uint8Array() }));
    const read = reader(new URL("http://127.0.0.2:1"), () => "unused");
    await expect(read(DID, signal())).rejects.toMatchObject({ reason: "unavailable" });
    expect(pds.asked).toEqual([]);
  });
});
