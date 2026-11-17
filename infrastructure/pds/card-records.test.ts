// The member's sh.unset.section records (profile cards, ADR 0051), over pdsCall. The XRPC client is the real
// @atproto/api Agent over a fake fetchHandler, so the requests it sends and the errors it parses are the library's own.
import type { Did } from "@unset/domains-identity";
import type { Logger } from "@unset/shared-log";
import { describe, expect, test } from "vitest";
import { createCardRecord, deleteCardRecord, listCardRecords, saveCardRecord } from "./card-records.ts";
import { createPdsCall } from "./pds-call.ts";

const DID = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa" as Did;
const CID = "bafyreie5737gdxlw5i64vzichcalba3z2v5n6icifvx5xytvske7mr3hpm";
const CID2 = "bafyreib2rxk3rybk3aobmv5cjuql3bm2twh4jo5uxgf5kpqcsgz7soitae";
const log: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, logError: () => undefined };
const card = { $type: "sh.unset.section", content: { $type: "sh.unset.section#readme", text: "Hi" }, createdAt: "x" };

type Call = { url: URL; method: string; body: unknown };
function pds(answer: (call: Call) => Response) {
  const calls: Call[] = [];
  const { pdsCall } = createPdsCall({
    client: {
      restore: async () => ({
        async fetchHandler(url: string, init: RequestInit) {
          const text = init.body === undefined || init.body === null ? "" : await new Response(init.body).text();
          const call = {
            url: new URL(url, "https://pds.example"),
            method: init.method ?? "GET",
            body: text ? JSON.parse(text) : undefined,
          };
          calls.push(call);
          return answer(call);
        },
      }),
    },
    endSessions: async () => undefined,
    tokenSetRemains: async () => true,
    log,
  });
  const ctx = { memo: new Map(), deadline: new AbortController().signal, deadlineAt: performance.now() + 60_000 };
  return { pdsCall, ctx, calls };
}
const params = (call: Call | undefined) => Object.fromEntries(call?.url.searchParams ?? []);

describe("listCardRecords", () => {
  test("lists up to 100 section records of the member's own repo, keyed by record key", async () => {
    const { pdsCall, ctx, calls } = pds(() =>
      Response.json({
        records: [
          { uri: `at://${DID}/sh.unset.section/3jzfcijpj2z2a`, cid: CID, value: card },
          { uri: `at://${DID}/sh.unset.section/3jzfcijpj2z2b`, cid: CID2, value: card },
        ],
      }),
    );
    expect(await listCardRecords(pdsCall, ctx, DID)).toEqual({
      kind: "ok",
      value: [
        { key: "3jzfcijpj2z2a", cid: CID, value: card },
        { key: "3jzfcijpj2z2b", cid: CID2, value: card },
      ],
    });
    expect(calls[0]?.url.pathname).toBe("/xrpc/com.atproto.repo.listRecords");
    expect(params(calls[0])).toEqual({ repo: DID, collection: "sh.unset.section", limit: "100" });
  });

  test("a record from another repo or collection is never listed", async () => {
    const { pdsCall, ctx } = pds(() =>
      Response.json({
        records: [
          { uri: "at://did:plc:bbbbbbbbbbbbbbbbbbbbbbbb/sh.unset.section/3jzfcijpj2z2a", cid: CID, value: card },
          { uri: `at://${DID}/sh.unset.profile/self`, cid: CID, value: card },
        ],
      }),
    );
    expect(await listCardRecords(pdsCall, ctx, DID)).toEqual({ kind: "ok", value: [] });
  });

  test("a refusal is never read as no cards", async () => {
    const { pdsCall, ctx } = pds(() => Response.json({ error: "InvalidRequest", message: "no" }, { status: 400 }));
    expect((await listCardRecords(pdsCall, ctx, DID)).kind).not.toBe("ok");
  });
});

describe("createCardRecord", () => {
  test("creates the record and lets the PDS pick its key", async () => {
    const { pdsCall, ctx, calls } = pds(() =>
      Response.json({ uri: `at://${DID}/sh.unset.section/3jzfcijpj2z2c`, cid: CID }),
    );
    expect(await createCardRecord(pdsCall, ctx, DID, card)).toEqual({ kind: "ok", value: { key: "3jzfcijpj2z2c" } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url.pathname).toBe("/xrpc/com.atproto.repo.createRecord");
    expect(calls[0]?.body).toEqual({ repo: DID, collection: "sh.unset.section", record: card });
  });
});

describe("saveCardRecord", () => {
  test("writes over the stored card with swapRecord set to the CID it read", async () => {
    const { pdsCall, ctx, calls } = pds((call) =>
      call.url.pathname.endsWith("getRecord")
        ? Response.json({ uri: `at://${DID}/sh.unset.section/k1`, cid: CID, value: card })
        : Response.json({ uri: `at://${DID}/sh.unset.section/k1`, cid: CID2 }),
    );
    const seen: unknown[] = [];
    const result = await saveCardRecord(pdsCall, ctx, DID, "k1", (existing) => {
      seen.push(existing);
      return { ok: true, record: { ...card, width: "half" } };
    });
    expect(result).toEqual({ kind: "ok", value: { kind: "saved" } });
    expect(seen).toEqual([card]);
    expect(params(calls[0])).toEqual({ repo: DID, collection: "sh.unset.section", rkey: "k1" });
    expect(calls[1]?.body).toEqual({
      repo: DID,
      collection: "sh.unset.section",
      rkey: "k1",
      record: { ...card, width: "half" },
      swapRecord: CID,
    });
  });

  test("a card that is gone is reported, never recreated", async () => {
    const { pdsCall, ctx, calls } = pds(() =>
      Response.json({ error: "RecordNotFound", message: "Could not locate record" }, { status: 400 }),
    );
    const result = await saveCardRecord(pdsCall, ctx, DID, "k1", () => ({ ok: true, record: card }));
    expect(result).toEqual({ kind: "ok", value: { kind: "refused", code: "card.missing" } });
    expect(calls).toHaveLength(1);
  });

  test("a change made in between is a conflict", async () => {
    const { pdsCall, ctx } = pds((call) =>
      call.url.pathname.endsWith("getRecord")
        ? Response.json({ uri: `at://${DID}/sh.unset.section/k1`, cid: CID, value: card })
        : Response.json({ error: "InvalidSwap", message: "Record was at CID2" }, { status: 400 }),
    );
    const result = await saveCardRecord(pdsCall, ctx, DID, "k1", () => ({ ok: true, record: card }));
    expect(result).toEqual({ kind: "ok", value: { kind: "conflict" } });
  });
});

describe("deleteCardRecord", () => {
  test("deletes the one card from the member's own repo", async () => {
    const { pdsCall, ctx, calls } = pds(() => Response.json({}));
    expect(await deleteCardRecord(pdsCall, ctx, DID, "k1")).toEqual({ kind: "ok", value: undefined });
    expect(calls[0]?.url.pathname).toBe("/xrpc/com.atproto.repo.deleteRecord");
    expect(calls[0]?.body).toEqual({ repo: DID, collection: "sh.unset.section", rkey: "k1" });
  });
});
