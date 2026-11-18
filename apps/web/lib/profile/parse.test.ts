// The README parser's images and nested lists (staging walkthrough 2026-11-18, finding 7). The sweep for slow input
// is in apps/web/src/screens/profile/readme.adversarial.test.tsx.
import { describe, expect, test } from "vitest";
import { parseInline, parseReadme } from "./parse.ts";

const text = (t: string) => ({ kind: "text", text: t });
const item = (t: string, lists: unknown[] = []) => ({ text: [text(t)], lists });

describe("parseReadme", () => {
  test("an image is a link to it with its alt text, without the stray mark", () => {
    expect(parseInline("see ![a cat](https://example.com/cat.png) here")).toEqual([
      text("see "),
      { kind: "link", href: "https://example.com/cat.png", children: [text("a cat")] },
      text(" here"),
    ]);
  });

  test("an image whose address is refused stays text, as a link does", () => {
    expect(parseInline("![x](javascript:alert(1))")).toEqual([text("![x](javascript:alert(1))")]);
  });

  test("an item indented to the text of the one above is its own list, and lists of both kinds nest", () => {
    const src = ["- fruit", "  - apple", "  - pear", "    1. green", "- veg", "   1. leek"].join("\n");
    expect(parseReadme(src)).toEqual([
      {
        kind: "list",
        ordered: false,
        items: [
          item("fruit", [
            {
              kind: "list",
              ordered: false,
              items: [item("apple"), item("pear", [{ kind: "list", ordered: true, items: [item("green")] }])],
            },
          ]),
          item("veg", [{ kind: "list", ordered: true, items: [item("leek")] }]),
        ],
      },
    ]);
  });

  test("an item indented less than the text above is a sibling, and past three levels lists stop nesting", () => {
    expect(parseReadme("- a\n - b")).toEqual([{ kind: "list", ordered: false, items: [item("a"), item("b")] }]);
    const deep = ["- 1", "  - 2", "    - 3", "      - 4"].join("\n");
    const third = { kind: "list", ordered: false, items: [item("3"), item("4")] };
    expect(parseReadme(deep)).toEqual([
      {
        kind: "list",
        ordered: false,
        items: [item("1", [{ kind: "list", ordered: false, items: [item("2", [third])] }])],
      },
    ]);
  });
});
