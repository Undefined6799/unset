// What a card shows beside its own words (the profile-card mockup, Alex 2026-11-17): a labelled link names its site,
// and an email button's address is shown under the buttons.
import { describe, expect, test } from "vitest";
import { parseReadme } from "./parse.ts";
import { cardViews, contactAction, shownCards } from "./view.ts";

type Cards = Parameters<typeof cardViews>[0];
/** The page's cards with the parser itself as their reader, as a page with no limits would read them. */
const views = (cards: Cards, versions?: ReadonlyMap<string, string>) => cardViews(cards, parseReadme, versions);

describe("card views", () => {
  test("a_labelled_link_names_its_host_and_an_unlabelled_one_shows_the_host_as_its_text", () => {
    const [card] = views([
      {
        key: "k",
        width: "half",
        content: {
          kind: "links",
          title: "Elsewhere",
          layout: "list",
          items: [
            { uri: "https://www.instagram.com/mara.records", label: "@mara.records", description: "" },
            { uri: "https://github.com/maralind/", label: "", description: "" },
          ],
        },
      },
    ]);
    expect(card?.shown).toMatchObject({
      kind: "links",
      items: [
        { text: "@mara.records", site: "instagram.com" },
        { text: "github.com/maralind", site: "" },
      ],
    });
  });

  test("a_card_carries_its_version_only_where_the_page_gave_one", () => {
    const readme = { kind: "readme", text: "Hi" } as const;
    const both = views(
      [
        { key: "a", width: "full", content: readme },
        { key: "b", width: "full", content: readme },
      ],
      new Map([["a", "bafyv"]]),
    );
    expect(both.map((view) => view.version)).toEqual(["bafyv", undefined]);
    expect("version" in (views([{ key: "a", width: "full", content: readme }])[0] ?? {})).toBe(false);
  });

  // Book P1.22h, rule SE-3: a page that edits nothing sends the browser what a card shows, never the record behind it.
  test("a_card_for_a_page_that_edits_nothing_is_what_it_shows_and_no_more", () => {
    const text = "Typed **as Markdown**";
    const [card] = shownCards(
      views([{ key: "k", width: "half", surface: "plain", content: { kind: "readme", text } }], new Map([["k", "v"]])),
    );
    expect(Object.keys(card ?? {}).sort()).toEqual(["key", "shown", "surface", "width"]);
    expect(card).toMatchObject({ key: "k", width: "half", surface: "plain", shown: { kind: "readme" } });
    expect(JSON.stringify(card)).not.toContain(text);
  });

  test("an_email_button_carries_its_address_and_a_link_button_none", () => {
    const [card] = views([
      {
        key: "k",
        width: "half",
        content: {
          kind: "buttons",
          heading: "Booking",
          text: "",
          buttons: [
            { kind: "email", address: "hello@mara.example" },
            { kind: "link", preset: "bookCall", uri: "https://cal.example/mara", label: "" },
          ],
        },
      },
    ]);
    expect(card?.shown).toEqual({
      kind: "buttons",
      heading: "Booking",
      text: "",
      buttons: [
        { href: "mailto:hello%40mara.example", label: "Email me", address: "hello@mara.example" },
        { href: "https://cal.example/mara", label: "Book a call" },
      ],
    });
  });
});

test.each(["filled", "outlined", "plain"] as const)("the page keeps the stored %s surface", (surface) => {
  const [card] = views([{ key: "k", width: "full", surface, content: { kind: "readme", text: "Hi" } }]);
  expect(card?.surface).toBe(surface);
});

// P1.21k: the page's server passes a reader that stops a slow parse, so every Text card must go through it.
test("every Text card is read by the reader the page passes, in page order", () => {
  const read: string[] = [];
  const cards = cardViews(
    [
      { key: "a", width: "full", content: { kind: "readme", text: "one" } },
      { key: "b", width: "full", content: { kind: "buttons", heading: "", text: "not Markdown", buttons: [] } },
      { key: "c", width: "full", content: { kind: "readme", text: "two" } },
    ],
    (text) => {
      read.push(text);
      return [{ kind: "rule" }];
    },
  );
  expect(read).toEqual(["one", "two"]);
  expect(cards.map((card) => card.shown)).toMatchObject([
    { kind: "readme", blocks: [{ kind: "rule" }] },
    { kind: "buttons" },
    { kind: "readme", blocks: [{ kind: "rule" }] },
  ]);
});

// P1.21o: the header's About panel repeats the page's published contact action, never an account address.
describe("contact action", () => {
  const buttons = (key: string, list: readonly { uri: string; label: string }[]) => ({
    key,
    width: "full" as const,
    content: {
      kind: "buttons" as const,
      heading: "Say hello",
      text: "",
      buttons: list.map((b) => ({ kind: "link" as const, preset: "custom" as const, ...b })),
    },
  });

  test("is the first button of the first Contact card", () => {
    const cards = views([
      { key: "t", width: "full", content: { kind: "readme", text: "Hi" } },
      buttons("a", [
        { uri: "https://cal.example/me", label: "Book a call" },
        { uri: "https://example.org", label: "Other" },
      ]),
      buttons("b", [{ uri: "https://later.example", label: "Later" }]),
    ]);
    expect(contactAction(cards)).toEqual({ href: "https://cal.example/me", label: "Book a call" });
  });

  test("is none with no Contact card, or one whose buttons have no safe address", () => {
    expect(contactAction(views([{ key: "t", width: "full", content: { kind: "readme", text: "Hi" } }]))).toBeNull();
    expect(contactAction(views([buttons("a", [{ uri: "javascript:alert(1)", label: "x" }])]))).toBeNull();
  });
});
