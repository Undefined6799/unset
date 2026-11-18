// Ported from interfaces/http/card-writes.test.ts (P1.20i); that copy goes with P1.20k. The cases are unchanged; the
// domain and PDS types are read off the module under test, since a test beside a route imports no domain
// (svelte-screens-no-core), and the fixture card is written as parseCardInput gives it.
// The card writes (ADR 0051) over a stand-in store: what each PDS answer becomes for the route.
import { describe, expect, test } from "vitest";
import { type CardStore, type CardWrites, cardWrites } from "./card-writes.server.ts";

type ListResult = Awaited<ReturnType<CardStore["list"]>>;
type PdsResult<T> = { readonly kind: "ok"; readonly value: T } | Exclude<ListResult, { kind: "ok" }>;
type StoredCard = Extract<ListResult, { kind: "ok" }>["value"]["cards"][number];
type CardKey = Parameters<CardStore["remove"]>[0];
type CardContent = Parameters<CardWrites["create"]>[0];

const NOW = "2026-11-17T06:00:00.000Z";
const T1 = "2026-11-01T00:00:00.000Z";
const ok = <T>(value: T): PdsResult<T> => ({ kind: "ok", value });
const readme = (text: string) => ({
  $type: "sh.unset.section",
  content: { $type: "sh.unset.section#readme", text },
  createdAt: T1,
});
/** A README card as parseCardInput reads `{ kind: "readme", text }`. */
const input = (text = "Hello") => ({ content: { kind: "readme", text } as CardContent, width: "full" as const });
const KEY = "3k2abc" as CardKey;

type Calls = { created: unknown[]; saved: unknown[]; removed: string[]; profile: unknown[] };

function store(
  over: Partial<CardStore> = {},
  stored: unknown = { $type: "sh.unset.profile", displayName: "A", createdAt: T1 },
) {
  const calls: Calls = { created: [], saved: [], removed: [], profile: [] };
  const base: CardStore = {
    list: async () =>
      ok({
        cards: [
          { key: "a", value: readme("A"), cid: "c" },
          { key: "b", value: readme("B"), cid: "c" },
        ],
        complete: true,
      }),
    create: async (record) => {
      calls.created.push(record);
      return ok({ key: "new" });
    },
    save: async (key, build) => {
      const built = build(readme("old"));
      calls.saved.push({ key, built });
      return ok(built.ok ? { kind: "saved" } : { kind: "refused", code: built.code });
    },
    remove: async (key) => {
      calls.removed.push(key);
      return ok(undefined);
    },
    saveProfile: async (build) => {
      const built = build(stored);
      calls.profile.push(built);
      return ok(built.ok ? { kind: "saved" } : { kind: "refused", code: built.code });
    },
  };
  return { writes: cardWrites({ ...base, ...over }, "pds.example", () => NOW), calls };
}

describe("cardWrites", () => {
  test("a new card is built from the checked input and created", async () => {
    const { writes, calls } = store();
    const { content, width } = input("Hi");
    expect(await writes.create(content, width)).toEqual({ kind: "saved" });
    expect(calls.created).toEqual([
      { $type: "sh.unset.section", content: { $type: "sh.unset.section#readme", text: "Hi" }, createdAt: NOW },
    ]);
  });

  test("a member with the most cards a page shows cannot add another", async () => {
    const full = Array.from({ length: 100 }, (_, n) => ({ key: `k${n}`, value: readme("A"), cid: "c" }));
    const { writes, calls } = store({ list: async () => ok({ cards: full, complete: true }) });
    const { content, width } = input();
    expect(await writes.create(content, width)).toEqual({ kind: "failed", code: "card.too_many" });
    expect(calls.created).toEqual([]);
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

  test("a delete removes the card under its key", async () => {
    const { writes, calls } = store();
    expect(await writes.remove(KEY)).toEqual({ kind: "saved" });
    expect(calls.removed).toEqual([KEY]);
  });

  test("a list the read cut short is not a count: adding and moving are refused, nothing is written", async () => {
    const cut = { cards: [{ key: "a", value: readme("A"), cid: "c" }], complete: false };
    const { writes, calls } = store({ list: async () => ok(cut) });
    const { content, width } = input();
    expect(await writes.create(content, width)).toEqual({ kind: "failed", code: "card.list_incomplete" });
    expect(await writes.reorder(["a"])).toEqual({ kind: "failed", code: "card.list_incomplete" });
    expect([calls.created, calls.profile]).toEqual([[], []]);
  });

  test("a reorder names each shown card once and writes the order into the profile", async () => {
    const { writes, calls } = store();
    expect(await writes.reorder(["b", "a"])).toEqual({ kind: "saved" });
    expect(calls.profile).toMatchObject([{ ok: true, record: { displayName: "A", cards: ["b", "a"] } }]);
  });

  test("a hidden card is not part of the order, so the page's order still matches", async () => {
    const cards: StoredCard[] = [
      { key: "a", value: readme("A"), cid: "c" },
      { key: "h", value: { $type: "sh.unset.section", content: { $type: "x" } }, cid: "c" },
      { key: "bad/key", value: readme("B"), cid: "c" },
    ];
    const list = async () => ok({ cards, complete: true });
    const { writes, calls } = store({ list });
    expect(await writes.reorder(["a"])).toEqual({ kind: "saved" });
    expect(calls.profile).toMatchObject([{ ok: true, record: { cards: ["a"] } }]);
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
    expect(await writes.reorder(["a", "b"])).toEqual({ kind: "failed", code: "profile.name_required" });
  });

  test("an outage is a retryable failure and an ended session sends the member to sign in", async () => {
    const down = async () => ({ kind: "transient", code: "pds_unavailable" }) as const;
    expect(await store({ create: down }).writes.create(input().content, "full")).toEqual({
      kind: "failed",
      code: "card.pds_unavailable",
    });
    expect(await store({ remove: async () => ({ kind: "auth_dead" }) }).writes.remove(KEY)).toEqual({
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
    expect(calls.profile[0]).toMatchObject({ ok: true, record: { displayName: "A", avatarShape: "roundedSquare" } });
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
