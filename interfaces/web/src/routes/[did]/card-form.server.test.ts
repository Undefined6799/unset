// Ported unchanged from interfaces/http/card-form.test.ts (P1.20i), import path only; that copy goes with P1.20k.
// A card editor's plain form read into the object the JSON editor sends (ADR 0037 point 7, ADR 0051).
import { AppError } from "@unset/shared-errors";
import { describe, expect, test } from "vitest";
import { CARD_FORM_MAX_FIELDS, cardForm } from "./card-form.server.ts";

const read = (pairs: [string, string][]) => cardForm(new URLSearchParams(pairs));
const code = (pairs: [string, string][]) => {
  try {
    read(pairs);
    return "read";
  } catch (error) {
    return error instanceof AppError ? error.code : "thrown";
  }
};

describe("cardForm", () => {
  test("a README form is its kind, width and text", () => {
    expect(
      read([
        ["kind", "readme"],
        ["width", "half"],
        ["text", "Hi"],
      ]),
    ).toEqual({
      kind: "readme",
      width: "half",
      text: "Hi",
    });
  });

  test("indexed rows become the list in index order, and blank rows are dropped", () => {
    const body = read([
      ["kind", "links"],
      ["title", "Elsewhere"],
      ["layout", "grid"],
      ["items.1.uri", "b.example"],
      ["items.0.uri", "a.example"],
      ["items.0.label", "A"],
      ["items.2.uri", " "],
      ["items.2.label", ""],
      ["items.5.uri", "c.example"],
    ]);
    expect(body).toEqual({
      kind: "links",
      title: "Elsewhere",
      layout: "grid",
      items: [{ uri: "a.example", label: "A" }, { uri: "b.example" }, { uri: "c.example" }],
    });
  });

  test("a form with no rows sends an empty list", () => {
    expect(
      read([
        ["kind", "collection"],
        ["items.0.title", ""],
      ]),
    ).toEqual({ kind: "collection", items: [] });
  });

  test("a button row's kind and preset alone make it blank", () => {
    const body = read([
      ["kind", "buttons"],
      ["heading", "Work with me"],
      ["buttons.0.kind", "email"],
      ["buttons.0.address", "me@example.com"],
      ["buttons.1.kind", "link"],
      ["buttons.1.preset", "hire"],
      ["buttons.1.uri", ""],
    ]);
    expect(body).toEqual({
      kind: "buttons",
      heading: "Work with me",
      buttons: [{ kind: "email", address: "me@example.com" }],
    });
  });

  test.each([
    [
      "a field another kind holds",
      [
        ["kind", "readme"],
        ["title", "x"],
      ],
    ],
    [
      "a row field the kind does not hold",
      [
        ["kind", "links"],
        ["items.0.tag", "x"],
      ],
    ],
    [
      "a list the kind does not hold",
      [
        ["kind", "links"],
        ["buttons.0.uri", "x"],
      ],
    ],
    [
      "an index with a leading zero",
      [
        ["kind", "links"],
        ["items.01.uri", "x"],
      ],
    ],
    [
      "an index that is not a number",
      [
        ["kind", "links"],
        ["items.a.uri", "x"],
      ],
    ],
    [
      "an index past the lexicon's list",
      [
        ["kind", "links"],
        ["items.100.uri", "x"],
      ],
    ],
    [
      "a field sent twice",
      [
        ["kind", "links"],
        ["items.0.uri", "a"],
        ["items.0.uri", "b"],
      ],
    ],
    [
      "a kind sent twice",
      [
        ["kind", "links"],
        ["kind", "readme"],
      ],
    ],
    [
      "a nested path past one row",
      [
        ["kind", "links"],
        ["items.0.uri.x", "a"],
      ],
    ],
  ] as [string, [string, string][]][])("%s is card.invalid", (_, pairs) => {
    expect(code(pairs)).toBe("card.invalid");
  });

  test("a form without a known kind is card.kind_unknown", () => {
    expect(code([["text", "Hi"]])).toBe("card.kind_unknown");
    expect(code([["kind", "video"]])).toBe("card.kind_unknown");
  });

  test("the number of fields is capped before any row is built", () => {
    const pairs: [string, string][] = [["kind", "links"]];
    for (let n = 0; pairs.length <= CARD_FORM_MAX_FIELDS; n++) pairs.push([`items.${n % 100}.uri`, "x"]);
    expect(code(pairs)).toBe("card.invalid");
    const full: [string, string][] = [
      ["kind", "collection"],
      ["width", "full"],
      ["title", "t"],
      ["layout", "list"],
    ];
    for (let n = 0; n < 100; n++)
      for (const f of ["title", "tag", "description", "uri"]) full.push([`items.${n}.${f}`, "x"]);
    expect(full.length).toBeLessThanOrEqual(CARD_FORM_MAX_FIELDS);
    expect(code(full)).toBe("read");
  });
});
