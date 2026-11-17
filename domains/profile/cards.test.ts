// Profile cards (ADR 0051): one sh.unset.section record per card, read leniently from any client, written strictly,
// and shown in the order the profile's cards list sets.
import { describe, expect, test } from "vitest";
import { type Card, orderCards, parseCardKey, readCard } from "./cards.ts";

const T1 = "2026-11-01T00:00:00.000Z";
const T2 = "2026-11-02T00:00:00.000Z";
const KEY = "3jzfcijpj2z2a";
const key = (raw: string) => {
  const parsed = parseCardKey(raw);
  if (parsed === null) throw new Error(`bad key ${raw}`);
  return parsed;
};
const stored = (content: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  $type: "sh.unset.section",
  content,
  createdAt: T1,
  ...extra,
});
const ref = (kind: string) => `sh.unset.section#${kind}`;

describe("parseCardKey", () => {
  test("accepts record keys and refuses anything else", () => {
    expect(parseCardKey(KEY)).toBe(KEY);
    for (const bad of ["", ".", "..", "a/b", "a b", "x".repeat(513), 7, null]) expect(parseCardKey(bad)).toBeNull();
  });
});

describe("readCard", () => {
  test("reads each card kind into its view", () => {
    expect(readCard(key(KEY), stored({ $type: ref("readme"), text: "# Hi" }))).toEqual({
      key: KEY,
      width: "full",
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
        { $type: ref("linkButton"), preset: "bookCall", uri: "https://cal.example/alice" },
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
    expect(readCard(key(KEY), { $type: "sh.unset.section", content: { $type: ref("readme"), text: "x" } })).toBeNull();
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
    createdAt,
    content: { kind: "readme", text: k },
  });
  const a = card("a", T2);
  const b = card("b", T1);
  const c = card("c", T2);
  const d = card("d", T1);

  test("listed cards come first in list order, then unlisted ones oldest first", () => {
    expect(orderCards(["c", "a"], [a, b, c, d]).map((x) => x.key)).toEqual(["c", "a", "b", "d"]);
  });

  test("a listed key with no card is skipped and a repeated key shows once", () => {
    expect(orderCards(["gone", "b", "b"], [a, b]).map((x) => x.key)).toEqual(["b", "a"]);
  });

  test("unlisted cards are ordered by the instant they were made, whatever the offset or precision", () => {
    const early = card("early", "2026-11-17T10:00:00+02:00");
    const late = card("late", "2026-11-17T09:00:00Z");
    const between = card("between", "2026-11-17T08:30:00.123456Z");
    expect(orderCards([], [late, early, between]).map((x) => x.key)).toEqual(["early", "between", "late"]);
  });

  test("two cards made in the same millisecond are ordered by their finer digits", () => {
    const second = card("second", "2026-11-17T08:30:00.123456Z");
    const first = card("first", "2026-11-17T10:30:00.123123+02:00");
    expect(orderCards([], [second, first]).map((x) => x.key)).toEqual(["first", "second"]);
  });

  test("a card whose time does not parse goes last", () => {
    expect(orderCards([], [card("bad", "soon"), a]).map((x) => x.key)).toEqual(["a", "bad"]);
  });

  test("a missing or broken list means creation order", () => {
    expect(orderCards(undefined, [a, b]).map((x) => x.key)).toEqual(["b", "a"]);
    expect(orderCards([7, null], [a, b]).map((x) => x.key)).toEqual(["b", "a"]);
  });
});
