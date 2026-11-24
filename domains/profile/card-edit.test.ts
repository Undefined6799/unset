// Writing profile cards (ADR 0051): the editor's input checked once, and the record that goes to the member's PDS.
import { LIMITS, validateRecord } from "@unset/shared-lexicons";
import { describe, expect, test } from "vitest";
import { CARD_EDIT_LIMITS, parseCardInput, reorderCards, TEXT_EDIT_BYTES, toCardRecord } from "./card-edit.ts";
import { parseCardKey } from "./cards.ts";
import { MAX_RECORD_BYTES } from "./index-plan.ts";

const NOW = "2026-11-17T05:00:00.000Z";
const T1 = "2026-11-01T00:00:00.000Z";
const key = (raw: string) => {
  const parsed = parseCardKey(raw);
  if (parsed === null) throw new Error(`bad key ${raw}`);
  return parsed;
};
const stored = (content: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  $type: "sh.unset.card",
  content,
  createdAt: T1,
  ...extra,
});
/** Each kind's block (ADR 0086), and the buttons block's two button defs. */
const REFS: Record<string, string> = {
  readme: "sh.unset.block.text",
  links: "sh.unset.block.links",
  collection: "sh.unset.block.showcase",
  buttons: "sh.unset.block.buttons",
  image: "sh.unset.block.images",
  emailButton: "sh.unset.block.buttons#email",
  linkButton: "sh.unset.block.buttons#link",
};
const ref = (kind: string) => REFS[kind] ?? `sh.unset.block.${kind}`;

describe("parseCardInput", () => {
  test("text.edit_limit: the editor writes at most 10,000 bytes of Markdown, under the lexicon's 20,000", () => {
    // Alex 2026-11-21 18:55Z. Counted in UTF-8 bytes, as the lexicon counts: "é" is two.
    expect(TEXT_EDIT_BYTES).toBe(10_000);
    expect(TEXT_EDIT_BYTES).toBeLessThan(LIMITS.card.textBytes);
    expect(parseCardInput({ kind: "readme", text: "é".repeat(5_000) })).toMatchObject({ ok: true });
    expect(parseCardInput({ kind: "readme", text: `${"é".repeat(5_000)}a` })).toEqual({
      ok: false,
      code: "card.too_long",
      field: "text",
    });
  });

  test("trims fields, adds https to bare addresses and drops empty optional fields", () => {
    const parsed = parseCardInput({
      kind: "links",
      width: "half",
      title: "  Elsewhere ",
      items: [{ uri: " github.com/alice ", label: "", description: " Code " }],
    });
    expect(parsed).toEqual({
      ok: true,
      width: "half",
      content: {
        kind: "links",
        title: "Elsewhere",
        layout: "list",
        items: [{ uri: "https://github.com/alice", label: "", description: "Code" }],
      },
    });
  });

  test("README text keeps its line breaks, with CRLF made LF", () => {
    expect(parseCardInput({ kind: "readme", text: "# Hi\r\n\r\nThere\n" })).toEqual({
      ok: true,
      width: "full",
      content: { kind: "readme", text: "# Hi\n\nThere" },
    });
  });

  test("multi-line text keeps its tabs", () => {
    expect(parseCardInput({ kind: "readme", text: "a\n\tb" })).toMatchObject({ ok: true, content: { text: "a\n\tb" } });
  });

  test.each([
    [{ kind: "video" }, "card.kind_unknown"],
    [{ kind: "readme", text: "  " }, "card.required", "text"],
    [{ kind: "buttons", heading: "", buttons: [] }, "card.required", "heading"],
    [{ kind: "collection", items: [{ title: "a" }, { title: "" }] }, "card.required", "items.1.title"],
    [{ kind: "links", items: [{ uri: "javascript:alert(1)" }] }, "card.url_invalid", "items.0.uri"],
    [{ kind: "links", items: [{ uri: "https://a@b.example" }] }, "card.url_invalid", "items.0.uri"],
    [
      { kind: "buttons", heading: "Hi", buttons: [{ kind: "email", address: "a@b" }] },
      "card.email_invalid",
      "buttons.0.address",
    ],
    [
      { kind: "buttons", heading: "Hi", buttons: [{ kind: "email", address: "a@b.example?bcc=c@d.example" }] },
      "card.email_invalid",
      "buttons.0.address",
    ],
    [
      { kind: "buttons", heading: "Hi", buttons: [{ kind: "link", preset: "tip", uri: "x.example" }] },
      "card.invalid",
      "buttons.0",
    ],
    [{ kind: "links", items: "x" }, "card.invalid"],
    [{ kind: "links", layout: "masonry", items: [] }, "card.invalid"],
    [{ kind: "readme", text: "x", width: "third" }, "card.invalid"],
    [{ kind: "links", title: ["x"], items: [] }, "card.invalid", "title"],
    [{ kind: "links", title: "a\nb", items: [] }, "card.invalid", "title"],
    // Staging break test 2026-11-21: the index leaves out a record with a NUL, so the save refuses it.
    [{ kind: "readme", text: "a\u0000b" }, "card.invalid", "text"],
    [{ kind: "readme", text: "a\ud800b" }, "card.invalid", "text"],
    [{ kind: "links", title: "a\u0007b", items: [] }, "card.invalid", "title"],
    [{ kind: "links", items: [{ uri: "https://a.example/", label: "a\u0000" }] }, "card.invalid", "items.0.label"],
    [{ kind: "buttons", heading: "Hi", text: "a\u001bb", buttons: [] }, "card.invalid", "text"],
  ])("refuses %j with %s, naming the field to blame", (input, code, field?: string) => {
    expect(parseCardInput(input)).toEqual(field === undefined ? { ok: false, code } : { ok: false, code, field });
  });

  test.each([
    [{ kind: "buttons", heading: "x".repeat(121), buttons: [{ kind: "email", address: "a@b.example" }] }, "heading"],
    [
      { kind: "links", items: [{ uri: "https://a.example/" }, { uri: "https://b.example/", label: "x".repeat(101) }] },
      "items.1.label",
    ],
  ])("text past the lexicon's limit is refused with its field, from the validator's path", (input, field) => {
    expect(parseCardInput(input)).toEqual({ ok: false, code: "card.too_long", field });
  });

  test("a list longer than the lexicon allows is refused", () => {
    const items = Array.from({ length: 101 }, (_, i) => ({ uri: `https://x.example/${i}` }));
    expect(parseCardInput({ kind: "links", items })).toEqual({ ok: false, code: "card.too_long" });
    const buttons = Array.from({ length: 6 }, () => ({ kind: "email", address: "a@b.example" }));
    expect(parseCardInput({ kind: "buttons", heading: "Hi", buttons })).toEqual({ ok: false, code: "card.too_long" });
  });
});

// What the save accepts, the index keeps (book P3.12v): a record the index would skip is refused at save, the stored
// fields an edit keeps included, so the owner never sees a card the public page leaves out.
describe("a card the index would leave out is refused at save", () => {
  test("kept fields past the index's size refuse the edit as too long", () => {
    const input = parseCardInput({ kind: "readme", text: "hi" });
    if (!input.ok) throw new Error(input.code);
    const existing = stored({ $type: ref("readme"), text: "old" }, { note: "x".repeat(MAX_RECORD_BYTES) });
    expect(toCardRecord(input.content, input.width, existing, NOW)).toEqual({ ok: false, code: "card.too_long" });
  });
});

describe("toCardRecord", () => {
  const parsed = (input: Record<string, unknown>) => {
    const result = parseCardInput(input);
    if (!result.ok) throw new Error(result.code);
    return result;
  };

  test.each([
    { kind: "readme", text: "Hello" },
    { kind: "links", title: "Me", layout: "grid", items: [{ uri: "https://x.example", label: "X", description: "d" }] },
    { kind: "collection", items: [{ title: "A", tag: "T", description: "D", uri: "https://a.example" }] },
    {
      kind: "buttons",
      heading: "Hi",
      text: "Say hello",
      buttons: [
        { kind: "email", address: "a@b.example" },
        { kind: "link", preset: "custom", uri: "https://x.example", label: "Go" },
      ],
    },
  ])("a new $kind card passes the strict validator", (input) => {
    const { content, width } = parsed(input);
    const built = toCardRecord(content, width, null, NOW);
    expect(built.ok).toBe(true);
    expect(built.ok && built.record.createdAt).toBe(NOW);
    expect(built.ok && validateRecord("sh.unset.card", built.record, "write")).toMatchObject({ ok: true });
  });

  test("empty optional fields and the default width are not written", () => {
    const { content, width } = parsed({ kind: "collection", items: [{ title: "A" }] });
    expect(toCardRecord(content, width, null, NOW)).toEqual({
      ok: true,
      record: {
        $type: "sh.unset.card",
        content: { $type: ref("collection"), layout: "carousel", items: [{ title: "A" }] },
        createdAt: NOW,
      },
    });
  });

  test("an edit keeps createdAt and fields this version does not know", () => {
    const existing = stored({ $type: ref("readme"), text: "old", mood: "calm" }, { pinned: true });
    const { content, width } = parsed({ kind: "readme", text: "new", width: "half" });
    expect(toCardRecord(content, width, existing, NOW)).toEqual({
      ok: true,
      record: {
        $type: "sh.unset.card",
        pinned: true,
        width: "half",
        content: { $type: ref("readme"), mood: "calm", text: "new" },
        createdAt: T1,
      },
    });
  });

  test("a kept link, entry or button keeps the fields another client added to it", () => {
    const links = stored({
      $type: ref("links"),
      layout: "list",
      items: [
        { uri: "https://a.example", label: "A", rel: "me" },
        { uri: "https://b.example", pinned: true },
      ],
    });
    const edit = parsed({
      kind: "links",
      title: "Mine",
      items: [{ uri: "https://a.example", label: "A2" }, { uri: "https://c.example" }],
    });
    const built = toCardRecord(edit.content, edit.width, links, NOW);
    // The first link is the same address, so it keeps `rel`; the second changed, so `pinned` goes with the old one.
    expect(built.ok && built.record.content).toMatchObject({
      items: [{ uri: "https://a.example", label: "A2", rel: "me" }, { uri: "https://c.example" }],
    });
    expect(built.ok && (built.record.content as { items: object[] }).items[1]).not.toHaveProperty("pinned");

    const buttons = stored({
      $type: ref("buttons"),
      heading: "Hi",
      buttons: [{ $type: ref("emailButton"), address: "a@b.example", note: 1 }],
    });
    const again = parsed({ kind: "buttons", heading: "Hi", buttons: [{ kind: "email", address: "a@b.example" }] });
    const kept = toCardRecord(again.content, again.width, buttons, NOW);
    expect(kept.ok && kept.record.content).toMatchObject({
      buttons: [{ $type: ref("emailButton"), address: "a@b.example", note: 1 }],
    });
  });

  test("an entry with no address keeps its fields only while all its own fields match", () => {
    const collection = stored({
      $type: ref("collection"),
      layout: "grid",
      items: [
        { title: "Project A", note: "belongs to A" },
        { title: "Project B", note: "belongs to B" },
      ],
    });
    // Project A is deleted, so Project B moves into its place: it must not take A's note.
    const removed = parsed({ kind: "collection", layout: "grid", items: [{ title: "Project B" }] });
    const built = toCardRecord(removed.content, removed.width, collection, NOW);
    expect(built.ok && (built.record.content as { items: object[] }).items[0]).not.toHaveProperty("note");
    // Unchanged in place, it keeps its own.
    const same = parsed({
      kind: "collection",
      layout: "grid",
      items: [{ title: "Project A" }, { title: "Project B" }],
    });
    const kept = toCardRecord(same.content, same.width, collection, NOW);
    expect(kept.ok && kept.record.content).toMatchObject({
      items: [
        { title: "Project A", note: "belongs to A" },
        { title: "Project B", note: "belongs to B" },
      ],
    });
  });

  test("changing a card's kind drops the old content's unknown fields", () => {
    const existing = stored({ $type: ref("readme"), text: "old", mood: "calm" });
    const { content, width } = parsed({ kind: "links", items: [{ uri: "https://x.example" }] });
    const built = toCardRecord(content, width, existing, NOW);
    expect(built.ok && built.record.content).toEqual({
      $type: ref("links"),
      layout: "list",
      items: [{ uri: "https://x.example" }],
    });
  });

  test.each([
    { kind: "links", title: "Elsewhere", items: [] },
    { kind: "links" },
    { kind: "collection", title: "Work", items: [] },
    { kind: "buttons", heading: "Work with me", buttons: [] },
  ])("a list card with no rows is refused as empty: %j", (input) => {
    expect(parseCardInput(input)).toEqual({ ok: false, code: "card.empty" });
  });

  test("text past the lexicon's limit is refused here too", () => {
    const content = {
      kind: "buttons",
      heading: "x".repeat(121),
      text: "",
      buttons: [{ kind: "email", address: "a@b.example" }],
    } as const;
    expect(toCardRecord(content, "full", null, NOW)).toEqual({ ok: false, code: "card.too_long" });
  });

  test("the editor adds at most its own limit of rows, under the lexicon's", () => {
    expect(CARD_EDIT_LIMITS.links).toBeLessThanOrEqual(LIMITS.card.linksMax);
    expect(CARD_EDIT_LIMITS.collection).toBeLessThanOrEqual(LIMITS.card.entriesMax);
    expect(CARD_EDIT_LIMITS.buttons).toBeLessThanOrEqual(LIMITS.card.buttonsMax);
    const links = (n: number) => Array.from({ length: n }, (_, i) => ({ uri: `https://x.example/${i}` }));
    const at = parsed({ kind: "links", items: links(CARD_EDIT_LIMITS.links) });
    expect(toCardRecord(at.content, at.width, null, NOW).ok).toBe(true);
    const past = parsed({ kind: "links", items: links(CARD_EDIT_LIMITS.links + 1) });
    expect(toCardRecord(past.content, past.width, null, NOW)).toEqual({ ok: false, code: "card.too_long" });
    const entries = Array.from({ length: CARD_EDIT_LIMITS.collection + 1 }, (_, i) => ({ title: `e${i}` }));
    const many = parsed({ kind: "collection", items: entries });
    expect(toCardRecord(many.content, many.width, null, NOW)).toEqual({ ok: false, code: "card.too_long" });
  });

  test("a stored card past the editor's limit can still be saved, but never grows", () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ uri: `https://x.example/${i}` }));
    const existing = stored({ $type: ref("links"), layout: "list", items: rows(40) });
    const same = parsed({ kind: "links", items: rows(40) });
    expect(toCardRecord(same.content, same.width, existing, NOW).ok).toBe(true);
    const fewer = parsed({ kind: "links", items: rows(35) });
    expect(toCardRecord(fewer.content, fewer.width, existing, NOW).ok).toBe(true);
    const more = parsed({ kind: "links", items: rows(41) });
    expect(toCardRecord(more.content, more.width, existing, NOW)).toEqual({ ok: false, code: "card.too_long" });
    const asReadme = stored({ $type: ref("readme"), text: "x" });
    expect(toCardRecord(same.content, same.width, asReadme, NOW)).toEqual({ ok: false, code: "card.too_long" });
  });

  test("an emptied optional field is removed, never kept from the old record", () => {
    const item = { uri: "https://x.example" };
    const existing = stored({ $type: ref("links"), title: "Old", items: [item] });
    const { content, width } = parsed({ kind: "links", items: [item] });
    const built = toCardRecord(content, width, existing, NOW);
    expect(built.ok && built.record.content).toEqual({
      $type: ref("links"),
      layout: "list",
      items: [item],
    });
  });
});

describe("reorderCards", () => {
  const keys = [key("a"), key("b"), key("c")];

  test("accepts exactly the existing keys in a new order", () => {
    expect(reorderCards(["c", "a", "b"], keys)).toEqual({ ok: true, order: ["c", "a", "b"] });
  });

  test.each([[["a", "b"]], [["a", "b", "c", "d"]], [["a", "a", "b"]], [["a", "b", 3]], ["a,b,c"]])(
    "refuses %j, so a card added or removed meanwhile is never lost",
    (requested) => {
      expect(reorderCards(requested, keys)).toEqual({ ok: false, code: "card.order_invalid" });
    },
  );
});

describe("card surfaces", () => {
  test.each(["filled", "outlined", "plain"] as const)("accepts %s and carries it to a new record", (surface) => {
    const parsed = parseCardInput({ kind: "readme", text: "Hi", surface });
    expect(parsed).toMatchObject({ ok: true, surface });
    if (!parsed.ok) throw new Error("input refused");
    const built = toCardRecord(parsed.content, parsed.width, null, NOW, parsed.surface);
    expect(built.ok).toBe(true);
    if (!built.ok) throw new Error("record refused");
    expect(built.record.surface).toBe(surface === "filled" ? undefined : surface);
    expect(validateRecord("sh.unset.card", built.record, "write").ok).toBe(true);
  });

  test.each(["", "future", " Plain ", null, 1, {}])("refuses new surface %j", (surface) => {
    expect(parseCardInput({ kind: "readme", text: "Hi", surface })).toEqual({
      ok: false,
      code: "card.invalid",
    });
  });

  for (const before of [undefined, "filled", "outlined", "plain", "future"]) {
    test.each(["filled", "outlined", "plain", undefined] as const)(
      `changes ${before} to %s while preserving other record fields`,
      (surface) => {
        const existing = stored(
          { $type: ref("readme"), text: "Old", futureContent: 7 },
          { surface: before, futureEnvelope: true },
        );
        if (before === undefined) delete (existing as Record<string, unknown>).surface;
        const built = toCardRecord({ kind: "readme", text: "New" }, "half", existing, NOW, surface);
        expect(built.ok).toBe(true);
        if (!built.ok) throw new Error("record refused");
        expect(built.record).toMatchObject({
          createdAt: T1,
          futureEnvelope: true,
          width: "half",
          content: { text: "New", futureContent: 7 },
        });
        expect(built.record.surface).toBe(surface === undefined ? before : surface === "filled" ? undefined : surface);
      },
    );
  }
});

// A Text card's table lines (ADR 0110 point 2; Alex 2026-11-22 00:37Z, "Per card, in Edit"): four switches for every
// table in the card, stored as sh.unset.block.text#tableStyle beside the Markdown. The Edit form always sends
// `tableLines` with a box per line, checked when the line is drawn (so our look is header and rows checked); a save
// that does not send it (the in-place editor) keeps what is stored.
describe("table lines", () => {
  const parsed = (input: Record<string, unknown>) => {
    const result = parseCardInput(input);
    if (!result.ok) throw new Error(result.code);
    return result;
  };
  const NONE = { hideHeaderLine: false, hideRowLines: false, showColumnLines: false, showOutline: false };

  test("the Edit form's checked switches are read, and a form that sends none leaves them out", () => {
    expect(parsed({ kind: "readme", text: "a", tableLines: "", headerLine: "on", outline: "on" }).content).toEqual({
      kind: "readme",
      text: "a",
      tableLines: { ...NONE, showOutline: true, hideRowLines: true },
    });
    expect(parsed({ kind: "readme", text: "a", tableLines: "", headerLine: "on", rowLines: "on" }).content).toEqual({
      kind: "readme",
      text: "a",
      tableLines: NONE,
    });
    expect(parsed({ kind: "readme", text: "a" }).content).toEqual({ kind: "readme", text: "a" });
  });

  test.each([
    [{ kind: "readme", text: "a", tableLines: "", outline: "yes" }],
    [{ kind: "readme", text: "a", tableLines: "x" }],
    [{ kind: "readme", text: "a", outline: "on" }],
  ])("a box that is not a checked one, or one sent without the form's marker, is refused: %j", (input) => {
    expect(parseCardInput(input)).toEqual({ ok: false, code: "card.invalid" });
  });

  test("switches are written as tableStyle with only those that are on, and the cell sides stored are kept", () => {
    const tables = [{ lines: ["0a1b2c3d"], edges: [{ direction: "horizontal", line: 0, cell: 0 }] }];
    const existing = stored({ $type: ref("readme"), text: "old", tableStyle: { hideRowLines: true, tables } });
    const { content, width } = parsed({
      kind: "readme",
      text: "new",
      tableLines: "",
      headerLine: "on",
      rowLines: "on",
      columnLines: "on",
    });
    const written = toCardRecord(content, width, existing, NOW);
    expect(written).toMatchObject({
      ok: true,
      record: { content: { $type: ref("readme"), text: "new", tableStyle: { showColumnLines: true, tables } } },
    });
    expect(written.ok && validateRecord("sh.unset.card", written.record, "write").ok).toBe(true);
  });

  test("our look writes no tableStyle, and a save without the marker keeps the stored one", () => {
    const existing = stored({ $type: ref("readme"), text: "old", tableStyle: { showOutline: true } });
    const off = parsed({ kind: "readme", text: "new", tableLines: "", headerLine: "on", rowLines: "on" });
    expect(toCardRecord(off.content, off.width, existing, NOW)).toMatchObject({
      ok: true,
      record: { content: { $type: ref("readme"), text: "new" } },
    });
    const offWritten = toCardRecord(off.content, off.width, existing, NOW);
    expect(offWritten.ok && "tableStyle" in (offWritten.record.content as object)).toBe(false);
    const inPlace = parsed({ kind: "readme", text: "new" });
    expect(toCardRecord(inPlace.content, inPlace.width, existing, NOW)).toMatchObject({
      ok: true,
      record: { content: { $type: ref("readme"), text: "new", tableStyle: { showOutline: true } } },
    });
  });
});
