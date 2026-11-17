// The owner's own profile and cards for their page (ADR 0051), read from their PDS and checked by domains/profile.
// The two reads are stand-ins for pdsCall results; the mapping is what is tested.
import type { PdsResult, StoredCard, StoredRecord } from "@unset/infrastructure-pds";
import { describe, expect, test } from "vitest";
import { loadOwnProfile } from "./own-profile.ts";

const T1 = "2026-11-01T00:00:00.000Z";
const T2 = "2026-11-02T00:00:00.000Z";
const ok = <T>(value: T): PdsResult<T> => ({ kind: "ok", value });
const readme = (text: string, createdAt = T1) => ({
  $type: "sh.unset.section",
  content: { $type: "sh.unset.section#readme", text },
  createdAt,
});
const profile = (extra: Record<string, unknown> = {}): StoredRecord => ({
  value: { $type: "sh.unset.profile", displayName: "Alice", createdAt: T1, ...extra },
  cid: "c",
});
const card = (key: string, value: unknown): StoredCard => ({ key, value, cid: "c" });
const load = (p: PdsResult<StoredRecord | null>, c: PdsResult<StoredCard[]>, complete = true) =>
  loadOwnProfile(
    {
      profile: async () => p,
      cards: async () => (c.kind === "ok" ? { kind: "ok", value: { cards: c.value, complete } } : c),
    },
    "pds.example",
  );

describe("loadOwnProfile", () => {
  test("reads the side column and the cards in the profile's order", async () => {
    const result = await load(
      ok(profile({ headline: "Hi", cards: ["b", "a"] })),
      ok([card("a", readme("A")), card("b", readme("B", T2)), card("c", readme("C"))]),
    );
    expect(result).toMatchObject({
      kind: "ok",
      profile: { displayName: "Alice", headline: "Hi", location: "", website: "" },
    });
    expect(result.kind === "ok" && result.cards.map((c) => c.key)).toEqual(["b", "a", "c"]);
  });

  test("a card list the read cut short is shown, and says so", async () => {
    const whole = await load(ok(profile()), ok([card("a", readme("A"))]));
    const cut = await load(ok(profile()), ok([card("a", readme("A"))]), false);
    expect(whole).toMatchObject({ kind: "ok", cardsComplete: true });
    expect(cut).toMatchObject({ kind: "ok", cardsComplete: false });
    expect(cut.kind === "ok" && cut.cards.map((c) => c.key)).toEqual(["a"]);
  });

  test("a hidden card or a key that is not a record key is left out", async () => {
    const result = await load(
      ok(profile()),
      ok([card("a", readme("A")), card("bad/key", readme("B")), card("v", { $type: "x" })]),
    );
    expect(result.kind === "ok" && result.cards.map((c) => c.key)).toEqual(["a"]);
  });

  test("no profile record reads as no profile, and its cards still show", async () => {
    const result = await load(ok(null), ok([card("a", readme("A"))]));
    expect(result).toMatchObject({ kind: "ok", profile: null });
    expect(result.kind === "ok" && result.cards).toHaveLength(1);
  });

  test("an outage leaves the page up without the profile", async () => {
    expect(await load({ kind: "transient", code: "pds_unavailable" }, ok([]))).toEqual({ kind: "unavailable" });
    expect(await load(ok(profile()), { kind: "rejected", xrpcError: "InvalidRequest", status: 400 })).toEqual({
      kind: "unavailable",
    });
  });

  test("an ended session sends the member to sign in again", async () => {
    expect(await load({ kind: "auth_dead" }, ok([]))).toEqual({
      kind: "redirect",
      location: "/login?error=login.session_ended",
    });
  });
});
