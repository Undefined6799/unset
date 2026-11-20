// The card names the owner's controls and the delete confirm use (messages.ts cardName). Outside audit of staging,
// 2026-11-19: "Delete this card?" did not say which card, and a Contact card with no heading named nothing.
import { describe, expect, test } from "vitest";
import { CARD_EDIT, cardName } from "./messages.ts";

describe("cardName", () => {
  test.each([
    ["a Text card", { kind: "readme", text: "# Hi" }, "Text"],
    ["links with a title", { kind: "links", title: "Elsewhere", layout: "list", items: [] }, "Elsewhere"],
    ["links with none", { kind: "links", title: "", layout: "list", items: [] }, "Links"],
    ["a collection with none", { kind: "collection", title: "", layout: "grid", items: [] }, "Collection"],
    ["a Contact card with a heading", { kind: "buttons", heading: "Say hi", text: "", buttons: [] }, "Say hi"],
    ["a Contact card with none", { kind: "buttons", heading: "", text: "", buttons: [] }, "Contact"],
  ] as const)("%s is named %s", (_name, content, expected) => {
    expect(cardName(content)).toBe(expected);
  });

  test("the delete confirm names the card", () => {
    expect(CARD_EDIT.removeTitle("Elsewhere")).toBe("Delete Elsewhere card?");
  });
});
