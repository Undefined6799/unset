// What a card shows beside its own words (the profile-card mockup, Alex 2026-11-17): a labelled link names its site,
// and an email button's address is shown under the buttons.
import { describe, expect, test } from "vitest";
import { cardViews, contactAction, shownCards } from "./view.ts";

describe("card views", () => {
  test("a_labelled_link_names_its_host_and_an_unlabelled_one_shows_the_host_as_its_text", () => {
    const [card] = cardViews([
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
    const views = cardViews(
      [
        { key: "a", width: "full", content: readme },
        { key: "b", width: "full", content: readme },
      ],
      new Map([["a", "bafyv"]]),
    );
    expect(views.map((view) => view.version)).toEqual(["bafyv", undefined]);
    expect("version" in (cardViews([{ key: "a", width: "full", content: readme }])[0] ?? {})).toBe(false);
  });

  // Book P1.22h, rule SE-3: a page that edits nothing sends the browser what a card shows, never the record behind it.
  test("a_card_for_a_page_that_edits_nothing_is_what_it_shows_and_no_more", () => {
    const text = "Typed **as Markdown**";
    const [card] = shownCards(
      cardViews(
        [{ key: "k", width: "half", surface: "plain", content: { kind: "readme", text } }],
        new Map([["k", "v"]]),
      ),
    );
    expect(Object.keys(card ?? {}).sort()).toEqual(["key", "shown", "surface", "width"]);
    expect(card).toMatchObject({ key: "k", width: "half", surface: "plain", shown: { kind: "readme" } });
    expect(JSON.stringify(card)).not.toContain(text);
  });

  test("an_email_button_carries_its_address_and_a_link_button_none", () => {
    const [card] = cardViews([
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
  const [card] = cardViews([{ key: "k", width: "full", surface, content: { kind: "readme", text: "Hi" } }]);
  expect(card?.surface).toBe(surface);
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
    const cards = cardViews([
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
    expect(contactAction(cardViews([{ key: "t", width: "full", content: { kind: "readme", text: "Hi" } }]))).toBeNull();
    expect(contactAction(cardViews([buttons("a", [{ uri: "javascript:alert(1)", label: "x" }])]))).toBeNull();
  });
});
