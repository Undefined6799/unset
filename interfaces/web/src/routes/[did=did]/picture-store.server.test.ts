// P2.19b: the picture store bound to one member (picture-store.server.ts), over stand-ins for the image library, the
// draft store and the upload. Every call names the member and a record URI built from the card key, the use and the
// CID note run under the request's deadline, and taking a use back runs under its own, so a request out of time
// still settles (Codex review of #1860).
import { describe, expect, test } from "vitest";
import { type PictureDeps, picturesFor } from "./picture-store.server.ts";

type Did = Parameters<typeof picturesFor>[0];
type Store = PictureDeps["images"]["store"];
type DraftId = Parameters<ReturnType<typeof picturesFor>["use"]>[0];
type CardKey = Parameters<ReturnType<typeof picturesFor>["drop"]>[0];

const DID = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa" as Did;
const DRAFT = "0b6a52d4-6c1f-4bde-9b8e-2a1f6d7c3e01" as DraftId;
const KEY = "3kpicture2aaa" as CardKey;
const URI = `at://${DID}/sh.unset.card/${KEY}`;
const CID = "bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku";
const LEASE = "6c1e2f3a-4b5c-4d6e-8f70-819203a4b5c6";
const REV = "3kcommit2aaaa";

function bound(open = true) {
  const calls: { name: string; args: unknown[]; aborted: boolean | undefined }[] = [];
  const note =
    (name: string, answer: unknown = undefined) =>
    async (...args: unknown[]) => {
      const deadline = args.at(-1) as AbortSignal | null;
      calls.push({ name, args: args.slice(0, -1), aborted: deadline?.aborted });
      return answer;
    };
  const store = {
    addUse: note("addUse", { width: 3, height: 2, created: true, lease: LEASE }),
    removeUse: note("removeUse"),
    notePublished: note("notePublished"),
    settleUse: note("settleUse"),
    dropUses: note("dropUses"),
  } as unknown as Store;
  const keys: string[] = [];
  const deps: PictureDeps = {
    images: { open, store },
    drafts: {
      get: async (key) => {
        keys.push(key);
        return { ok: true, bytes: new Uint8Array([1]) };
      },
    },
    upload: async () => ({ kind: "transient", code: "pds_unavailable" }),
  };
  const expired = AbortSignal.abort();
  return { pictures: picturesFor(DID, deps, expired), calls, keys };
}

describe("picturesFor", () => {
  test("picture.bound: each call names the member, the card's record, its own draft key", async () => {
    const { pictures, calls, keys } = bound();
    await pictures.use(DRAFT, KEY);
    await pictures.published(DRAFT, CID);
    await pictures.main(DRAFT);
    expect(calls.map((c) => [c.name, c.args])).toEqual([
      ["addUse", [DID, DRAFT, URI]],
      ["notePublished", [DID, DRAFT, CID]],
    ]);
    expect(keys).toEqual([`drafts/${DID}/i/${DRAFT}/main.webp`]);
  });

  test("picture.settle_deadline: past the request's deadline a use is still taken back under its own", async () => {
    const { pictures, calls } = bound();
    await pictures.use(DRAFT, KEY);
    await pictures.release(DRAFT, KEY, LEASE);
    await pictures.settle(KEY, REV, CID, [{ id: DRAFT, lease: LEASE }]);
    await pictures.drop(KEY);
    expect(calls.map((c) => [c.name, c.aborted])).toEqual([
      ["addUse", true],
      ["removeUse", false],
      ["settleUse", false],
      ["dropUses", false],
    ]);
    expect(calls.slice(1).map((c) => c.args)).toEqual([
      [DID, DRAFT, URI, LEASE],
      [DID, URI, REV, CID, [{ id: DRAFT, lease: LEASE }]],
      [DID, URI],
    ]);
  });

  test("picture.closed: where uploads are closed no use is made, so nothing is published", async () => {
    const { pictures, calls } = bound(false);
    expect(await pictures.use(DRAFT, KEY)).toBeNull();
    expect(calls).toEqual([]);
  });
});
