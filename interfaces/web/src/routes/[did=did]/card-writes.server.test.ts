// Ported from interfaces/http/card-writes.test.ts (P1.20i); that copy goes with P1.20k. The cases are unchanged; the
// domain and PDS types are read off the module under test, since a test beside a route imports no domain
// (svelte-screens-no-core), and the fixture card is written as parseCardInput gives it.
// The card writes (ADR 0051) over a stand-in store: what each PDS answer becomes for the route.
import { describe, expect, test } from "vitest";
import { type CardStore, type CardWrites, cardWrites } from "./card-writes.server.ts";

type ListResult = Awaited<ReturnType<CardStore["list"]>>;
type PdsResult<T> = { readonly kind: "ok"; readonly value: T } | Exclude<ListResult, { kind: "ok" }>;
type StoredCard = Extract<ListResult, { kind: "ok" }>["value"]["cards"][number];
type CardKey = Parameters<CardWrites["remove"]>[0];
type Written = Extract<Awaited<ReturnType<CardStore["write"]>>, { kind: "ok" }>["value"];
type CardContent = Parameters<CardWrites["create"]>[0];
const OWNER = "did:plc:ewvi7nxzyoun6zhxrhs64oiz" as Parameters<typeof cardWrites>[0];
/** The profile's card list as it is written: the owner's card addresses (ADR 0086). */
const listed = (...keys: string[]) => keys.map((k) => ({ uri: `at://${OWNER}/sh.unset.card/${k}` }));

const NOW = "2026-11-17T06:00:00.000Z";
const T1 = "2026-11-01T00:00:00.000Z";
const ok = <T>(value: T): PdsResult<T> => ({ kind: "ok", value });
const readme = (text: string) => ({
  $type: "sh.unset.card",
  content: { $type: "sh.unset.block.text", text },
  createdAt: T1,
});
/** A README card as parseCardInput reads `{ kind: "readme", text }`. */
const input = (text = "Hello") => ({ content: { kind: "readme", text } as CardContent, width: "full" as const });
const KEY = "3k2abc" as CardKey;
const NEW_KEY = "3knewkey2aaaa" as CardKey;

type CardVersion = Parameters<CardWrites["saveAll"]>[0][number]["version"];
type Calls = {
  created: unknown[];
  swaps: string[];
  saved: unknown[];
  removed: string[];
  profile: unknown[];
  many: { updates: unknown[]; swapCommit: string }[];
};
const HEAD = "bafyhead";

/** The stored profile: it lists the two stored cards, so both show (ADR 0086 point 3). */
const PROFILE = { $type: "sh.unset.profile", displayName: "A", createdAt: T1, cards: listed("a", "b") };

/**
 * A store over two listed cards. Each card-and-list write is recorded (the card created or removed, the profile it
 * wrote, the head it swapped on) and answered from `answers` in turn, then as written.
 */
function store(over: Partial<CardStore> = {}, stored: unknown = PROFILE, answers: readonly Written["kind"][] = []) {
  const calls: Calls = { created: [], swaps: [], saved: [], removed: [], profile: [], many: [] };
  const queue = [...answers];
  const base: CardStore = {
    list: async () =>
      ok({
        cards: [
          { key: "a", value: readme("A"), cid: "c" },
          { key: "b", value: readme("B"), cid: "c" },
        ],
        complete: true,
        overflow: false,
      }),
    head: async () => ok(HEAD),
    profile: async () => ok(stored === null ? null : { value: stored, cid: "p" }),
    newKey: () => NEW_KEY,
    write: async (change, swapCommit) => {
      calls.swaps.push(swapCommit);
      if (change.card?.kind === "create") calls.created.push(change.card.record);
      if (change.card?.kind === "delete") calls.removed.push(change.card.key);
      if (change.profile !== undefined) calls.profile.push({ ok: true, ...change.profile });
      return ok({ kind: queue.shift() ?? "written" } as Written);
    },
    save: async (key, build) => {
      const built = build(readme("old"));
      calls.saved.push({ key, built });
      return ok(built.ok ? { kind: "saved" } : { kind: "refused", code: built.code });
    },
    saveMany: async (updates, swapCommit) => {
      calls.many.push({ updates: [...updates], swapCommit });
      return ok({ kind: "saved" });
    },
    saveProfile: async (build) => {
      const built = build(stored);
      calls.profile.push(built);
      return ok(built.ok ? { kind: "saved" } : { kind: "refused", code: built.code });
    },
  };
  // No picture card here (card-pictures.server.test.ts): a delete's use cleanup is the one call that reaches these.
  const pictures = {
    use: async () => null,
    release: async () => undefined,
    main: async () => ({ kind: "missing" }) as const,
    upload: async () => ({ kind: "transient", code: "pds_unavailable" }) as const,
    published: async () => undefined,
    settle: async () => undefined,
    drop: async () => undefined,
  };
  return { writes: cardWrites(OWNER, { ...base, ...over }, () => NOW, pictures), calls };
}

describe("cardWrites", () => {
  test("a new card is built from the checked input and created", async () => {
    const { writes, calls } = store();
    const { content, width } = input("Hi");
    expect(await writes.create(content, width)).toEqual({ kind: "saved" });
    expect(calls.created).toEqual([
      { $type: "sh.unset.card", content: { $type: "sh.unset.block.text", text: "Hi" }, createdAt: NOW },
    ]);
  });

  test("card.create_listed: a new card is written with the profile listing it last, in the same write", async () => {
    // ADR 0086 point 3: only listed cards show, so a card and its entry land together or not at all.
    const { writes, calls } = store();
    expect(await writes.create(input().content, "full")).toEqual({ kind: "saved" });
    expect(calls.profile).toEqual([
      { ok: true, exists: true, record: { ...PROFILE, cards: listed("a", "b", NEW_KEY) } },
    ]);
    expect(calls.swaps).toEqual([HEAD]);
  });

  test("card.create_once: a new card takes the key its form named", async () => {
    const formKey = "3kformkey2aaa" as CardKey;
    const { writes, calls } = store();
    expect(await writes.create(input().content, "full", undefined, formKey)).toEqual({ kind: "saved" });
    expect(calls.profile).toEqual([
      { ok: true, exists: true, record: { ...PROFILE, cards: listed("a", "b", formKey) } },
    ]);
  });

  test("card.create_once: the same form sent again after its card landed is saved, and nothing more is written", async () => {
    const { writes, calls } = store();
    expect(await writes.create(input().content, "full", undefined, "a" as CardKey)).toEqual({ kind: "saved" });
    expect(calls.swaps).toEqual([]);
  });

  test("card.create_once: two sends at once write one card; the second finds it on the read after its swap failed", async () => {
    const card = (key: string) => ({ key, value: readme("A"), cid: "c" });
    const lists = [
      [card("a"), card("b")],
      [card("a"), card("b"), card(NEW_KEY)],
    ];
    const list = async () => ok({ cards: lists.shift() ?? [], complete: true, overflow: false });
    const { writes, calls } = store({ list }, PROFILE, ["changed"]);
    expect(await writes.create(input().content, "full", undefined, NEW_KEY)).toEqual({ kind: "saved" });
    expect(calls.created).toHaveLength(1); // the try the PDS refused, as the first send had landed
  });

  test("a card cannot be added before there is a profile to list it, and nothing is written", async () => {
    const { writes, calls } = store({}, null);
    expect(await writes.create(input().content, "full")).toEqual({ kind: "failed", code: "profile.name_required" });
    expect(calls.swaps).toEqual([]);
  });

  test("a member with the most cards a page shows cannot add another", async () => {
    const full = Array.from({ length: 50 }, (_, n) => ({ key: `k${n}`, value: readme("A"), cid: "c" }));
    const { writes, calls } = store({ list: async () => ok({ cards: full, complete: true, overflow: false }) });
    const { content, width } = input();
    expect(await writes.create(content, width)).toEqual({ kind: "failed", code: "card.too_many" });
    expect(calls.created).toEqual([]);
  });

  // C3 (outside review 2026-11-19): the count and the create are tied to one repo state. The create swaps on the
  // commit read before the count, so a card added elsewhere in between (another tab) makes the PDS refuse it.
  test("a new card is created only on the repo state its count was read from", async () => {
    const { writes, calls } = store();
    expect(await writes.create(input().content, "full")).toEqual({ kind: "saved" });
    expect(calls.swaps).toEqual([HEAD]);
  });

  test("a repo that changed meanwhile is counted again once, and the card is added if there is still room", async () => {
    const heads = ["h1", "h2"];
    const { writes, calls } = store({ head: async () => ok(heads.shift() ?? "none") }, PROFILE, ["changed"]);
    expect(await writes.create(input().content, "full")).toEqual({ kind: "saved" });
    expect(calls.swaps).toEqual(["h1", "h2"]);
  });

  test("two tabs at 49 cards: the second count sees 50 and nothing more is written", async () => {
    const at = (n: number) => Array.from({ length: n }, (_, i) => ({ key: `k${i}`, value: readme("A"), cid: "c" }));
    const lists = [at(49), at(50)];
    const list = async () => ok({ cards: lists.shift() ?? [], complete: true, overflow: false });
    const { writes, calls } = store({ list }, PROFILE, ["changed"]);
    expect(await writes.create(input().content, "full")).toEqual({ kind: "failed", code: "card.too_many" });
    expect(calls.created).toHaveLength(1); // the first try, which the PDS refused: nothing was written
  });

  test("a repo that keeps changing is not tried a third time; the member is asked to save again", async () => {
    const { writes, calls } = store({}, PROFILE, ["changed", "changed"]);
    expect(await writes.create(input().content, "full")).toEqual({ kind: "failed", code: "card.cards_changed" });
    expect(calls.created).toHaveLength(2);
  });

  test("more cards than a page shows: adding says the page is full and moving says delete one first", async () => {
    const over = Array.from({ length: 100 }, (_, n) => ({ key: `k${n}`, value: readme("A"), cid: "c" }));
    const { writes, calls } = store({ list: async () => ok({ cards: over, complete: false, overflow: true }) });
    expect(await writes.create(input().content, "full")).toEqual({ kind: "failed", code: "card.too_many" });
    expect(await writes.reorder(over.map((card) => card.key))).toEqual({ kind: "failed", code: "card.overflow" });
    expect(await writes.remove("k5" as CardKey)).toEqual({ kind: "saved" });
    expect([calls.created, calls.profile, calls.removed]).toEqual([[], [], ["k5"]]);
  });

  test("an edit is built over the stored card and saved under its key", async () => {
    const { writes, calls } = store();
    const { content, width } = input("New");
    expect(await writes.save(KEY, content, width)).toEqual({ kind: "saved" });
    expect(calls.saved).toMatchObject([{ key: KEY, built: { ok: true, record: { createdAt: T1 } } }]);
  });

  test("a card that is gone or changed elsewhere is refused with its own code", async () => {
    const gone = { kind: "refused", code: "card.missing" } as const;
    const { content, width } = input();
    expect(await store({ save: async () => ok(gone) }).writes.save(KEY, content, width)).toEqual({
      kind: "failed",
      code: "card.missing",
    });
    expect(await store({ save: async () => ok({ kind: "conflict" }) }).writes.save(KEY, content, width)).toEqual({
      kind: "failed",
      code: "card.conflict",
    });
  });

  test("card.remove_listed: a delete removes the card and its entry in the profile's list, in one write", async () => {
    const { writes, calls } = store();
    expect(await writes.remove("a" as CardKey)).toEqual({ kind: "saved" });
    expect(calls.removed).toEqual(["a"]);
    expect(calls.profile).toEqual([{ ok: true, exists: true, record: { ...PROFILE, cards: listed("b") } }]);
    expect(calls.swaps).toEqual([HEAD]);
  });

  test("a card already gone leaves the list; one never listed is deleted alone; neither is an error", async () => {
    const gone = store({}, { ...PROFILE, cards: listed("a", "b", KEY) });
    expect(await gone.writes.remove(KEY)).toEqual({ kind: "saved" });
    expect([gone.calls.removed, gone.calls.profile]).toMatchObject([[], [{ record: { cards: listed("a", "b") } }]]);
    const unlisted = store({}, { ...PROFILE, cards: listed("b") });
    expect(await unlisted.writes.remove("a" as CardKey)).toEqual({ kind: "saved" });
    expect([unlisted.calls.removed, unlisted.calls.profile]).toEqual([["a"], []]);
  });

  test("a delete on a repo that changed meanwhile is read again once, then the member is asked again", async () => {
    const once = store({}, PROFILE, ["changed"]);
    expect(await once.writes.remove("a" as CardKey)).toEqual({ kind: "saved" });
    expect(once.calls.swaps).toHaveLength(2);
    const busy = store({}, PROFILE, ["changed", "changed"]);
    expect(await busy.writes.remove("a" as CardKey)).toEqual({ kind: "failed", code: "card.cards_changed" });
  });

  test("a card the cut-short list does not hold cannot be judged, so nothing is deleted", async () => {
    const cut = { cards: [{ key: "a", value: readme("A"), cid: "c" }], complete: false, overflow: false };
    const { writes, calls } = store({ list: async () => ok(cut) });
    expect(await writes.remove(KEY)).toEqual({ kind: "failed", code: "card.list_incomplete" });
    expect(calls.swaps).toEqual([]);
  });

  test("a list the read cut short is not a count: adding and moving are refused, nothing is written", async () => {
    const cut = { cards: [{ key: "a", value: readme("A"), cid: "c" }], complete: false, overflow: false };
    const { writes, calls } = store({ list: async () => ok(cut) });
    const { content, width } = input();
    expect(await writes.create(content, width)).toEqual({ kind: "failed", code: "card.list_incomplete" });
    expect(await writes.reorder(["a"])).toEqual({ kind: "failed", code: "card.list_incomplete" });
    expect([calls.created, calls.profile]).toEqual([[], []]);
  });

  test("a reorder names each shown card once and writes the order into the profile", async () => {
    const { writes, calls } = store();
    expect(await writes.reorder(["b", "a"])).toEqual({ kind: "saved" });
    expect(calls.profile).toMatchObject([{ ok: true, record: { displayName: "A", cards: listed("b", "a") } }]);
  });

  test("a hidden card is not part of the order, so the page's order still matches", async () => {
    const cards: StoredCard[] = [
      { key: "a", value: readme("A"), cid: "c" },
      { key: "h", value: { $type: "sh.unset.card", content: { $type: "x" } }, cid: "c" },
      { key: "bad/key", value: readme("B"), cid: "c" },
    ];
    const list = async () => ok({ cards, complete: true, overflow: false });
    const { writes, calls } = store({ list }, { ...PROFILE, cards: listed("h", "a") });
    expect(await writes.reorder(["a"])).toEqual({ kind: "saved" });
    // The hidden card's entry stays, after the ordered ones, so a newer version can still show it (ADR 0038).
    expect(calls.profile).toMatchObject([{ ok: true, record: { cards: listed("a", "h") } }]);
  });

  test("an order that is not exactly the shown cards is refused before any write", async () => {
    const { writes, calls } = store();
    for (const order of [["a"], ["a", "a"], ["a", "z"], "a,b", ["a", "b", "c"]]) {
      expect(await writes.reorder(order)).toEqual({ kind: "failed", code: "card.order_invalid" });
    }
    expect(calls.profile).toEqual([]);
  });

  test("no profile yet means no order to write", async () => {
    const { writes } = store({}, null);
    expect(await writes.reorder([])).toEqual({ kind: "failed", code: "profile.name_required" });
  });

  test("a card another tab listed meanwhile must be in the order; an entry with no card stays after it", async () => {
    // The order is checked on the profile read on the head the write swaps on, so a stale order never drops it.
    const { writes, calls } = store({}, { ...PROFILE, cards: listed("a", "b", "c") });
    const cards = [..."abc"].map((key) => ({ key, value: readme(key), cid: "c" }));
    const three = store(
      { list: async () => ok({ cards, complete: true, overflow: false }) },
      { ...PROFILE, cards: listed("a", "b", "c") },
    );
    expect(await three.writes.reorder(["b", "a"])).toEqual({ kind: "failed", code: "card.order_invalid" });
    expect(await writes.reorder(["b", "a"])).toEqual({ kind: "saved" });
    expect(calls.profile).toMatchObject([{ record: { cards: listed("b", "a", "c") } }]);
  });

  test("an outage is a retryable failure and an ended session sends the member to sign in", async () => {
    const down = async () => ({ kind: "transient", code: "pds_unavailable" }) as const;
    expect(await store({ write: down }).writes.create(input().content, "full")).toEqual({
      kind: "failed",
      code: "card.pds_unavailable",
    });
    expect(await store({ write: async () => ({ kind: "auth_dead" }) }).writes.remove("a" as CardKey)).toEqual({
      kind: "redirect",
      location: "/login?error=login.session_ended",
    });
    expect(await store({ list: down }).writes.reorder(["a", "b"])).toEqual({
      kind: "failed",
      code: "card.pds_unavailable",
    });
  });

  test("an avatar shape is written into the profile, and its refusals read as the profile's", async () => {
    const { writes, calls } = store();
    expect(await writes.avatarShape("roundedSquare")).toEqual({ kind: "saved" });
    expect(calls.profile[0]).toMatchObject({ ok: true, record: { displayName: "A", avatarShape: "rounded-square" } });
    expect(await store({}, null).writes.avatarShape("round")).toEqual({
      kind: "failed",
      code: "profile.name_required",
    });
    const conflict = async () => ok({ kind: "conflict" } as const);
    expect(await store({ saveProfile: conflict }).writes.avatarShape("round")).toEqual({
      kind: "failed",
      code: "profile.conflict",
    });
    const down = async () => ({ kind: "transient", code: "pds_unavailable" }) as const;
    expect(await store({ saveProfile: down }).writes.avatarShape("round")).toEqual({
      kind: "failed",
      code: "profile.pds_unavailable",
    });
  });
});

// Review of #1911: all of a member's cards together must fit one page (domains/profile MAX_PAGE_BYTES, 4 MiB),
// counted on the list the write is checked against, so the index never leaves out a card the owner saved.
describe("a page's cards together fit one page", () => {
  // Stored cards of 101,800 characters (written by another app, or before ADR 0086's 20,000-byte text): forty-one
  // are about 4.18 MB, just under the budget, so one new Text card at the limit does not fit and forty leave room.
  const stored = "a".repeat(101_800);
  const full = "a".repeat(20_000);
  const page = (cards: number) =>
    ok({
      cards: Array.from({ length: cards }, (_, i) => ({ key: `k${i}`, value: readme(stored), cid: "c" })),
      complete: true,
      overflow: false,
    });

  test("adding a card past the budget is refused and nothing is written", async () => {
    const { writes, calls } = store({ list: async () => page(41) });
    expect(await writes.create(input(full).content, "full")).toEqual({ kind: "failed", code: "card.page_full" });
    expect(calls.created).toEqual([]);
    expect(await store({ list: async () => page(40) }).writes.create(input(full).content, "full")).toEqual({
      kind: "saved",
    });
  });

  test("an edit that takes the page past the budget is refused; one that keeps it within is saved", async () => {
    const { writes, calls } = store({ list: async () => page(41) });
    expect(await writes.save(KEY, input(full).content, "full")).toEqual({ kind: "failed", code: "card.page_full" });
    expect(calls.saved).toMatchObject([{ built: { ok: false, code: "card.page_full" } }]);
    expect(await writes.save("k0" as CardKey, input(full).content, "full")).toEqual({ kind: "saved" });
  });

  test("an edit is counted on a complete list only", async () => {
    const cut = { cards: [], complete: false, overflow: false };
    const { writes, calls } = store({ list: async () => ok(cut) });
    expect(await writes.save(KEY, input().content, "full")).toEqual({ kind: "failed", code: "card.list_incomplete" });
    expect(calls.saved).toEqual([]);
  });

  test("a Save sends the cards that shrink before the ones that grow, so each commit fits", async () => {
    // Codex review of #1911: a Save past one applyWrites body lands in several commits, judged one at a time.
    const stored = {
      cards: [
        { key: "a", value: readme("a".repeat(7_000)), cid: "c" },
        { key: "b", value: readme("b".repeat(13_000)), cid: "c" },
      ],
      complete: true,
      overflow: false,
    };
    const { writes, calls } = store({ list: async () => ok(stored) });
    const version = "c" as Parameters<CardWrites["saveAll"]>[0][number]["version"];
    const edit = (key: string, text: string) => ({
      key: key as CardKey,
      version,
      content: { kind: "readme", text } as CardContent,
      width: "full" as const,
    });
    expect(await writes.saveAll([edit("a", "a".repeat(13_000)), edit("b", "b".repeat(9_000))])).toEqual({
      kind: "saved",
    });
    expect(calls.many.map((call) => (call.updates as { key: string }[]).map((u) => u.key))).toEqual([["b", "a"]]);
  });

  test("a Save of several cards past the budget is refused and nothing is written", async () => {
    const stored = { cards: [{ key: "k0", value: readme("A"), cid: "c" }], complete: true, overflow: false };
    const { writes, calls } = store({ list: async () => ok(stored) });
    const big = { kind: "readme", text: full } as CardContent;
    const edits = Array.from({ length: 1 }, () => ({
      key: "k0" as CardKey,
      version: "c" as Parameters<CardWrites["saveAll"]>[0][number]["version"],
      content: big,
      width: "full" as const,
    }));
    expect(await writes.saveAll(edits)).toEqual({ kind: "saved" });
    const many = await store({ list: async () => page(42) }).writes.saveAll(edits);
    expect(many).toEqual({ kind: "failed", code: "card.page_full" });
    expect(calls.many).toHaveLength(1);
  });
});

test("create and save pass the chosen surface to the member's stored record", async () => {
  const { writes, calls } = store();
  const { content, width } = input();
  expect(await writes.create(content, width, "outlined")).toEqual({ kind: "saved" });
  expect(calls.created[0]).toMatchObject({ surface: "outlined" });
  expect(await writes.save(KEY, content, width, "plain")).toEqual({ kind: "saved" });
  expect(calls.saved[0]).toMatchObject({ built: { ok: true, record: { surface: "plain" } } });
});

describe("saveAll", () => {
  const V = "bafyreie5737gdxlw5i64vzichcalba3z2v5n6icifvx5xytvske7mr3hpm" as CardVersion;
  const V2 = "bafyreib2rxk3rybk3aobmv5cjuql3bm2twh4jo5uxgf5kpqcsgz7soitae" as CardVersion;
  const listing = (cards: { key: string; cid: string; text?: string }[], complete = true) =>
    ok({
      cards: cards.map((c) => ({ key: c.key, value: readme(c.text ?? c.key), cid: c.cid })),
      complete,
      overflow: false,
    });
  const edit = (key: string, text: string, version = V) => ({
    key: key as CardKey,
    version,
    content: { kind: "readme", text } as CardContent,
    width: "full" as const,
  });

  test("every changed card is written in one call on the head the versions were read on", async () => {
    const { writes, calls } = store({
      list: async () =>
        listing([
          { key: "a", cid: V },
          { key: "b", cid: V },
          { key: "c", cid: V },
        ]),
    });
    expect(await writes.saveAll([edit("a", "New A"), edit("c", "New C", V)])).toEqual({ kind: "saved" });
    expect(calls.many).toHaveLength(1);
    expect(calls.many[0]?.swapCommit).toBe(HEAD);
    expect(calls.many[0]?.updates).toMatchObject([
      { key: "a", record: { content: { text: "New A" }, createdAt: T1 } },
      { key: "c", record: { content: { text: "New C" }, createdAt: T1 } },
    ]);
    expect(calls.saved).toEqual([]);
  });

  test("a card changed since the editor opened is refused by name and nothing is written", async () => {
    const { writes, calls } = store({
      list: async () =>
        listing([
          { key: "a", cid: V },
          { key: "b", cid: V2 },
        ]),
    });
    expect(await writes.saveAll([edit("a", "New A"), edit("b", "New B")])).toEqual({
      kind: "failed",
      code: "card.conflict",
      card: "b",
    });
    expect(calls.many).toEqual([]);
  });

  test("a card that is gone is refused by name; a cut-short list refuses the Save", async () => {
    const gone = store({ list: async () => listing([{ key: "a", cid: V }]) });
    expect(await gone.writes.saveAll([edit("a", "New A"), edit("z", "Z")])).toEqual({
      kind: "failed",
      code: "card.missing",
      card: "z",
    });
    const cut = store({ list: async () => listing([{ key: "a", cid: V }], false) });
    expect(await cut.writes.saveAll([edit("z", "Z")])).toEqual({ kind: "failed", code: "card.list_incomplete" });
    // The page budget counts every card, so a list cut short refuses even a card it holds (Codex review of #1911).
    expect(await cut.writes.saveAll([edit("a", "New A")])).toEqual({ kind: "failed", code: "card.list_incomplete" });
    expect(gone.calls.many).toEqual([]);
    expect(cut.calls.many).toEqual([]);
  });

  test("a card the domain refuses is named and nothing is written", async () => {
    const { writes, calls } = store({ list: async () => listing([{ key: "a", cid: V }]) });
    expect(await writes.saveAll([edit("a", "x".repeat(100_001))])).toEqual({
      kind: "failed",
      code: "card.too_long",
      card: "a",
    });
    expect(calls.many).toEqual([]);
  });

  test("a repo that moved on for another reason is read again once, and saved when the cards are unchanged", async () => {
    let tries = 0;
    const heads = ["h1", "h2"];
    const { writes, calls } = store({
      head: async () => ok(heads[tries] ?? "h3"),
      list: async () => listing([{ key: "a", cid: V }]),
      saveMany: async (updates, swapCommit) => {
        calls.many.push({ updates: [...updates], swapCommit });
        tries += 1;
        return ok(tries === 1 ? { kind: "changed" } : { kind: "saved" });
      },
    });
    expect(await writes.saveAll([edit("a", "New A")])).toEqual({ kind: "saved" });
    expect(calls.many.map((c) => c.swapCommit)).toEqual(["h1", "h2"]);
  });

  test("a card changed between the two reads is refused by name on the second", async () => {
    let reads = 0;
    const { writes, calls } = store({
      list: async () => listing([{ key: "a", cid: reads++ === 0 ? V : V2 }]),
      saveMany: async (updates, swapCommit) => {
        calls.many.push({ updates: [...updates], swapCommit });
        return ok({ kind: "changed" });
      },
    });
    expect(await writes.saveAll([edit("a", "New A")])).toEqual({ kind: "failed", code: "card.conflict", card: "a" });
    expect(calls.many).toHaveLength(1);
  });

  test("a repo that keeps moving is not tried a third time", async () => {
    const { writes, calls } = store({
      list: async () => listing([{ key: "a", cid: V }]),
      saveMany: async (updates, swapCommit) => {
        calls.many.push({ updates: [...updates], swapCommit });
        return ok({ kind: "changed" });
      },
    });
    expect(await writes.saveAll([edit("a", "New A")])).toEqual({ kind: "failed", code: "card.cards_changed" });
    expect(calls.many).toHaveLength(2);
  });

  test("one card too large for any PDS call is refused by name, and is not tried again", async () => {
    const { writes, calls } = store({
      list: async () => listing([{ key: "a", cid: V }]),
      saveMany: async (updates, swapCommit) => {
        calls.many.push({ updates: [...updates], swapCommit });
        return ok({ kind: "too_large", key: "a" });
      },
    });
    expect(await writes.saveAll([edit("a", "New A")])).toEqual({
      kind: "failed",
      code: "card.save_too_large",
      card: "a",
    });
    expect(calls.many).toHaveLength(1);
  });

  test("a Save written only in part names the cards written, and is not tried again", async () => {
    const { writes, calls } = store({
      list: async () =>
        listing([
          { key: "a", cid: V },
          { key: "b", cid: V },
        ]),
      saveMany: async (updates, swapCommit) => {
        calls.many.push({ updates: [...updates], swapCommit });
        return ok({ kind: "partial", saved: ["a"] });
      },
    });
    expect(await writes.saveAll([edit("a", "New A"), edit("b", "New B")])).toEqual({
      kind: "failed",
      code: "card.save_partial",
      saved: ["a"],
    });
    expect(calls.many).toHaveLength(1);
  });

  // P1.21v follow-up (Codex on c6cddd7): the answer names the version each written card now has, as the PDS gave it, so
  // the page settles words typed meanwhile on that version and never on one another tab wrote after it. A CID that is
  // not one is left out (the page then keeps those words on their own version, so a later Save is a conflict).
  test("a_save_names_the_version_each_written_card_now_has", async () => {
    const { writes, calls } = store({
      list: async () =>
        listing([
          { key: "a", cid: V },
          { key: "b", cid: V },
        ]),
      saveMany: async (updates, swapCommit) => {
        calls.many.push({ updates: [...updates], swapCommit });
        return ok({
          kind: "saved",
          versions: [
            { key: "a", cid: V2 },
            { key: "b", cid: "not a cid" },
          ],
        });
      },
    });
    expect(await writes.saveAll([edit("a", "New A"), edit("b", "New B")])).toEqual({
      kind: "saved",
      versions: [{ key: "a", version: V2 }],
    });
    const part = store({
      list: async () => listing([{ key: "a", cid: V }]),
      saveMany: async () => ok({ kind: "partial", saved: ["a"], versions: [{ key: "a", cid: V2 }] }),
    });
    expect(await part.writes.saveAll([edit("a", "New A")])).toEqual({
      kind: "failed",
      code: "card.save_partial",
      saved: ["a"],
      versions: [{ key: "a", version: V2 }],
    });
  });

  test("an outage is a retryable failure and an ended session sends the member to sign in", async () => {
    const down = async () => ({ kind: "transient", code: "pds_unavailable" }) as const;
    expect(await store({ head: down }).writes.saveAll([edit("a", "A")])).toEqual({
      kind: "failed",
      code: "card.pds_unavailable",
    });
    const { writes } = store({
      list: async () => listing([{ key: "a", cid: V }]),
      saveMany: async () => ({ kind: "transient", code: "pds_unavailable" }) as const,
    });
    expect(await writes.saveAll([edit("a", "A")])).toEqual({ kind: "failed", code: "card.pds_unavailable" });
  });
});
