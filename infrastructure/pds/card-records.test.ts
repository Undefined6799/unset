// The member's sh.unset.section records (profile cards, ADR 0051), over pdsCall. The XRPC client is the real
// @atproto/api Agent over a fake fetchHandler, so the requests it sends and the errors it parses are the library's own.
import type { Did } from "@unset/domains-identity";
import { NetGuardError } from "@unset/infrastructure-net-guard";
import type { Logger } from "@unset/shared-log";
import { describe, expect, test } from "vitest";
import {
  APPLY_WRITES_BODY_BYTES,
  createCardRecord,
  deleteCardRecord,
  latestCommit,
  listCardRecords,
  newCardKey,
  saveCardRecord,
  saveCardRecords,
} from "./card-records.ts";
import { createPdsCall } from "./pds-call.ts";

const REV = "3jzfcijpj2z2d";
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
  result.kind === "ok"
    ? { keys: result.value.cards.map((c) => c.key), complete: result.value.complete, overflow: result.value.overflow }
    : result;

describe("listCardRecords", () => {
  test("reads the member's own section records page by page, keyed by record key", async () => {
    const { pdsCall, ctx, calls } = pds(holding(23));
    const result = await listCardRecords(pdsCall, ctx, DID);
    expect(keys(result)).toEqual({
      keys: Array.from({ length: 23 }, (_, n) => rkey(n)),
      complete: true,
      overflow: false,
    });
    expect(result.kind === "ok" && result.value.cards[0]).toEqual({ key: rkey(0), cid: CID, value: card });
    expect(calls.map(params)).toEqual([
      { repo: DID, collection: "sh.unset.section", limit: "10" },
      { repo: DID, collection: "sh.unset.section", limit: "10", cursor: rkey(9) },
      { repo: DID, collection: "sh.unset.section", limit: "10", cursor: rkey(19) },
      { repo: DID, collection: "sh.unset.section", limit: "10", cursor: rkey(22) },
    ]);
  });

  test("exactly the most cards a page shows is all of them; one more is an overflow, not a cut-short read", async () => {
    expect(keys(await listCardRecords(pds(holding(100)).pdsCall, pds(holding(100)).ctx, DID))).toMatchObject({
      complete: true,
      overflow: false,
    });
    const over = pds(holding(101));
    const result = keys(await listCardRecords(over.pdsCall, over.ctx, DID));
    expect(result).toMatchObject({ complete: false, overflow: true });
    expect("keys" in result && result.keys).toHaveLength(100);
  });

  test("a page past the size cap is read again with half as many cards, down to one", async () => {
    // Card 12 is large: any page holding it with another card is past the cap; alone it fits.
    const { pdsCall, ctx, calls } = pds(holding(15, (n, limit) => n === 12 && limit > 1));
    expect(keys(await listCardRecords(pdsCall, ctx, DID))).toEqual({
      keys: Array.from({ length: 15 }, (_, n) => rkey(n)),
      complete: true,
      overflow: false,
    });
    // 0-9; 10-19 and 10-14 hold 12; 10-11; 12-15 and 12-13 hold it; 12 alone; 13-14; an empty last page.
    expect(calls.map((c) => c.url.searchParams.get("limit"))).toEqual(["10", "10", "5", "2", "4", "2", "1", "2", "4"]);
  });

  test("a page of large cards under the page budget is read in full, in a few calls", async () => {
    // Codex review of #1911: 29 Text cards of 60,000 quotation marks, about 120 KB of JSON each (3.5 MB together,
    // under the 4 MiB budget). Eight fit one response under the 1 MiB cap; nine do not.
    const quotes = { ...card, content: { $type: "sh.unset.section#readme", text: '"'.repeat(60_000) } };
    const { pdsCall, ctx, calls } = pds(holding(29, (_n, limit) => limit > 8, quotes));
    expect(keys(await listCardRecords(pdsCall, ctx, DID))).toMatchObject({ complete: true, overflow: false });
    expect(calls.length).toBeLessThanOrEqual(10);
  });

  test("one card alone past the cap stops the read before it, and the page keeps what it read", async () => {
    // Real @atproto/xrpc wraps the guard's error as its cause (XRPCError.from), which the reader looks through.
    const { pdsCall, ctx } = pds(holding(15, (n) => n === 12));
    expect(keys(await listCardRecords(pdsCall, ctx, DID))).toEqual({
      keys: Array.from({ length: 12 }, (_, n) => rkey(n)),
      complete: false,
      overflow: false,
    });
  });

  test("the read stops at its call budget and when the deadline has passed", async () => {
    // Every other card is large, so each page needs a retry and the budget runs out first.
    const slow = pds(holding(100, (n, limit) => n % 2 === 1 && limit > 1));
    const result = keys(await listCardRecords(slow.pdsCall, slow.ctx, DID));
    expect(result).toMatchObject({ complete: false, overflow: false });
    expect(slow.calls.length).toBeLessThanOrEqual(24);
    const late = pds(holding(30));
    const done = new AbortController();
    done.abort();
    const ended = await listCardRecords(late.pdsCall, { ...late.ctx, deadline: done.signal }, DID);
    expect(keys(ended)).toEqual({ keys: [], complete: false, overflow: false });
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
      overflow: false,
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
    expect(await listCardRecords(pdsCall, ctx, DID)).toEqual({
      kind: "ok",
      value: { cards: [], complete: true, overflow: false },
    });
  });
});

describe("createCardRecord", () => {
  test("card.create_named: a key web picked is sent, and newCardKey makes record keys that sort in time", async () => {
    const key = newCardKey();
    expect(key).toMatch(/^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/);
    expect(newCardKey() > key).toBe(true);
    const { pdsCall, ctx, calls } = pds(() =>
      Response.json({ uri: `at://${DID}/sh.unset.section/${key}`, cid: CID, commit: { cid: CID2, rev: REV } }),
    );
    // The commit's revision comes back, by which saves of one card settle their pictures in order.
    expect(await createCardRecord(pdsCall, ctx, DID, card, CID2, key)).toEqual({
      kind: "ok",
      value: { kind: "created", key, rev: REV },
    });
    expect(calls[0]?.body).toMatchObject({ rkey: key, swapCommit: CID2 });
  });

  test("creates the record and lets the PDS pick its key", async () => {
    const { pdsCall, ctx, calls } = pds(() =>
      Response.json({ uri: `at://${DID}/sh.unset.section/3jzfcijpj2z2c`, cid: CID }),
    );
    expect(await createCardRecord(pdsCall, ctx, DID, card, CID2)).toEqual({
      kind: "ok",
      value: { kind: "created", key: "3jzfcijpj2z2c" },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url.pathname).toBe("/xrpc/com.atproto.repo.createRecord");
    expect(calls[0]?.body).toEqual({ repo: DID, collection: "sh.unset.section", record: card, swapCommit: CID2 });
  });

  test("a repo whose commit moved on is reported as changed, and nothing is retried here", async () => {
    const { pdsCall, ctx, calls } = pds(() =>
      Response.json({ error: "InvalidSwap", message: "Commit was at bafy" }, { status: 400 }),
    );
    expect(await createCardRecord(pdsCall, ctx, DID, card, CID2)).toEqual({ kind: "ok", value: { kind: "changed" } });
    expect(calls).toHaveLength(1);
  });
});

describe("saveCardRecords", () => {
  // P1.21v follow-up (Codex on c6cddd7): the page settles words typed during a Save on the version this Save wrote,
  // never on one read later that another tab may have written. applyWrites answers each update's new CID
  // (@atproto/api 0.30.3 com.atproto.repo.applyWrites OutputSchema.results, UpdateResult { uri, cid }).
  test("each_card_written_comes_back_with_the_version_the_pds_gave_it", async () => {
    const result = (rkey: string, cid: string) => ({
      $type: "com.atproto.repo.applyWrites#updateResult",
      uri: `at://${DID}/sh.unset.section/${rkey}`,
      cid,
    });
    const { pdsCall, ctx } = pds(() =>
      Response.json({
        commit: { cid: CID, rev: REV },
        results: [result("k1", CID), result("k2", CID2), result("not-sent", CID)],
      }),
    );
    const updates = [
      { key: "k1", record: card },
      { key: "k2", record: card },
    ];
    expect(await saveCardRecords(pdsCall, ctx, DID, updates, CID2)).toEqual({
      kind: "ok",
      value: {
        kind: "saved",
        rev: REV,
        versions: [
          { key: "k1", cid: CID },
          { key: "k2", cid: CID2 },
        ],
      },
    });
  });

  test("writes every card in one applyWrites call, on the repo head it was given", async () => {
    const { pdsCall, ctx, calls } = pds(() => Response.json({ commit: { cid: CID, rev: REV } }));
    const other = { ...card, content: { ...card.content, text: "Bye" } };
    const result = await saveCardRecords(
      pdsCall,
      ctx,
      DID,
      [
        { key: "k1", record: card },
        { key: "k2", record: other },
      ],
      CID2,
    );
    expect(result).toEqual({ kind: "ok", value: { kind: "saved", rev: REV } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url.pathname).toBe("/xrpc/com.atproto.repo.applyWrites");
    expect(calls[0]?.body).toEqual({
      repo: DID,
      swapCommit: CID2,
      writes: [
        { $type: "com.atproto.repo.applyWrites#update", collection: "sh.unset.section", rkey: "k1", value: card },
        { $type: "com.atproto.repo.applyWrites#update", collection: "sh.unset.section", rkey: "k2", value: other },
      ],
    });
  });

  test("a repo whose commit moved on is reported as changed, and nothing is retried here", async () => {
    const { pdsCall, ctx, calls } = pds(() =>
      Response.json({ error: "InvalidSwap", message: "Commit was at bafy" }, { status: 400 }),
    );
    expect(await saveCardRecords(pdsCall, ctx, DID, [{ key: "k1", record: card }], CID2)).toEqual({
      kind: "ok",
      value: { kind: "changed" },
    });
    expect(calls).toHaveLength(1);
  });

  test("normal_use_fits_one_call: every card on a full page at a long length goes in one applyWrites", async () => {
    // Realistic long edits, each one call: all 100 cards a page holds at about 4 KB of text (a long section, some 650
    // words), three 40 KB essays (about 6,500 words each), and two Text cards at their 100,000-byte maximum.
    const long = (text: string) => ({ ...card, content: { ...card.content, text } });
    for (const updates of [
      Array.from({ length: 100 }, (_, n) => ({ key: rkey(n), record: long("p".repeat(4_000)) })),
      Array.from({ length: 3 }, (_, n) => ({ key: rkey(n), record: long("e".repeat(40_000)) })),
      Array.from({ length: 2 }, (_, n) => ({ key: rkey(n), record: long("f".repeat(100_000)) })),
    ]) {
      const { pdsCall, ctx, calls } = pds(() => Response.json({ commit: { cid: CID, rev: REV } }));
      expect(await saveCardRecords(pdsCall, ctx, DID, updates, CID2)).toEqual({
        kind: "ok",
        value: { kind: "saved", rev: REV },
      });
      expect(calls).toHaveLength(1);
    }
  });

  // Eleven Text cards at 100,000 bytes, about 1.1 MB: past one call's 1,000,000 bytes, inside the form's 2 MiB.
  const eleven = () =>
    Array.from({ length: 11 }, (_, n) => ({
      key: rkey(n),
      record: { ...card, content: { ...card.content, text: String(n % 10).repeat(100_000) } },
    }));

  test("eleven_full_cards_save_in_two_chained_calls, the second on the commit the first returned", async () => {
    const commits = [CID, CID2];
    const { pdsCall, ctx, calls } = pds(() => Response.json({ commit: { cid: commits[calls.length - 1], rev: REV } }));
    expect(await saveCardRecords(pdsCall, ctx, DID, eleven(), "bafyhead")).toEqual({
      kind: "ok",
      value: { kind: "saved", rev: REV },
    });
    const sent = calls.map((call) => call.body as { swapCommit: string; writes: { rkey: string }[] });
    expect(sent.map((body) => [body.swapCommit, body.writes.length])).toEqual([
      ["bafyhead", 9],
      [CID, 2],
    ]);
    expect(sent.flatMap((body) => body.writes.map((write) => write.rkey))).toEqual(eleven().map((u) => u.key));
    for (const call of calls) {
      expect(Buffer.byteLength(JSON.stringify(call.body))).toBeLessThanOrEqual(APPLY_WRITES_BODY_BYTES);
    }
  });

  test("a_foreign_write_between_batches stops the chain and names the cards already saved", async () => {
    const { pdsCall, ctx, calls } = pds(() =>
      calls.length === 1
        ? Response.json({ commit: { cid: CID, rev: REV } })
        : Response.json({ error: "InvalidSwap", message: "Commit was at bafy" }, { status: 400 }),
    );
    expect(await saveCardRecords(pdsCall, ctx, DID, eleven(), CID2)).toEqual({
      kind: "ok",
      value: {
        kind: "partial",
        saved: eleven()
          .slice(0, 9)
          .map((u) => u.key),
        rev: REV,
      },
    });
    expect(calls).toHaveLength(2);
  });

  test("an outage after the first batch is a partial save, not an outage, since the first batch is written", async () => {
    const { pdsCall, ctx, calls } = pds(() =>
      calls.length === 1 ? Response.json({ commit: { cid: CID, rev: REV } }) : new Response("", { status: 502 }),
    );
    expect(await saveCardRecords(pdsCall, ctx, DID, eleven(), CID2)).toEqual({
      kind: "ok",
      value: {
        kind: "partial",
        saved: eleven()
          .slice(0, 9)
          .map((u) => u.key),
        rev: REV,
      },
    });
  });

  test("one_card_past_the_limit_is_refused, a record no card form can make, and nothing is sent", async () => {
    // A Text card's text is at most 100,000 bytes, about 600 KB even if every character were one JSON escapes as
    // \\u0000, so no card the page writes reaches 1,000,000 bytes alone; a record past it is refused by key.
    const { pdsCall, ctx, calls } = pds(() => Response.json({}));
    const huge = { ...card, content: { ...card.content, text: "h".repeat(APPLY_WRITES_BODY_BYTES) } };
    expect(
      await saveCardRecords(
        pdsCall,
        ctx,
        DID,
        [
          { key: "k1", record: card },
          { key: "k2", record: huge },
        ],
        CID2,
      ),
    ).toEqual({ kind: "ok", value: { kind: "too_large", key: "k2" } });
    expect(calls).toHaveLength(0);
  });

  test("an empty save sends nothing", async () => {
    const { pdsCall, ctx, calls } = pds(() => Response.json({}));
    expect(await saveCardRecords(pdsCall, ctx, DID, [], CID2)).toEqual({ kind: "ok", value: { kind: "saved" } });
    expect(calls).toHaveLength(0);
  });
});

describe("latestCommit", () => {
  test("is the CID of the member's own repo head", async () => {
    const { pdsCall, ctx, calls } = pds(() => Response.json({ cid: CID2, rev: "3jzfcijpj2z2c" }));
    expect(await latestCommit(pdsCall, ctx, DID)).toEqual({ kind: "ok", value: CID2 });
    expect(calls[0]?.url.pathname).toBe("/xrpc/com.atproto.sync.getLatestCommit");
    expect(params(calls[0])).toEqual({ did: DID });
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

  test("card.save_rev: a write that made a commit answers its revision", async () => {
    const { pdsCall, ctx } = pds((call) =>
      call.url.pathname.endsWith("getRecord")
        ? Response.json({ uri: `at://${DID}/sh.unset.section/k1`, cid: CID, value: card })
        : Response.json({ uri: `at://${DID}/sh.unset.section/k1`, cid: CID2, commit: { cid: CID2, rev: REV } }),
    );
    const result = await saveCardRecord(pdsCall, ctx, DID, "k1", () => ({ ok: true, record: { ...card } }));
    expect(result).toEqual({ kind: "ok", value: { kind: "saved", rev: REV } });
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
