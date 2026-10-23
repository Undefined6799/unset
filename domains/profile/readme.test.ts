// P2.20x: the README the owner's BlockNote editor posts, read into the lexicon's blocks (P2.20w). The documents below
// have BlockNote 0.56.0's shape: { type, props, content, children } blocks, { type: "text", text, styles } and
// { type: "link", href, content } inline content (@blocknote/core src/schema/blocks/types.ts, inlineContent/types.ts).
import { LIMITS, validateRecord } from "@unset/shared-lexicons";
import { describe, expect, test } from "vitest";
import { toProfileRecord } from "./profile.ts";
import { parseReadme, README_BYTES, readStoredReadme, toEditorDocument } from "./readme.ts";

const D = "sh.unset.profile#";
const text = (t: string, styles: Record<string, unknown> = {}) => ({ type: "text", text: t, styles });
const bn = (type: string, content: unknown = [], props: Record<string, unknown> = {}, children: unknown[] = []) => ({
  id: "x",
  type,
  props: { textColor: "default", backgroundColor: "default", textAlignment: "left", ...props },
  content,
  children,
});
const run = (t: string, styles: Record<string, true> = {}) => ({ $type: `${D}textRun`, text: t, ...styles });
const parsed = (document: unknown) => parseReadme(JSON.stringify(document));
const blocksOf = (document: unknown) => {
  const result = parsed(document);
  if (!result.ok) throw new Error(result.code);
  return result.readme.blocks;
};

describe("parseReadme", () => {
  test("reads each block type the README holds", () => {
    const blocks = blocksOf([
      bn("heading", [text("About me")], { level: 2 }),
      bn("paragraph", [text("I make "), text("small", { bold: true, textColor: "red" }), text(" tools.")]),
      bn("quote", [text("Less, but better.", { italic: true })]),
      bn("codeBlock", [text("npm test")], { language: "bash" }),
      bn("bulletListItem", [text("one")]),
      bn("numberedListItem", [text("two")]),
      bn("checkListItem", [text("three")], { checked: true }),
    ]);
    expect(blocks).toEqual([
      { $type: `${D}heading`, level: 2, content: [run("About me")] },
      { $type: `${D}paragraph`, content: [run("I make "), run("small", { bold: true }), run(" tools.")] },
      { $type: `${D}quote`, content: [run("Less, but better.", { italic: true })] },
      { $type: `${D}codeBlock`, text: "npm test", language: "bash" },
      { $type: `${D}listItem`, style: "bullet", content: [run("one")] },
      { $type: `${D}listItem`, style: "numbered", content: [run("two")] },
      { $type: `${D}listItem`, style: "check", checked: true, content: [run("three")] },
    ]);
  });

  test("what the README does not hold is dropped: colours, alignment, images, tables, unknown blocks", () => {
    const blocks = blocksOf([
      bn("image", undefined, { url: "https://evil.example/x.png" }, [bn("paragraph", [text("child")])]),
      bn("table", { type: "tableContent", rows: [] }),
      bn("paragraph", [text("kept", { textColor: "red", backgroundColor: "blue" })], { textAlignment: "center" }),
    ]);
    expect(blocks).toEqual([{ $type: `${D}paragraph`, content: [run("kept")] }]);
  });

  test("headings deeper than three read as level three", () => {
    expect(blocksOf([bn("heading", [text("h")], { level: 5 })])).toEqual([
      { $type: `${D}heading`, level: 3, content: [run("h")] },
    ]);
  });

  test("nested list items become indents, capped at the lexicon's deepest", () => {
    let item = bn("bulletListItem", [text("5")]);
    for (const n of ["4", "3", "2", "1"]) item = bn("bulletListItem", [text(n)], {}, [item]);
    const indents = blocksOf([item]).map((block) => ("indent" in block ? block.indent : 0));
    expect(indents).toEqual([0, 1, 2, 3, 3]);
  });

  test.each([
    "javascript:alert(1)",
    "data:text/html,<b>x</b>",
    "//evil.example",
    "/settings",
    "https://user:pw@evil.example",
  ])("a link to %s keeps its text and loses the link", (href) => {
    expect(blocksOf([bn("paragraph", [{ type: "link", href, content: [text("click")] }])])).toEqual([
      { $type: `${D}paragraph`, content: [run("click")] },
    ]);
  });

  test("an http(s) link is kept with its styled text", () => {
    const link = { type: "link", href: "https://alice.example/tidy", content: [text("Tidy", { bold: true })] };
    expect(blocksOf([bn("paragraph", [link])])).toEqual([
      {
        $type: `${D}paragraph`,
        content: [{ $type: `${D}linkRun`, uri: "https://alice.example/tidy", content: [run("Tidy", { bold: true })] }],
      },
    ]);
  });

  test("a column list of two or three columns becomes a columns block; one column reads as its blocks", () => {
    const column = (t: string) => ({ type: "column", props: { width: 1 }, children: [bn("paragraph", [text(t)])] });
    expect(blocksOf([{ type: "columnList", children: [column("a"), column("b")] }])).toEqual([
      {
        $type: `${D}columns`,
        columns: [
          { blocks: [{ $type: `${D}paragraph`, content: [run("a")] }] },
          { blocks: [{ $type: `${D}paragraph`, content: [run("b")] }] },
        ],
      },
    ]);
    expect(blocksOf([{ type: "columnList", children: [column("a")] }])).toEqual([
      { $type: `${D}paragraph`, content: [run("a")] },
    ]);
    expect(parsed([{ type: "columnList", children: ["a", "b", "c", "d"].map(column) }])).toEqual({
      ok: false,
      code: "profile.too_long",
    });
  });

  test("a document that is not a JSON array is refused", () => {
    expect(parseReadme("{")).toEqual({ ok: false, code: "profile.invalid" });
    expect(parseReadme('{"type":"paragraph"}')).toEqual({ ok: false, code: "profile.invalid" });
  });

  test("over the bounds is too long, never cut", () => {
    expect(parseReadme(" ".repeat(README_BYTES + 1))).toEqual({ ok: false, code: "profile.too_long" });
    const long = "x".repeat(LIMITS.profile.readmeRunText + 1);
    expect(parsed([bn("paragraph", [text(long)])])).toEqual({ ok: false, code: "profile.too_long" });
    const many = Array.from({ length: LIMITS.profile.readmeBlocksMax + 1 }, () => bn("paragraph", [text("a")]));
    expect(parsed(many)).toEqual({ ok: false, code: "profile.too_long" });
  });

  test("whatever is posted, the result is refused or a README the lexicon accepts", () => {
    const junk = (depth: number, seed: number): unknown => {
      const pick = seed % 7;
      if (depth > 3 || pick === 0) return ["text", 1, null, true, { $type: "x" }][seed % 5];
      if (pick === 1) return { type: "link", href: seed % 2 ? "https://a.example" : "javascript:x", content: [] };
      const types = ["paragraph", "heading", "columnList", "column", "codeBlock", "checkListItem", "evil"];
      return {
        type: types[seed % types.length],
        props: { level: seed % 9, checked: seed % 2 === 0, language: "<script>" },
        content: Array.from({ length: seed % 4 }, (_, i) => junk(depth + 1, seed * 31 + i)),
        children: Array.from({ length: seed % 3 }, (_, i) => junk(depth + 1, seed * 17 + i)),
      };
    };
    for (let seed = 1; seed < 400; seed++) {
      const result = parsed(Array.from({ length: seed % 5 }, (_, i) => junk(0, seed + i)));
      if (!result.ok) continue;
      const record = { $type: "sh.unset.profile", displayName: "A", createdAt: "2026-10-23T00:00:00.000Z" };
      expect(validateRecord("sh.unset.profile", { ...record, readme: result.readme }, "write").ok).toBe(true);
    }
  });
});

describe("readStoredReadme", () => {
  const stored = { blocks: [{ $type: `${D}paragraph`, content: [run("hi")] }] };

  test("a valid stored README is read as it is", () => {
    expect(readStoredReadme(stored)).toEqual(stored);
  });

  test("a block type this app does not render is skipped", () => {
    const later = { blocks: [{ $type: `${D}poll`, question: "?" }, ...stored.blocks] };
    expect(readStoredReadme(later)).toEqual(stored);
  });

  test("a README the staging preview stored as markdown reads as plain paragraphs", () => {
    expect(readStoredReadme("## About\n\nI make **small** tools.\n\n\n")).toEqual({
      blocks: [
        { $type: `${D}paragraph`, content: [run("## About")] },
        { $type: `${D}paragraph`, content: [run("I make **small** tools.")] },
      ],
    });
  });

  test("a README over the byte bound reads as none", () => {
    const big = Array.from({ length: 60 }, () => ({ $type: `${D}paragraph`, content: [run("x".repeat(2000))] }));
    expect(new TextEncoder().encode(JSON.stringify({ blocks: big })).length).toBeGreaterThan(README_BYTES);
    expect(readStoredReadme({ blocks: big })).toEqual({ blocks: [] });
  });

  test.each([[{ blocks: [{ $type: `${D}paragraph` }] }], [null], [42], ["x".repeat(2001)]])(
    "a README another client broke reads as none: %j",
    (value) => {
      expect(readStoredReadme(value)).toEqual({ blocks: [] });
    },
  );
});

describe("toProfileRecord with a README", () => {
  const NOW = "2026-10-23T22:00:00.000Z";
  const existing = { $type: "sh.unset.profile", displayName: "Alice", headline: "Hi", createdAt: NOW };
  const readme = blocksOf([bn("paragraph", [text("hello")])]);

  test("saving the README alone keeps the side column", () => {
    const built = toProfileRecord({ readme: { blocks: readme } }, existing, NOW);
    expect(built).toEqual({ ok: true, record: { ...existing, readme: { blocks: readme }, updatedAt: NOW } });
    expect(built.ok && validateRecord("sh.unset.profile", built.record, "write").ok).toBe(true);
  });

  test("saving the side column turns a markdown README into blocks, so the record still validates", () => {
    const legacy = { ...existing, readme: "Hello\n\nWorld" };
    const built = toProfileRecord({ headline: "New" }, legacy, NOW);
    expect(built).toEqual({
      ok: true,
      record: {
        ...existing,
        headline: "New",
        readme: {
          blocks: [
            { $type: `${D}paragraph`, content: [run("Hello")] },
            { $type: `${D}paragraph`, content: [run("World")] },
          ],
        },
        updatedAt: NOW,
      },
    });
  });

  test("an empty README removes it", () => {
    const withReadme = { ...existing, readme: { blocks: readme } };
    const built = toProfileRecord({ readme: { blocks: [] } }, withReadme, NOW);
    expect(built.ok && "readme" in built.record).toBe(false);
  });
});

describe("toEditorDocument", () => {
  const DEFS = "sh.unset.profile#";
  const text = (value: string) => ({ $type: `${DEFS}textRun` as const, text: value });

  test("editor_document_parses_back_to_the_same_readme", () => {
    const readme = {
      blocks: [
        { $type: `${DEFS}heading` as const, level: 2 as const, content: [text("About me")] },
        {
          $type: `${DEFS}paragraph` as const,
          content: [
            { ...text("I make "), bold: true as const },
            { $type: `${DEFS}linkRun` as const, uri: "https://example.com/", content: [text("tools")] },
          ],
        },
        { $type: `${DEFS}listItem` as const, style: "bullet" as const, content: [text("one")] },
        { $type: `${DEFS}listItem` as const, style: "bullet" as const, indent: 1, content: [text("under one")] },
        { $type: `${DEFS}listItem` as const, style: "check" as const, checked: true as const, content: [text("done")] },
        { $type: `${DEFS}codeBlock` as const, text: "let a = 1;", language: "ts" },
        { $type: `${DEFS}quote` as const, content: [text("Quiet.")] },
      ],
    };
    const parsed = parseReadme(JSON.stringify(toEditorDocument(readme)));
    expect(parsed).toEqual({ ok: true, readme });
  });

  test("editor_document_opens_columns_as_their_blocks_in_order", () => {
    const columns = {
      $type: `${DEFS}columns` as const,
      columns: [
        { blocks: [{ $type: `${DEFS}paragraph` as const, content: [text("left")] }] },
        { blocks: [{ $type: `${DEFS}paragraph` as const, content: [text("right")] }] },
      ],
    };
    expect(toEditorDocument({ blocks: [columns] }).map((block) => block.content)).toEqual([
      [{ type: "text", text: "left", styles: {} }],
      [{ type: "text", text: "right", styles: {} }],
    ]);
  });
});
