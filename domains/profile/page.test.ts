// The main page's card list (ADR 0091): which of the owner's cards show, in what order, kept apart from the profile.
import { LIMITS } from "@unset/shared-lexicons";
import { describe, expect, test } from "vitest";
import type { CardKey, RepoDid } from "./cards.ts";
import { MAX_RECORD_BYTES, recordBytes } from "./index-plan.ts";
import { withCardListed, withCardOrder, withCardUnlisted } from "./page.ts";

const OWNER = "did:plc:ewvi7nxzyoun6zhxrhs64oiz" as RepoDid;
const T = "2026-10-23T03:00:00.000Z";
const LATER = "2027-01-01T00:00:00.000Z";
const uri = (key: string) => ({ uri: `at://${OWNER}/sh.unset.card/${key}` });
const other = { uri: "at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/sh.unset.card/x", note: "another client's" };
const stored = { $type: "sh.unset.page", createdAt: T, future: 1, cards: [other, uri("a")] };

describe("withCardListed and withCardUnlisted (a card shows only when the page lists it)", () => {
  test("a new card goes at the end, and every entry and field already stored is kept as it is", () => {
    expect(withCardListed(OWNER, "b" as CardKey, stored, LATER)).toEqual({
      ok: true,
      record: { ...stored, cards: [other, uri("a"), uri("b")] },
    });
  });

  test("a card already listed is not listed twice", () => {
    expect(withCardListed(OWNER, "a" as CardKey, stored, T)).toEqual({ ok: true, record: stored });
  });

  test("a first card starts the page, created now", () => {
    expect(withCardListed(OWNER, "a" as CardKey, null, LATER)).toEqual({
      ok: true,
      record: { $type: "sh.unset.page", cards: [uri("a")], createdAt: LATER },
    });
  });

  test("no list past the lexicon's count", () => {
    const full = { ...stored, cards: Array.from({ length: LIMITS.page.cardsMax }, (_, i) => uri(`k${i}`)) };
    expect(withCardListed(OWNER, "new" as CardKey, full, T)).toEqual({ ok: false, code: "page.too_long" });
  });

  test("an entry that would take the page past what the index keeps is refused", () => {
    const room = MAX_RECORD_BYTES - recordBytes({ ...stored, note: "" }) - 20;
    const near = { ...stored, note: "x".repeat(room) };
    expect(withCardListed(OWNER, "a" as CardKey, near, T)).toEqual({ ok: true, record: near });
    expect(withCardListed(OWNER, "b" as CardKey, near, T)).toEqual({ ok: false, code: "page.too_long" });
  });

  test("a page another client broke is never written back", () => {
    expect(withCardListed(OWNER, "b" as CardKey, { ...stored, createdAt: "yesterday" }, T)).toEqual({
      ok: false,
      code: "page.invalid",
    });
  });

  test("a removed card leaves the list, every other entry stays", () => {
    const built = withCardUnlisted(OWNER, "a" as CardKey, { ...stored, cards: [uri("a"), other, uri("a")] }, T);
    expect(built).toEqual({ ok: true, record: { ...stored, cards: [other] } });
  });

  test("the last card removed takes the list away", () => {
    const built = withCardUnlisted(OWNER, "a" as CardKey, { ...stored, cards: [uri("a")] }, T);
    expect(built.ok && built.record !== null && "cards" in built.record).toBe(false);
  });

  test("nothing to write when the card is not listed or there is no page", () => {
    expect(withCardUnlisted(OWNER, "b" as CardKey, stored, T)).toEqual({ ok: true, record: null });
    expect(withCardUnlisted(OWNER, "b" as CardKey, null, T)).toEqual({ ok: true, record: null });
  });
});

describe("withCardOrder", () => {
  const bare = { $type: "sh.unset.page", createdAt: T, future: 1 };

  test("sets the order and keeps every other field", () => {
    expect(withCardOrder(OWNER, ["b", "a"] as CardKey[], bare, LATER)).toEqual({
      ok: true,
      record: { ...bare, cards: [uri("b"), uri("a")] },
    });
  });

  test("an empty order is written as no order", () => {
    const built = withCardOrder(OWNER, [], { ...bare, cards: [] }, T);
    expect(built.ok && "cards" in built.record).toBe(false);
  });

  test("an entry the order does not name stays, after the ordered cards, as it was stored", () => {
    // Only listed cards show, so dropping the entry of a card this version hides (a newer block, another client's)
    // would take it off the page for every reader (ADR 0038: kept, never a reason to refuse).
    const list = [uri("a"), uri("hidden"), other, uri("b"), uri("a")];
    const built = withCardOrder(OWNER, ["b", "a"] as CardKey[], { ...bare, cards: list }, T);
    expect(built).toEqual({ ok: true, record: { ...bare, cards: [uri("b"), uri("a"), uri("hidden"), other] } });
  });

  test("an order past the lexicon's count is too long", () => {
    const order = Array.from({ length: LIMITS.page.cardsMax + 1 }, (_, i) => `k${i}`) as CardKey[];
    expect(withCardOrder(OWNER, order, bare, T)).toEqual({ ok: false, code: "page.too_long" });
  });
});
