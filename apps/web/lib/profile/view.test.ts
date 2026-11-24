// What a card shows beside its own words (the profile-card mockup, Alex 2026-11-17): a labelled link names its site,
// and an email button's address is shown under the buttons.
import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import type { CodeColourLimits } from "../editor/code-colours.ts";
import { MAX_CHARS, parseReadme, readCardBlocks } from "./parse.ts";
import { nameTables } from "./place-sides.ts";
import { contactAction, shownCards, cardViews as viewsWithin } from "./view.ts";

// The numbers interfaces/web limits.ts CODE_COLOUR_LIMITS has today; limits.code.test.ts tests those themselves.
const CODE_COLOURS: CodeColourLimits = { chars: 20_000, lineChars: 400, blockMs: 50, pageMs: 100 };
const readme = (text: string) => ({ kind: "readme", text }) as const;
/** The page's cards with the parser itself as their reader, as a page with no reading limits would read them. */
const cardViews = (cards: Parameters<typeof viewsWithin>[0], versions?: ReadonlyMap<string, string>) =>
  viewsWithin(cards, parseReadme, CODE_COLOURS, versions);
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
/** As the page's server reads: tables named for placing looks (text-reader.ts readCard). */
const namedViews = (cards: Parameters<typeof viewsWithin>[0]) =>
  viewsWithin(cards, (text) => nameTables(text, readCardBlocks(text), sha256), CODE_COLOURS);

describe("card views", async () => {
  // ADR 0110 points 4-5, rule SE-3: a look's edges ride on the table it names, and the lines a table was written on
  // stay on the server, as does a look that names no table.
  test("a_look_is_drawn_on_the_table_it_names_and_no_table_carries_its_source_lines", async () => {
    const text = "| a | b |\n| --- | --- |\n| 1 | 2 |\n\n| x |\n| - |";
    const edge = { direction: "vertical", line: 1, cell: 0, hide: false } as const;
    const tableSides = [
      { lines: ["5860afe6", "a4f3b853"], edges: [edge] },
      { lines: ["00000000"], edges: [edge] },
    ];
    const [card] = await namedViews([{ key: "k", width: "full", content: { kind: "readme", text, tableSides } }]);
    const blocks = card?.shown.kind === "readme" ? card.shown.blocks : [];
    expect(blocks.map((block) => (block.kind === "table" ? Object.keys(block).sort() : block.kind))).toEqual([
      ["align", "edges", "head", "kind", "rows"],
      ["align", "head", "kind", "rows"],
    ]);
    expect(blocks[0]).toMatchObject({ edges: [edge] });
  });

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

// P1.21k: the page's server passes a reader that stops a slow parse, so every Text card must go through it.
test("every Text card is read by the reader the page passes, in page order", async () => {
  const read: string[] = [];
  const cards = await viewsWithin(
    [
      { key: "a", width: "full", content: { kind: "readme", text: "one" } },
      { key: "b", width: "full", content: { kind: "buttons", heading: "", text: "not Markdown", buttons: [] } },
      { key: "c", width: "full", content: { kind: "readme", text: "two" } },
    ],
    (text) => {
      read.push(text);
      return [{ kind: "rule" }];
    },
    CODE_COLOURS,
  );
  expect(read).toEqual(["one", "two"]);
  expect(cards.map((card) => card.shown)).toMatchObject([
    { kind: "readme", blocks: [{ kind: "rule" }] },
    { kind: "buttons" },
    { kind: "readme", blocks: [{ kind: "rule" }] },
  ]);
});

// The page's reader gives every load the same frozen blocks (interfaces/web text-reader.ts), so colouring must build
// its own code block and leave the reader's as it was; changing a frozen object throws here.
test("colouring code leaves the blocks the reader gave as they were", async () => {
  const frozen = <T>(value: T): T => {
    if (typeof value === "object" && value !== null) for (const inner of Object.values(value)) frozen(inner);
    return Object.freeze(value);
  };
  const read = frozen(parseReadme("words\n\n```js\nconst a = 1;\n```"));
  const before = JSON.stringify(read);
  const once = await viewsWithin([{ key: "a", width: "full", content: readme("x") }], () => read, CODE_COLOURS);
  const again = await viewsWithin([{ key: "a", width: "full", content: readme("x") }], () => read, CODE_COLOURS);
  expect(JSON.stringify(read)).toBe(before);
  for (const [view] of [once, again]) {
    expect(view?.shown).toMatchObject({
      kind: "readme",
      blocks: [
        { kind: "paragraph" },
        { kind: "code", runs: expect.arrayContaining([{ text: "const", colour: "code-keyword" }]) },
      ],
    });
  }
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
    const views = await viewsWithin(
      [...hostile, ...hostile.map((c) => ({ ...c, key: `${c.key}2` }))],
      parseReadme,
      CODE_COLOURS,
    );
    // The page's 100 ms, one more parser step (at most about 35 ms measured) and the Markdown parse; far under a second.
    expect(performance.now() - started).toBeLessThan(1_000);
    for (const [i, view] of views.entries()) {
      const block = view.shown.kind === "readme" ? view.shown.blocks[0] : undefined;
      const source = hostile[i % hostile.length]?.content.text ?? "";
      const code = source.slice(source.indexOf("\n") + 1, -4);
      // Plain text, and all of the code the page reads: the reader stops at its 20,000 characters (parse.ts
      // MAX_CHARS, P1.21k), which the wrapped cards pass by a few dozen with their line ends and fences.
      const shown = block?.kind === "code" && "text" in block ? block.text : null;
      expect(shown).not.toBeNull();
      expect(code.startsWith(shown ?? "not shown")).toBe(true);
      expect(shown?.length).toBeGreaterThanOrEqual(Math.min(code.length, MAX_CHARS - 100));
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
