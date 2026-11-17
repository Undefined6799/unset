// The member's sh.unset.section records (profile cards, ADR 0051), over pdsCall. The XRPC client is the real
// @atproto/api Agent over a fake fetchHandler, so the requests it sends and the errors it parses are the library's own.
import type { Did } from "@unset/domains-identity";
import { NetGuardError } from "@unset/infrastructure-net-guard";
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

const rkey = (n: number) => `3jzfcijpj2z${String(n).padStart(3, "0")}`;
const record = (n: number, value: unknown = card) => ({
  uri: `at://${DID}/sh.unset.section/${rkey(n)}`,
  cid: CID,
  value,
});
/** A PDS holding `count` cards, paged by rkey as listRecords pages (cursor = the last key returned). */
function holding(count: number, refuse: (n: number, limit: number) => boolean = () => false, value: unknown = card) {
  return (call: Call) => {
    const limit = Number(call.url.searchParams.get("limit"));
    const after = call.url.searchParams.get("cursor");
    const from = after === null ? 0 : Number(after.slice(-3)) + 1;
    const page = Array.from({ length: Math.max(0, Math.min(limit, count - from)) }, (_, i) => from + i);
    if (page.some((n) => refuse(n, limit))) throw new NetGuardError("egress.too_large");
    const last = page.at(-1);
    return Response.json({
      records: page.map((n) => record(n, value)),
      ...(last === undefined ? {} : { cursor: rkey(last) }),
    });
  };
}
const keys = (result: Awaited<ReturnType<typeof listCardRecords>>) =>
  result.kind === "ok" ? { keys: result.value.cards.map((c) => c.key), complete: result.value.complete } : result;

describe("listCardRecords", () => {
  test("reads the member's own section records page by page, keyed by record key", async () => {
    const { pdsCall, ctx, calls } = pds(holding(23));
    const result = await listCardRecords(pdsCall, ctx, DID);
    expect(keys(result)).toEqual({ keys: Array.from({ length: 23 }, (_, n) => rkey(n)), complete: true });
    expect(result.kind === "ok" && result.value.cards[0]).toEqual({ key: rkey(0), cid: CID, value: card });
    expect(calls.map(params)).toEqual([
      { repo: DID, collection: "sh.unset.section", limit: "10" },
      { repo: DID, collection: "sh.unset.section", limit: "10", cursor: rkey(9) },
      { repo: DID, collection: "sh.unset.section", limit: "10", cursor: rkey(19) },
      { repo: DID, collection: "sh.unset.section", limit: "10", cursor: rkey(22) },
    ]);
  });

  test("exactly the most cards a page shows is all of them; one more is not", async () => {
    expect(keys(await listCardRecords(pds(holding(100)).pdsCall, pds(holding(100)).ctx, DID))).toMatchObject({
      complete: true,
    });
    const over = pds(holding(101));
    const result = keys(await listCardRecords(over.pdsCall, over.ctx, DID));
    expect(result).toMatchObject({ complete: false });
    expect("keys" in result && result.keys).toHaveLength(100);
  });

  test("a page past the size cap is read again one card at a time", async () => {
    // Card 12 is large: any page holding it with another card is past the cap; alone it fits.
    const { pdsCall, ctx, calls } = pds(holding(15, (n, limit) => n === 12 && limit > 1));
    expect(keys(await listCardRecords(pdsCall, ctx, DID))).toEqual({
      keys: Array.from({ length: 15 }, (_, n) => rkey(n)),
      complete: true,
    });
    expect(calls.map((c) => c.url.searchParams.get("limit"))).toEqual(["10", "10", "1", "1", "1", "1", "1", "1"]);
  });

  test("one card alone past the cap stops the read before it, and the page keeps what it read", async () => {
    // Real @atproto/xrpc wraps the guard's error as its cause (XRPCError.from), which the reader looks through.
    const { pdsCall, ctx } = pds(holding(15, (n) => n === 12));
    expect(keys(await listCardRecords(pdsCall, ctx, DID))).toEqual({
      keys: Array.from({ length: 12 }, (_, n) => rkey(n)),
      complete: false,
    });
  });

  test("the read stops at its call budget and when the deadline has passed", async () => {
    // Every other card is large, so each page needs a retry and the budget runs out first.
    const slow = pds(holding(100, (n, limit) => n % 2 === 1 && limit > 1));
    const result = keys(await listCardRecords(slow.pdsCall, slow.ctx, DID));
    expect(result).toMatchObject({ complete: false });
    expect(slow.calls.length).toBeLessThanOrEqual(24);
    const late = pds(holding(30));
    const done = new AbortController();
    done.abort();
    const ended = await listCardRecords(late.pdsCall, { ...late.ctx, deadline: done.signal }, DID);
    expect(keys(ended)).toEqual({ keys: [], complete: false });
    expect(late.calls).toEqual([]);
  });

  test("the byte budget counts UTF-8 bytes, so multibyte cards meet the same bound", async () => {
    // 100 cards of 15,000 CJK characters: 1.5 million UTF-16 units but 4.5 MB of UTF-8, past the 4 MiB budget.
    const big = { ...card, content: { $type: "sh.unset.section#readme", text: "\u6f22".repeat(15_000) } };
    const { pdsCall, ctx } = pds(holding(100, () => false, big));
    expect(keys(await listCardRecords(pdsCall, ctx, DID))).toMatchObject({ complete: false });
  });

  test("a failure before any card is the failure; after some, the list is incomplete", async () => {
    const refused = pds(() => Response.json({ error: "InvalidRequest", message: "no" }, { status: 400 }));
    expect((await listCardRecords(refused.pdsCall, refused.ctx, DID)).kind).not.toBe("ok");
    const pages = holding(30);
    const flaky = pds((call) =>
      call.url.searchParams.has("cursor") ? new Response(null, { status: 502 }) : pages(call),
    );
    expect(keys(await listCardRecords(flaky.pdsCall, flaky.ctx, DID))).toEqual({
      keys: Array.from({ length: 10 }, (_, n) => rkey(n)),
      complete: false,
    });
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
    expect(await listCardRecords(pdsCall, ctx, DID)).toEqual({ kind: "ok", value: { cards: [], complete: true } });
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
