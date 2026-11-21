// The owner's unsaved Text cards (ADR 0074 item 4): what the bar counts, what Save posts and what a Save leaves.
import { describe, expect, test } from "vitest";
import type { CardView } from "./types.ts";
import { afterSave, edit, editsToSave, NO_EDITS, offeredAfterSave, onPage } from "./unsaved.ts";

const text = (key: string, words: string, version: string | null = `v-${key}`): CardView => ({
  key,
  width: "full",
  surface: "filled",
  content: { kind: "readme", text: words },
  shown: { kind: "readme", blocks: [] },
  ...(version === null ? {} : { version }),
});
const page = [text("a", "Hi"), text("b", "There"), text("c", "Again")];
/** The versions a Save's answer names: here, those the refresh read, as when no other tab wrote in between. */
const wrote = (cards: readonly CardView[]) =>
  new Map(cards.flatMap((card) => (card.version === undefined ? [] : [[card.key, card.version] as const])));
const whole = (cards: readonly CardView[]) => ({
  cards,
  profileUnavailable: false,
  cardsIncomplete: false,
  cardsOverflow: false,
});

describe("unsaved cards", () => {
  test("an_edit_is_kept_with_the_version_its_card_was_opened_at", () => {
    const edits = edit(NO_EDITS, page, "b", { fields: { text: "There!" } });
    expect([...edits]).toEqual([
      ["b", { version: "v-b", kind: "readme", width: "full", surface: "filled", fields: { text: "There!" } }],
    ]);
  });

  test("text_typed_back_to_what_is_stored_is_no_longer_unsaved", () => {
    const edits = edit(edit(NO_EDITS, page, "a", { fields: { text: "Hi!" } }), page, "a", { fields: { text: "Hi" } });
    expect(edits.size).toBe(0);
  });

  test("a_card_with_no_version_or_not_a_text_card_is_not_kept", () => {
    const links: CardView = { ...text("l", ""), content: { kind: "links", title: "", layout: "list", items: [] } };
    expect(edit(NO_EDITS, [text("a", "Hi", null)], "a", { fields: { text: "Hi!" } }).size).toBe(0);
    expect(edit(NO_EDITS, [links], "l", { fields: { text: "x" } }).size).toBe(0);
    expect(edit(NO_EDITS, page, "gone", { fields: { text: "x" } }).size).toBe(0);
  });

  test("a_field_the_card_s_kind_does_not_have_is_dropped", () => {
    const edits = edit(NO_EDITS, page, "a", { fields: { text: "Hey", title: "x" } });
    expect(edits.get("a")?.fields).toEqual({ text: "Hey" });
    expect(edit(NO_EDITS, page, "a", { fields: { title: "x" } }).size).toBe(0);
  });

  test("a_width_or_style_chosen_is_unsaved_with_the_text_and_choosing_back_clears_it", () => {
    const half = edit(NO_EDITS, page, "a", { width: "half" });
    expect(half.get("a")).toEqual({
      version: "v-a",
      kind: "readme",
      width: "half",
      surface: "filled",
      fields: { text: "Hi" },
    });
    const both = edit(half, page, "a", { surface: "plain", fields: { text: "Hey" } });
    expect(both.get("a")).toEqual({
      version: "v-a",
      kind: "readme",
      width: "half",
      surface: "plain",
      fields: { text: "Hey" },
    });
    expect(
      edit(edit(both, page, "a", { fields: { text: "Hi" } }), page, "a", { width: "full", surface: "filled" }).size,
    ).toBe(0);
  });

  test("save_posts_the_edits_in_page_order_with_each_card_s_chosen_width_and_style", () => {
    let edits = edit(NO_EDITS, page, "c", { fields: { text: "Once more" } });
    edits = edit(edits, page, "a", { fields: { text: "Hello" } });
    edits = edit(edits, page, "c", { width: "half" });
    expect(editsToSave(edits, page)).toEqual([
      { key: "a", version: "v-a", kind: "readme", width: "full", surface: "filled", fields: { text: "Hello" } },
      { key: "c", version: "v-c", kind: "readme", width: "half", surface: "filled", fields: { text: "Once more" } },
    ]);
  });

  test("a_card_deleted_since_it_was_edited_is_not_posted", () => {
    const edits = edit(NO_EDITS, page, "b", { fields: { text: "There!" } });
    expect(editsToSave(edits, [text("a", "Hi")])).toEqual([]);
  });

  test("after_a_save_only_the_cards_it_did_not_write_stay_unsaved", () => {
    let edits = edit(NO_EDITS, page, "a", { fields: { text: "Hello" } });
    edits = edit(edits, page, "b", { fields: { text: "World" } });
    const stored = [text("a", "Hello", "v-a2"), text("b", "World", "v-b2")];
    expect([...afterSave(edits, editsToSave(edits, page).slice(0, 1), wrote(stored), stored, page).keys()]).toEqual([
      "b",
    ]);
    expect(afterSave(edits, editsToSave(edits, page), wrote(stored), stored, page).size).toBe(0);
  });

  // Review of f6c6a2f: words typed while a Save is on its way must not be lost when its answer comes.
  test("after_a_save_a_card_typed_into_during_it_stays_unsaved_on_its_new_version", () => {
    const sent = edit(edit(NO_EDITS, page, "a", { fields: { text: "Hello" } }), page, "b", {
      fields: { text: "World" },
    });
    const typed = edit(sent, page, "a", { fields: { text: "Hello there" } });
    const stored = [text("a", "Hello", "v-a2"), text("b", "World", "v-b2"), text("c", "Again")];
    const left = afterSave(typed, editsToSave(sent, page), wrote(stored), stored, page);
    expect([...left.keys()]).toEqual(["a"]);
    expect(left.get("a")).toMatchObject({ version: "v-a2", fields: { text: "Hello there" } });
  });

  test("after_a_save_a_card_it_did_not_write_keeps_its_version", () => {
    const sent = edit(edit(NO_EDITS, page, "a", { fields: { text: "Hello" } }), page, "b", {
      fields: { text: "World" },
    });
    const stored = [text("a", "Hello", "v-a2"), text("b", "There"), text("c", "Again")];
    const left = afterSave(sent, editsToSave(sent, page).slice(0, 1), wrote(stored), stored, page);
    expect([...left]).toEqual([["b", sent.get("b")]]);
  });

  test("after_a_save_a_card_typed_back_to_what_was_just_written_is_saved", () => {
    const sent = edit(NO_EDITS, page, "a", { fields: { text: "Hello" } });
    const retyped = edit(edit(sent, page, "a", { fields: { text: "Hello!" } }), page, "a", {
      fields: { text: "Hello" },
    });
    expect(
      afterSave(
        retyped,
        editsToSave(sent, page),
        wrote([text("a", "Hello", "v-a2")]),
        [text("a", "Hello", "v-a2")],
        page,
      ).size,
    ).toBe(0);
  });

  // Codex on 1bdb437: the server trims the words and turns CRLF into LF before storing them (domains/profile
  // card-edit.ts field()), so what is stored can differ from what was sent while nothing new was typed.
  test("after_a_save_a_card_the_server_tidied_is_saved", () => {
    const sent = edit(NO_EDITS, page, "a", { fields: { text: "  Hello\r\nthere  " } });
    expect(
      afterSave(
        sent,
        editsToSave(sent, page),
        wrote([text("a", "Hello\nthere", "v-a2")]),
        [text("a", "Hello\nthere", "v-a2")],
        page,
      ).size,
    ).toBe(0);
  });

  // Codex on b7db900: words put back to what was stored while the Save was on its way are now a change from what it
  // wrote, so they stay unsaved on the new version rather than being replaced by the words just written.
  test("after_a_save_words_put_back_during_it_stay_unsaved", () => {
    const sent = edit(NO_EDITS, page, "a", { fields: { text: "Changed" } });
    const toSend = editsToSave(sent, page);
    const putBack = edit(sent, page, "a", { fields: { text: "Hi" } });
    expect(putBack.size).toBe(0);
    const left = afterSave(
      putBack,
      toSend,
      wrote([text("a", "Changed", "v-a2")]),
      [text("a", "Changed", "v-a2")],
      page,
    );
    expect(left.get("a")).toMatchObject({ version: "v-a2", fields: { text: "Hi" } });
  });

  // Codex on b7db900: a refresh that could not read the written card confirms nothing, so newer words stay.
  test("after_a_save_a_written_card_the_refresh_did_not_read_keeps_newer_words", () => {
    const sent = edit(NO_EDITS, page, "a", { fields: { text: "Hello" } });
    const typed = edit(sent, page, "a", { fields: { text: "Hello there" } });
    const left = afterSave(typed, editsToSave(sent, page), wrote([]), [], page);
    expect(left.get("a")).toMatchObject({ version: "v-a", fields: { text: "Hello there" } });
    expect(afterSave(sent, editsToSave(sent, page), wrote([]), [], page).size).toBe(0);
  });

  // Codex on e6d4d1d: a Width or Style change written while an earlier draft is offered moves that draft to the
  // version just written, so bringing it back and saving is no conflict. One that began on another version keeps it.
  test("an_offered_draft_moves_to_the_version_its_card_s_layout_save_wrote", () => {
    const layout = edit(NO_EDITS, page, "a", { width: "half" });
    const offered = new Map([
      ["a", { version: "v-a", text: "Draft words" }],
      ["b", { version: "v-b-old", text: "Older" }],
    ]);
    const withB = edit(layout, page, "b", { width: "half" });
    const stored = [text("a", "Hi", "v-a2"), text("b", "There", "v-b2")];
    const moved = offeredAfterSave(offered, editsToSave(withB, page), wrote(stored));
    expect(moved.get("a")).toEqual({ version: "v-a2", text: "Draft words" });
    expect(moved.get("b")).toEqual({ version: "v-b-old", text: "Older" });
    expect(offeredAfterSave(offered, [], wrote(stored))).toBe(offered);
  });

  // Codex on ca2c7b1: an edit that began on another version than the Save sent (a draft brought back while the Save
  // was on its way) keeps its own version, so the next Save still names the change made elsewhere.
  test("after_a_save_an_edit_on_another_version_keeps_it", () => {
    const sent = edit(NO_EDITS, page, "a", { width: "half" });
    const layout = editsToSave(sent, page)[0];
    if (layout === undefined) throw new Error("the Width change is unsaved");
    const restored = new Map(sent).set("a", { ...layout, version: "v-a-old", fields: { text: "Draft" } });
    const left = afterSave(
      restored,
      editsToSave(sent, page),
      wrote([text("a", "Hi", "v-a2")]),
      [text("a", "Hi", "v-a2")],
      page,
    );
    expect(left.get("a")).toMatchObject({ version: "v-a-old", fields: { text: "Draft" } });
  });

  // Codex on c6cddd7: another tab wrote the card after this Save landed and before the refresh read it. Words typed
  // during this Save stay on the version this Save wrote, so the next Save is refused as a conflict instead of
  // writing over the other tab's words; an answer that names no version keeps them on their own.
  test("after_a_save_words_typed_during_it_settle_on_the_version_it_wrote_not_on_one_read_later", () => {
    const sent = edit(NO_EDITS, page, "a", { fields: { text: "Hello" } });
    const typed = edit(sent, page, "a", { fields: { text: "Hello there" } });
    const elsewhere = [text("a", "Other tab", "v-a3")];
    const left = afterSave(typed, editsToSave(sent, page), new Map([["a", "v-a2"]]), elsewhere, page);
    expect(left.get("a")).toMatchObject({ version: "v-a2", fields: { text: "Hello there" } });
    const unnamed = afterSave(typed, editsToSave(sent, page), new Map(), elsewhere, page);
    expect(unnamed.get("a")).toMatchObject({ version: "v-a", fields: { text: "Hello there" } });
    // Words that match what the other tab wrote are still a change from what this Save wrote.
    const same = edit(sent, page, "a", { fields: { text: "Other tab" } });
    const kept = afterSave(same, editsToSave(sent, page), new Map([["a", "v-a2"]]), elsewhere, page);
    expect(kept.get("a")).toMatchObject({ version: "v-a2" });
    const offered = new Map([["a", { version: "v-a", text: "Draft" }]]);
    const layout = editsToSave(edit(NO_EDITS, page, "a", { width: "half" }), page);
    expect(offeredAfterSave(offered, layout, new Map([["a", "v-a2"]])).get("a")).toEqual({
      version: "v-a2",
      text: "Draft",
    });
    expect(offeredAfterSave(offered, layout, new Map())).toBe(offered);
  });

  // Codex on 1bdb437: a card deleted from its menu leaves nothing unsaved behind.
  test("a_card_no_longer_on_the_page_is_no_longer_unsaved", () => {
    const edits = edit(edit(NO_EDITS, page, "a", { fields: { text: "Hello" } }), page, "b", {
      fields: { text: "World" },
    });
    expect([...onPage(edits, whole([text("a", "Hi"), text("c", "Again")])).keys()]).toEqual(["a"]);
    expect(onPage(edits, whole(page))).toBe(edits);
  });

  // Review of 700ae94: a read that failed (no cards) or stopped early is not a delete, so every edit stays.
  test("a_read_that_was_not_whole_drops_no_edit", () => {
    const edits = edit(NO_EDITS, page, "a", { fields: { text: "Hello" } });
    expect(onPage(edits, { ...whole([]), profileUnavailable: true })).toBe(edits);
    expect(onPage(edits, { ...whole([text("b", "There")]), cardsIncomplete: true })).toBe(edits);
    expect(onPage(edits, { ...whole([text("b", "There")]), cardsOverflow: true })).toBe(edits);
  });
});
