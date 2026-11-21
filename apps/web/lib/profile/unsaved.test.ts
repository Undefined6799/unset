// The owner's unsaved Text cards (ADR 0074 item 4): what the bar counts, what Save posts and what a Save leaves.
import { describe, expect, test } from "vitest";
import type { CardView } from "./types.ts";
import { afterSave, edit, editsToSave, NO_EDITS } from "./unsaved.ts";

const text = (key: string, words: string, version: string | null = `v-${key}`): CardView => ({
  key,
  width: "full",
  surface: "filled",
  content: { kind: "readme", text: words },
  shown: { kind: "readme", blocks: [] },
  ...(version === null ? {} : { version }),
});
const page = [text("a", "Hi"), text("b", "There"), text("c", "Again")];

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
    expect([...afterSave(edits, ["a"], stored).keys()]).toEqual(["b"]);
    expect(afterSave(edits, ["a", "b"], stored).size).toBe(0);
  });

  // Review of f6c6a2f: words typed while a Save is on its way must not be lost when its answer comes.
  test("after_a_save_a_card_typed_into_during_it_stays_unsaved_on_its_new_version", () => {
    const sent = edit(edit(NO_EDITS, page, "a", { fields: { text: "Hello" } }), page, "b", {
      fields: { text: "World" },
    });
    const typed = edit(sent, page, "a", { fields: { text: "Hello there" } });
    const stored = [text("a", "Hello", "v-a2"), text("b", "World", "v-b2"), text("c", "Again")];
    const left = afterSave(typed, ["a", "b"], stored);
    expect([...left.keys()]).toEqual(["a"]);
    expect(left.get("a")).toMatchObject({ version: "v-a2", fields: { text: "Hello there" } });
  });

  test("after_a_save_a_card_it_did_not_write_keeps_its_version", () => {
    const sent = edit(edit(NO_EDITS, page, "a", { fields: { text: "Hello" } }), page, "b", {
      fields: { text: "World" },
    });
    const stored = [text("a", "Hello", "v-a2"), text("b", "There"), text("c", "Again")];
    const left = afterSave(sent, ["a"], stored);
    expect([...left]).toEqual([["b", sent.get("b")]]);
  });

  test("after_a_save_a_card_typed_back_to_what_was_just_written_is_saved", () => {
    const sent = edit(NO_EDITS, page, "a", { fields: { text: "Hello" } });
    const retyped = edit(edit(sent, page, "a", { fields: { text: "Hello!" } }), page, "a", {
      fields: { text: "Hello" },
    });
    expect(afterSave(retyped, ["a"], [text("a", "Hello", "v-a2")]).size).toBe(0);
  });
});
