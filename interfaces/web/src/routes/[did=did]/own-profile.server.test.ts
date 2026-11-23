// Ported from interfaces/http/own-profile.test.ts (P1.20i); that copy goes with P1.20k. The cases are unchanged; the PDS
// types are read off the module under test, since a test beside a route imports no infrastructure (svelte-screens-no-core).
// The owner's own profile and cards for their page (ADR 0051), read from their PDS and checked by domains/profile.
// The two reads are stand-ins for pdsCall results; the mapping is what is tested.
import { describe, expect, test } from "vitest";
import { loadOwnProfile, type OwnProfileReads } from "./own-profile.server.ts";

type ProfileRead = Awaited<ReturnType<OwnProfileReads["profile"]>>;
type CardsRead = Awaited<ReturnType<OwnProfileReads["cards"]>>;
type PdsResult<T> = { readonly kind: "ok"; readonly value: T } | Exclude<ProfileRead, { kind: "ok" }>;
type StoredRecord = NonNullable<Extract<ProfileRead, { kind: "ok" }>["value"]>;
type StoredCard = Extract<CardsRead, { kind: "ok" }>["value"]["cards"][number];

const T1 = "2026-11-01T00:00:00.000Z";
const T2 = "2026-11-02T00:00:00.000Z";
const ok = <T>(value: T): PdsResult<T> => ({ kind: "ok", value });
const readme = (text: string, createdAt = T1) => ({
  $type: "sh.unset.card",
  content: { $type: "sh.unset.block.text", text },
  createdAt,
});
const profile = (extra: Record<string, unknown> = {}): StoredRecord => ({
  value: { $type: "sh.unset.profile", displayName: "Alice", createdAt: T1, ...extra },
  cid: "c",
});
const card = (key: string, value: unknown): StoredCard => ({ key, value, cid: "c" });
const OWNER = "did:plc:ewvi7nxzyoun6zhxrhs64oiz" as Parameters<typeof loadOwnProfile>[0];
/** The main page listing these cards, as it is written: the owner's card addresses (ADR 0086, ADR 0091). */
const page = (...keys: string[]): StoredRecord => ({
  value: {
    $type: "sh.unset.page",
    cards: keys.map((k) => ({ uri: `at://${OWNER}/sh.unset.card/${k}` })),
    createdAt: T1,
  },
  cid: "g",
});
const load = (
  p: PdsResult<StoredRecord | null>,
  c: PdsResult<StoredCard[]>,
  complete = true,
  g: PdsResult<StoredRecord | null> = ok(null),
) =>
  loadOwnProfile(OWNER, {
    profile: async () => p,
    page: async () => g,
    cards: async () => (c.kind === "ok" ? { kind: "ok", value: { cards: c.value, complete, overflow: false } } : c),
  });

describe("loadOwnProfile", () => {
  test("reads the profile fields and the cards in the main page's order", async () => {
    const result = await load(
      ok(profile({ headline: "Hi" })),
      ok([card("a", readme("A")), card("b", readme("B", T2)), card("c", readme("C"))]),
      true,
      ok(page("b", "a")),
    );
    expect(result).toMatchObject({
      kind: "ok",
      profile: { displayName: "Alice", headline: "Hi", location: "", website: "" },
    });
    // ADR 0086 point 3: only listed cards show, on the owner's own page too.
    expect(result.kind === "ok" && result.cards.map((c) => c.key)).toEqual(["b", "a"]);
  });

  // ADR 0074: the one Save names the version each card's editor opened, so the page carries each card's record CID.
  test("each card's version is its record's CID, and one that is not a CID is left out", async () => {
    const cid = "bafyreie5737gdxlw5i64vzichcalba3z2v5n6icifvx5xytvske7mr3hpm";
    const result = await load(ok(profile()), ok([{ key: "a", value: readme("A"), cid }, card("b", readme("B"))]));
    expect(result.kind === "ok" && Object.fromEntries(result.versions)).toEqual({ a: cid });
  });

  test("a card list the read cut short is shown, and says so", async () => {
    const whole = await load(ok(profile()), ok([card("a", readme("A"))]), true, ok(page("a")));
    const cut = await load(ok(profile()), ok([card("a", readme("A"))]), false, ok(page("a")));
    expect(whole).toMatchObject({ kind: "ok", cardsComplete: true });
    expect(cut).toMatchObject({ kind: "ok", cardsComplete: false });
    expect(cut.kind === "ok" && cut.cards.map((c) => c.key)).toEqual(["a"]);
  });

  test("a hidden card or a key that is not a record key is left out", async () => {
    const result = await load(
      ok(profile()),
      ok([card("a", readme("A")), card("bad/key", readme("B")), card("v", { $type: "x" })]),
      true,
      ok(page("a", "bad/key", "v")),
    );
    expect(result.kind === "ok" && result.cards.map((c) => c.key)).toEqual(["a"]);
  });

  test("a card list kept on the profile, as before ADR 0091, places no card", async () => {
    const old = { cards: [{ uri: `at://${OWNER}/sh.unset.card/a` }] };
    const result = await load(ok(profile(old)), ok([card("a", readme("A"))]));
    expect(result.kind === "ok" && result.cards).toHaveLength(0);
  });

  test("a page that cannot be read leaves the page up without the profile", async () => {
    const result = await load(ok(profile()), ok([]), true, { kind: "transient", code: "pds_unavailable" });
    expect(result).toEqual({ kind: "unavailable" });
  });

  test("no profile record reads as no profile, and with no page no card shows", async () => {
    const result = await load(ok(null), ok([card("a", readme("A"))]));
    expect(result).toMatchObject({ kind: "ok", profile: null });
    expect(result.kind === "ok" && result.cards).toHaveLength(0);
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
