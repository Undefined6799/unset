// What a card shows beside its own words (the profile-card mockup, Alex 2026-11-17): a labelled link names its site,
// and an email button's address is shown under the buttons.
import { describe, expect, test } from "vitest";
import type { CodeColourLimits } from "../editor/code-colours.ts";
import { contactAction, shownCards, cardViews as viewsWithin } from "./view.ts";

// The numbers interfaces/web limits.ts CODE_COLOUR_LIMITS has today; limits.code.test.ts tests those themselves.
const CODE_COLOURS: CodeColourLimits = { chars: 20_000, lineChars: 400, blockMs: 50, pageMs: 100 };
const cardViews = (cards: Parameters<typeof viewsWithin>[0], versions?: ReadonlyMap<string, string>) =>
  viewsWithin(cards, CODE_COLOURS, versions);

describe("card views", async () => {
  test("a_labelled_link_names_its_host_and_an_unlabelled_one_shows_the_host_as_its_text", async () => {
    const [card] = await cardViews([
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

  test("a_card_carries_its_version_only_where_the_page_gave_one", async () => {
    const readme = { kind: "readme", text: "Hi" } as const;
    const views = await cardViews(
      [
        { key: "a", width: "full", content: readme },
        { key: "b", width: "full", content: readme },
      ],
      new Map([["a", "bafyv"]]),
    );
    expect(views.map((view) => view.version)).toEqual(["bafyv", undefined]);
    expect("version" in ((await cardViews([{ key: "a", width: "full", content: readme }]))[0] ?? {})).toBe(false);
  });

  // Book P1.22h, rule SE-3: a page that edits nothing sends the browser what a card shows, never the record behind it.
  test("a_card_for_a_page_that_edits_nothing_is_what_it_shows_and_no_more", async () => {
    const text = "Typed **as Markdown**";
    const [card] = shownCards(
      await cardViews(
        [{ key: "k", width: "half", surface: "plain", content: { kind: "readme", text } }],
        new Map([["k", "v"]]),
      ),
    );
    expect(Object.keys(card ?? {}).sort()).toEqual(["key", "shown", "surface", "width"]);
    expect(card).toMatchObject({ key: "k", width: "half", surface: "plain", shown: { kind: "readme" } });
    expect(JSON.stringify(card)).not.toContain(text);
  });

  test("an_email_button_carries_its_address_and_a_link_button_none", async () => {
    const [card] = await cardViews([
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

test.each(["filled", "outlined", "plain"] as const)("the page keeps the stored %s surface", async (surface) => {
  const [card] = await cardViews([{ key: "k", width: "full", surface, content: { kind: "readme", text: "Hi" } }]);
  expect(card?.surface).toBe(surface);
});

// P1.21o: the header's About panel repeats the page's published contact action, never an account address.
describe("contact action", async () => {
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

  test("is the first button of the first Contact card", async () => {
    const cards = await cardViews([
      { key: "t", width: "full", content: { kind: "readme", text: "Hi" } },
      buttons("a", [
        { uri: "https://cal.example/me", label: "Book a call" },
        { uri: "https://example.org", label: "Other" },
      ]),
      buttons("b", [{ uri: "https://later.example", label: "Later" }]),
    ]);
    expect(contactAction(cards)).toEqual({ href: "https://cal.example/me", label: "Book a call" });
  });

  test("is none with no Contact card, or one whose buttons have no safe address", async () => {
    expect(
      contactAction(await cardViews([{ key: "t", width: "full", content: { kind: "readme", text: "Hi" } }])),
    ).toBeNull();
    expect(contactAction(await cardViews([buttons("a", [{ uri: "javascript:alert(1)", label: "x" }])]))).toBeNull();
  });
});

// Review of #2004 at e36de8a: a member's code is coloured inside the page load, so a page of hostile code blocks must
// still answer quickly, with the code as plain text. One Textile line of "<a " took 182 s before the limits.
describe("a page of hostile code", () => {
  const card = (key: string, language: string, code: string) => ({
    key,
    width: "full" as const,
    content: { kind: "readme" as const, text: `\`\`\`${language}\n${code}\n\`\`\`` },
  });
  /** `piece` repeated in lines of `width` characters, 20,000 in all. */
  const wrapped = (piece: string, width: number) =>
    (piece.repeat(Math.ceil(20_000 / piece.length)).match(new RegExp(`[^]{1,${width}}`, "g")) ?? []).join("\n");
  const hostile = [
    card("a", "textile", "<a ".repeat(6_000)),
    card("b", "textile", wrapped("<a ", 400)),
    card("c", "erlang", wrapped("/*", 400)),
    card("d", "coffeescript", wrapped("(", 400)),
    card("e", "less", wrapped("[", 400)),
    card("f", "scala", "/*".repeat(9_000)),
    card("g", "markdown", wrapped("*_", 400)),
  ];

  test("answers within the page's budget and shows every block as its text", async () => {
    const started = performance.now();
    const views = await viewsWithin([...hostile, ...hostile.map((c) => ({ ...c, key: `${c.key}2` }))], CODE_COLOURS);
    // The page's 100 ms, one more parser step (at most about 35 ms measured) and the Markdown parse; far under a second.
    expect(performance.now() - started).toBeLessThan(1_000);
    for (const [i, view] of views.entries()) {
      const block = view.shown.kind === "readme" ? view.shown.blocks[0] : undefined;
      const source = hostile[i % hostile.length]?.content.text ?? "";
      expect(block).toMatchObject({ kind: "code", text: source.slice(source.indexOf("\n") + 1, -4) });
    }
  });

  test("code in a known language within the limits is still coloured", async () => {
    const [view] = await cardViews([card("k", "js", "const a = 1;")]);
    expect(view?.shown).toMatchObject({
      kind: "readme",
      blocks: [{ kind: "code", runs: expect.arrayContaining([{ text: "const", colour: "code-keyword" }]) }],
    });
  });
});
