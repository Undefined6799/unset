import type { CardKey, CardVersion } from "@unset/domains-profile";
import { describe, expect, test } from "vitest";
import type { CardEdit } from "./card-writes.server.ts";
import { partialMessage } from "./save-message.server.ts";

const V = "bafyreie5737gdxlw5i64vzichcalba3z2v5n6icifvx5xytvske7mr3hpm" as CardVersion;
const readme = (key: string, text: string): CardEdit => ({
  key: key as CardKey,
  version: V,
  content: { kind: "readme", text },
  width: "full",
});

describe("partialMessage", () => {
  test("names the cards saved and the cards not, as each reads on the page", () => {
    const edits = [
      readme("a", "\n## About me\nI make things."),
      readme("b", "> Reading list"),
      { ...readme("c", ""), content: { kind: "links", title: "Elsewhere", layout: "list", items: [] } } as CardEdit,
    ];
    expect(partialMessage(edits, ["a" as CardKey, "c" as CardKey])).toBe(
      "Some of your cards were saved: “About me”, “Elsewhere”. Not saved yet: “Reading list”. " +
        "Save again to save the rest.",
    );
  });

  test("a long first line is cut short, and a card with no words is untitled", () => {
    const edits = [readme("a", "x".repeat(100)), readme("b", "   ")];
    expect(partialMessage(edits, ["a" as CardKey])).toBe(
      `Some of your cards were saved: “${"x".repeat(40)}…”. Not saved yet: “Untitled card”. ` +
        "Save again to save the rest.",
    );
  });
});
