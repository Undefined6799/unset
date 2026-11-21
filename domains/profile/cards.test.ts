// Profile cards (ADR 0051): one sh.unset.card record per card, read leniently from any client, written strictly,
// and shown in the order the profile's cards list sets.
import { describe, expect, test } from "vitest";
import {
  type Card,
  orderCards,
  pageCards,
  parseCardKey,
  parseCardVersion,
  type RepoDid,
  readCard,
  shownCards,
} from "./cards.ts";

const T1 = "2026-11-01T00:00:00.000Z";
const T2 = "2026-11-02T00:00:00.000Z";
const KEY = "3jzfcijpj2z2a";
const key = (raw: string) => {
  const parsed = parseCardKey(raw);
  if (parsed === null) throw new Error(`bad key ${raw}`);
  return parsed;
};
const stored = (content: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  $type: "sh.unset.card",
  content,
  createdAt: T1,
  ...extra,
});
/** Each kind's block (ADR 0086), and the buttons block's two button defs. */
const REFS: Record<string, string> = {
  readme: "sh.unset.block.text",
  links: "sh.unset.block.links",
  collection: "sh.unset.block.showcase",
  buttons: "sh.unset.block.buttons",
  image: "sh.unset.block.images",
  emailButton: "sh.unset.block.buttons#email",
  linkButton: "sh.unset.block.buttons#link",
};
const ref = (kind: string) => REFS[kind] ?? `sh.unset.block.${kind}`;
const OWNER = "did:plc:ewvi7nxzyoun6zhxrhs64oiz" as RepoDid;
/** A card list as the profile stores it: at:// addresses of the owner's cards. */
const listOf = (keys: readonly unknown[]) =>
  keys.map((k) => (typeof k === "string" ? { uri: `at://${OWNER}/sh.unset.card/${k}` } : k));

describe("parseCardKey", () => {
  test("accepts record keys and refuses anything else", () => {
    expect(parseCardKey(KEY)).toBe(KEY);
    for (const bad of ["", ".", "..", "a/b", "a b", "x".repeat(513), 7, null]) expect(parseCardKey(bad)).toBeNull();
  });
});

describe("parseCardVersion", () => {
  test("accepts a base32 CIDv1 as a PDS names a record's version and refuses anything else", () => {
    const cid = "bafyreie5737gdxlw5i64vzichcalba3z2v5n6icifvx5xytvske7mr3hpm";
    expect(parseCardVersion(cid)).toBe(cid);
    for (const bad of ["", "b", "Bafyrei", "bafy rei", "bafyrei/x", `b${"a".repeat(200)}`, "QmYwAPJzv5", 7, null]) {
      expect(parseCardVersion(bad)).toBeNull();
    }
  });
});

describe("readCard", () => {
  test.each([undefined, "filled", "outlined", "plain", "future"])(
    "reads surface %s without hiding older or future cards",
    (surface) => {
      const record = stored({ $type: ref("readme"), text: "Hi" }, surface === undefined ? {} : { surface });
      expect(readCard(key(KEY), record)?.surface).toBe(
        surface === "outlined" || surface === "plain" ? surface : "filled",
      );
    },
  );

  test.each([null, 1, {}, "x".repeat(33)])("hides a malformed stored surface %j", (surface) => {
    expect(readCard(key(KEY), stored({ $type: ref("readme"), text: "Hi" }, { surface }))).toBeNull();
  });

  test("reads each card kind into its view", () => {
    expect(readCard(key(KEY), stored({ $type: ref("readme"), text: "# Hi" }))).toEqual({
      key: KEY,
      width: "full",
      surface: "filled",
      createdAt: T1,
      content: { kind: "readme", text: "# Hi" },
    });
    const links = stored(
      { $type: ref("links"), title: "Elsewhere", layout: "grid", items: [{ uri: "https://github.com/alice" }] },
      { width: "half" },
    );
    expect(readCard(key(KEY), links)).toMatchObject({
      width: "half",
      content: {
        kind: "links",
        title: "Elsewhere",
        layout: "grid",
        items: [{ uri: "https://github.com/alice", label: "", description: "" }],
      },
    });
    const collection = stored({ $type: ref("collection"), items: [{ title: "unset.sh", tag: "Project" }] });
    expect(readCard(key(KEY), collection)?.content).toEqual({
      kind: "collection",
      title: "",
      layout: "carousel",
      items: [{ title: "unset.sh", tag: "Project", description: "", uri: "" }],
    });
    const buttons = stored({
      $type: ref("buttons"),
      heading: "Work with me",
      buttons: [
        { $type: ref("emailButton"), address: "alice@example.com" },
        { $type: ref("linkButton"), preset: "book-call", uri: "https://cal.example/alice" },
      ],
    });
    expect(readCard(key(KEY), buttons)?.content).toEqual({
      kind: "buttons",
      heading: "Work with me",
      text: "",
      buttons: [
        { kind: "email", address: "alice@example.com" },
        { kind: "link", preset: "bookCall", uri: "https://cal.example/alice", label: "" },
      ],
    });
  });

  test("an unknown width, layout or preset reads as the default", () => {
    const card = stored(
      {
        $type: ref("buttons"),
        heading: "Hi",
        buttons: [{ $type: ref("linkButton"), preset: "tip", uri: "https://x.example", label: "Tip me" }],
      },
      { width: "third" },
    );
    expect(readCard(key(KEY), card)).toMatchObject({
      width: "full",
      surface: "filled",
      content: { buttons: [{ kind: "link", preset: "custom", label: "Tip me" }] },
    });
    const links = stored({ $type: ref("links"), layout: "masonry", items: [] });
    expect(readCard(key(KEY), links)?.content).toMatchObject({ layout: "list" });
  });

  test("a card kind this version does not know is hidden, never an error", () => {
    expect(readCard(key(KEY), stored({ $type: ref("video"), uri: "https://youtu.be/x" }))).toBeNull();
  });

  test("a record that does not validate is hidden", () => {
    expect(readCard(key(KEY), stored({ $type: ref("readme"), text: 7 }))).toBeNull();
    expect(readCard(key(KEY), { $type: "sh.unset.card", createdAt: T1 })).toBeNull();
    expect(readCard(key(KEY), "card")).toBeNull();
  });

  test("addresses that are not plain http or https are dropped, the rest of the card still shows", () => {
    const links = stored({
      $type: ref("links"),
      items: [{ uri: "javascript:alert(1)" }, { uri: "https://user:pw@x.example" }, { uri: "https://ok.example" }],
    });
    expect(readCard(key(KEY), links)?.content).toMatchObject({ items: [{ uri: "https://ok.example" }] });
    const entries = stored({ $type: ref("collection"), items: [{ title: "A", uri: "data:text/html,x" }] });
    expect(readCard(key(KEY), entries)?.content).toMatchObject({ items: [{ title: "A", uri: "" }] });
    const buttons = stored({
      $type: ref("buttons"),
      heading: "Hi",
      buttons: [
        { $type: ref("linkButton"), preset: "hire", uri: "vbscript:x" },
        { $type: ref("emailButton"), address: "not an address" },
        { $type: ref("futureButton"), uri: "https://x.example" },
      ],
    });
    expect(readCard(key(KEY), buttons)?.content).toMatchObject({ buttons: [] });
  });
});

describe("email buttons", () => {
  test.each([
    "name@host.tld?bcc=someone@else.example",
    "a&b@x.example",
    "a%0Ab@x.example",
    "a@x.example#x",
    "a=b@x.example",
  ])("an address with mailto meaning is dropped on read: %s", (address) => {
    const card = stored({ $type: ref("buttons"), heading: "Hi", buttons: [{ $type: ref("emailButton"), address }] });
    expect(readCard(key(KEY), card)?.content).toMatchObject({ buttons: [] });
  });
});

describe("orderCards", () => {
  const card = (k: string, createdAt: string): Card => ({
    key: key(k),
    width: "full",
    surface: "filled",
    createdAt,
    content: { kind: "readme", text: k },
  });
  const a = card("a", T2);
  const b = card("b", T1);
  const c = card("c", T2);
  const d = card("d", T1);

  test("listed cards come first in list order, then unlisted ones oldest first", () => {
    expect(orderCards(OWNER, listOf(["c", "a"]), [a, b, c, d]).map((x) => x.key)).toEqual(["c", "a", "b", "d"]);
  });

  test("a listed key with no card is skipped and a repeated key shows once", () => {
    expect(orderCards(OWNER, listOf(["gone", "b", "b"]), [a, b]).map((x) => x.key)).toEqual(["b", "a"]);
  });

  test("unlisted cards are ordered by the instant they were made, whatever the offset or precision", () => {
    const early = card("early", "2026-11-17T10:00:00+02:00");
    const late = card("late", "2026-11-17T09:00:00Z");
    const between = card("between", "2026-11-17T08:30:00.123456Z");
    expect(orderCards(OWNER, listOf([]), [late, early, between]).map((x) => x.key)).toEqual([
      "early",
      "between",
      "late",
    ]);
  });

  test("two cards made in the same millisecond are ordered by their finer digits", () => {
    const second = card("second", "2026-11-17T08:30:00.123456Z");
    const first = card("first", "2026-11-17T10:30:00.123123+02:00");
    expect(orderCards(OWNER, listOf([]), [second, first]).map((x) => x.key)).toEqual(["first", "second"]);
  });

  test("a card whose time does not parse goes last", () => {
    expect(orderCards(OWNER, listOf([]), [card("bad", "soon"), a]).map((x) => x.key)).toEqual(["a", "bad"]);
  });

  test("only addresses of the owner's own cards, by DID, place a card", () => {
    // ADR 0086: the address is compared as text, never resolved, so a handle or another account places nothing.
    const others = [
      { uri: "at://alice.example/sh.unset.card/a" },
      { uri: "at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/sh.unset.card/a" },
      { uri: `at://${OWNER}/sh.unset.profile/a` },
      { uri: `at://${OWNER}/sh.unset.card` },
      "a",
    ];
    expect(orderCards(OWNER, [...others, { uri: `at://${OWNER}/sh.unset.card/c` }], [a, c]).map((x) => x.key)).toEqual([
      "c",
      "a",
    ]);
  });

  test("a missing or broken list means creation order", () => {
    expect(orderCards(OWNER, undefined, [a, b]).map((x) => x.key)).toEqual(["b", "a"]);
    expect(orderCards(OWNER, listOf([7, null]), [a, b]).map((x) => x.key)).toEqual(["b", "a"]);
  });
});

describe("shownCards and pageCards (the page's cards, own or public)", () => {
  const readme = (text: string, createdAt = T1) => stored({ $type: ref("readme"), text }, { createdAt });

  test("a key that is not a record key, or a card that does not read, is left out", () => {
    const shown = shownCards([
      { key: KEY, value: readme("kept") },
      { key: "../escape", value: readme("bad key") },
      { key: "3jzfcijpj2z2b", value: stored({ $type: "nope" }) },
    ]);
    expect(shown.map((card) => card.key)).toEqual([KEY]);
  });

  test("cards the profile lists come first in its order, then the rest oldest first", () => {
    const records = [
      { key: "aaa", value: readme("a", T2) },
      { key: "bbb", value: readme("b", T1) },
      { key: "ccc", value: readme("c", T2) },
    ];
    const cards = pageCards(OWNER, { $type: "sh.unset.profile", cards: listOf(["ccc", "missing", "ccc"]) }, records);
    expect(cards.map((card) => card.key)).toEqual(["ccc", "bbb", "aaa"]);
  });

  test("no profile record, or one that is not an object, shows every card oldest first", () => {
    const records = [
      { key: "aaa", value: readme("a", T2) },
      { key: "bbb", value: readme("b", T1) },
    ];
    expect(pageCards(OWNER, undefined, records).map((card) => card.key)).toEqual(["bbb", "aaa"]);
    expect(pageCards(OWNER, "not a record", records).map((card) => card.key)).toEqual(["bbb", "aaa"]);
  });
});
