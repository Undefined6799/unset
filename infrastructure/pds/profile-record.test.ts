// The member's sh.unset.profile record, read over pdsCall. The XRPC client is the real @atproto/api Agent over a fake
// fetchHandler, so the request it sends and the error it parses are the library's own.
import type { Did } from "@unset/domains-identity";
import type { Logger } from "@unset/shared-log";
import { expect, test } from "vitest";
import { createPdsCall } from "./pds-call.ts";
import { loadProfileRecord, saveProfileRecord } from "./profile-record.ts";

const DID = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa" as Did;
const CID = "bafyreie5737gdxlw5i64vzichcalba3z2v5n6icifvx5xytvske7mr3hpm";
const log: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, logError: () => undefined };

function load(answer: (url: URL) => Response) {
  const urls: URL[] = [];
  const { pdsCall } = createPdsCall({
    client: {
      restore: async () => ({
        async fetchHandler(url: string) {
          const parsed = new URL(url, "https://pds.example");
          urls.push(parsed);
          return answer(parsed);
        },
      }),
    },
    endSessions: async () => undefined,
    tokenSetRemains: async () => true,
    log,
  });
  const ctx = { memo: new Map(), deadline: new AbortController().signal, deadlineAt: Date.now() + 60_000 };
  return { result: loadProfileRecord(pdsCall, ctx, DID), urls };
}

test("reads the self record of the member's own repo", async () => {
  const value = { $type: "sh.unset.profile", displayName: "Alice", createdAt: "2026-10-23T03:00:00.000Z" };
  const { result, urls } = load(() => Response.json({ uri: `at://${DID}/sh.unset.profile/self`, cid: CID, value }));
  expect(await result).toEqual({ kind: "ok", value: { value, cid: CID } });
  expect(urls[0]?.pathname).toBe("/xrpc/com.atproto.repo.getRecord");
  expect(Object.fromEntries(urls[0]?.searchParams ?? [])).toEqual({
    repo: DID,
    collection: "sh.unset.profile",
    rkey: "self",
  });
});

test("no record yet is not a failure", async () => {
  const { result } = load(() =>
    Response.json({ error: "RecordNotFound", message: "Could not locate record" }, { status: 400 }),
  );
  expect(await result).toEqual({ kind: "ok", value: null });
});

test("another refusal is never read as an empty profile", async () => {
  const { result } = load(() => Response.json({ error: "InvalidRequest", message: "no" }, { status: 400 }));
  expect((await result).kind).not.toBe("ok");
});

function save(answer: (url: URL, body: unknown) => Response) {
  const calls: { url: URL; body: unknown }[] = [];
  const { pdsCall } = createPdsCall({
    client: {
      restore: async () => ({
        async fetchHandler(url: string, init: RequestInit) {
          const parsed = new URL(url, "https://pds.example");
          const text = init.body === undefined || init.body === null ? "" : await new Response(init.body).text();
          const body: unknown = text === "" ? undefined : JSON.parse(text);
          calls.push({ url: parsed, body });
          return answer(parsed, body);
        },
      }),
    },
    endSessions: async () => undefined,
    tokenSetRemains: async () => true,
    log,
  });
  const ctx = { memo: new Map(), deadline: new AbortController().signal, deadlineAt: Date.now() + 60_000 };
  const seen: unknown[] = [];
  const result = saveProfileRecord(pdsCall, ctx, DID, (existing) => {
    seen.push(existing);
    return {
      ok: true,
      record: { $type: "sh.unset.profile", displayName: "New", createdAt: "2026-10-23T03:00:00.000Z" },
    };
  });
  return { result, calls, seen };
}

const STORED = { $type: "sh.unset.profile", displayName: "Old", createdAt: "2026-10-01T00:00:00.000Z" };
const PUT_OK = () => Response.json({ uri: `at://${DID}/sh.unset.profile/self`, cid: CID });

test("an update swaps on the stored record's CID", async () => {
  const { result, calls, seen } = save((url) =>
    url.pathname.endsWith("getRecord")
      ? Response.json({ uri: `at://${DID}/sh.unset.profile/self`, cid: CID, value: STORED })
      : PUT_OK(),
  );
  expect(await result).toEqual({ kind: "ok", value: { kind: "saved" } });
  expect(seen).toEqual([STORED]);
  expect(calls[1]?.url.pathname).toBe("/xrpc/com.atproto.repo.putRecord");
  expect(calls[1]?.body).toEqual({
    repo: DID,
    collection: "sh.unset.profile",
    rkey: "self",
    record: { $type: "sh.unset.profile", displayName: "New", createdAt: "2026-10-23T03:00:00.000Z" },
    swapRecord: CID,
  });
});

test("a first profile is written only if none exists yet", async () => {
  const { result, calls, seen } = save((url) =>
    url.pathname.endsWith("getRecord")
      ? Response.json({ error: "RecordNotFound", message: "none" }, { status: 400 })
      : PUT_OK(),
  );
  expect(await result).toEqual({ kind: "ok", value: { kind: "saved" } });
  expect(seen).toEqual([null]);
  // A null swap tells the PDS the record must not exist, so a profile another save created meanwhile is a conflict.
  expect(calls[1]?.body).toHaveProperty("swapRecord", null);
});

test("a record changed since it was read is a conflict, not a save", async () => {
  const { result } = save((url) =>
    url.pathname.endsWith("getRecord")
      ? Response.json({ uri: `at://${DID}/sh.unset.profile/self`, cid: CID, value: STORED })
      : Response.json({ error: "InvalidSwap", message: "Record was at bafy..." }, { status: 400 }),
  );
  expect(await result).toEqual({ kind: "ok", value: { kind: "conflict" } });
});

test("a refused build writes nothing", async () => {
  const calls: URL[] = [];
  const { pdsCall } = createPdsCall({
    client: {
      restore: async () => ({
        async fetchHandler(url: string) {
          calls.push(new URL(url, "https://pds.example"));
          return Response.json({ error: "RecordNotFound", message: "none" }, { status: 400 });
        },
      }),
    },
    endSessions: async () => undefined,
    tokenSetRemains: async () => true,
    log,
  });
  const ctx = { memo: new Map(), deadline: new AbortController().signal, deadlineAt: Date.now() + 60_000 };
  const result = await saveProfileRecord(pdsCall, ctx, DID, () => ({ ok: false, code: "profile.name_required" }));
  expect(result).toEqual({ kind: "ok", value: { kind: "refused", code: "profile.name_required" } });
  expect(calls.map((url) => url.pathname)).toEqual(["/xrpc/com.atproto.repo.getRecord"]);
});
