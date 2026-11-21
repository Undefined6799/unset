// Ported unchanged from interfaces/http/card-form.test.ts (P1.20i), import path only; that copy goes with P1.20k.
// A card editor's plain form read into the object the JSON editor sends (ADR 0037 point 7, ADR 0051).
import { AppError } from "@unset/shared-errors";
import { describe, expect, test } from "vitest";
import { CARD_FORM_MAX_FIELDS, readCardForm, splitCardsForm } from "./card-form.server.ts";

const read = (pairs: [string, string][]) => readCardForm(new URLSearchParams(pairs)).body;
const code = (pairs: [string, string][]) => {
  try {
    read(pairs);
    return "read";
  } catch (error) {
    return error instanceof AppError ? error.code : "thrown";
  }
};

describe("readCardForm", () => {
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

  test("a picture form is its kind, draft id, alt text, caption and fit, and no list", () => {
    const fields: [string, string][] = [
      ["kind", "image"],
      ["image", "0b6a52d4-6c1f-4bde-9b8e-2a1f6d7c3e01"],
      ["alt", "A lake"],
      ["caption", "Morning"],
      ["fit", "fill"],
    ];
    expect(read(fields)).toEqual(Object.fromEntries(fields));
    expect(() => read([...fields.slice(0, 1), ["items.0.uri", "a.example"]])).toThrow("card.invalid");
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

  // Review of #1702: the editor hides the other kind's fields, so what they still hold never keeps a row.
  test("a button row's fields for the kind it does not open never keep it", () => {
    const body = read([
      ["kind", "buttons"],
      ["heading", "Work with me"],
      ["buttons.0.kind", "link"],
      ["buttons.0.preset", "custom"],
      ["buttons.0.address", "left@example.com"],
      ["buttons.0.uri", ""],
      ["buttons.0.label", ""],
      ["buttons.1.kind", "email"],
      ["buttons.1.address", ""],
      ["buttons.1.uri", "left.example"],
      ["buttons.1.label", "Left"],
    ]);
    expect(body).toEqual({ kind: "buttons", heading: "Work with me", buttons: [] });
  });

  test.each(["constructor", "toString", "__proto__", "nope"])(
    "a button row of the unknown kind %s keeps its fields",
    (kind) => {
      const body = read([
        ["kind", "buttons"],
        ["heading", "Work with me"],
        [`buttons.0.kind`, kind],
        ["buttons.0.address", "me@example.com"],
      ]);
      expect(body).toEqual({
        kind: "buttons",
        heading: "Work with me",
        buttons: [{ kind, address: "me@example.com" }],
      });
    },
  );

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

  test("an inherited name is no kind, no field and no row, and nothing reaches the prototype", () => {
    // Moved here with P1.20k from the island props tests (proto_key_roundtrip, escaped_keys_are_refused): the form's
    // names only ever select from fixed lists (Object.hasOwn for the kind), so a prototype name is refused, not set.
    for (const kind of ["__proto__", "constructor", "toString", "hasOwnProperty"])
      expect(code([["kind", kind]]), kind).toBe("card.kind_unknown");
    expect(
      code([
        ["kind", "readme"],
        ["__proto__", "x"],
      ]),
    ).toBe("card.invalid");
    expect(
      code([
        ["kind", "readme"],
        ["constructor", "x"],
      ]),
    ).toBe("card.invalid");
    expect(
      code([
        ["kind", "links"],
        ["items.0.__proto__", "x"],
      ]),
    ).toBe("card.invalid");
    expect(
      code([
        ["kind", "links"],
        ["items.__proto__.uri", "x"],
      ]),
    ).toBe("card.invalid");
    expect(
      code([
        ["kind", "links"],
        ["__proto__.0.uri", "x"],
      ]),
    ).toBe("card.invalid");
    const body = read([
      ["kind", "links"],
      ["items.0.uri", "https://a.example"],
    ]);
    expect(Object.getPrototypeOf(body)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).uri).toBeUndefined();
  });

  test("the number of fields is capped before any row is built", () => {
    const pairs: [string, string][] = [["kind", "links"]];
    for (let n = 0; pairs.length <= CARD_FORM_MAX_FIELDS; n++) pairs.push([`items.${n % 100}.uri`, "x"]);
    expect(code(pairs)).toBe("card.invalid");
    const full: [string, string][] = [
      ["kind", "collection"],
      ["width", "full"],
      ["surface", "outlined"],
      ["title", "t"],
      ["layout", "list"],
    ];
    // The most entries a showcase holds (LIMITS.card.entriesMax, ADR 0086), each with all four fields.
    for (let n = 0; n < 50; n++)
      for (const f of ["title", "tag", "description", "uri"]) full.push([`items.${n}.${f}`, "x"]);
    expect(full.length).toBeLessThanOrEqual(CARD_FORM_MAX_FIELDS);
    expect(code(full)).toBe("read");
  });
});

test("surface reaches the domain for every kind and duplicates are refused", () => {
  for (const kind of ["readme", "links", "collection", "buttons"]) {
    const form = readCardForm(new URLSearchParams({ kind, surface: "plain" }));
    expect(form.body.surface).toBe("plain");
    expect(
      code([
        ["kind", kind],
        ["surface", "plain"],
        ["surface", "filled"],
      ]),
    ).toBe("card.invalid");
  }
});

describe("splitCardsForm", () => {
  const split = (pairs: [string, string][]) =>
    splitCardsForm(new URLSearchParams(pairs)).map((c) => [c.index, [...c.form]]);
  const refusal = (pairs: [string, string][]) => {
    try {
      split(pairs);
      return "read";
    } catch (error) {
      return error instanceof AppError ? error.code : "thrown";
    }
  };

  test("a Save of several cards is one form per card, in index order, with the prefix taken off", () => {
    expect(
      split([
        ["cards.1.key", "b"],
        ["cards.0.key", "a"],
        ["cards.0.text", "A"],
        ["cards.1.items.0.uri", "https://x.example"],
      ]),
    ).toEqual([
      [
        0,
        [
          ["key", "a"],
          ["text", "A"],
        ],
      ],
      [
        1,
        [
          ["key", "b"],
          ["items.0.uri", "https://x.example"],
        ],
      ],
    ]);
  });

  test("a field outside a card, a bad index or one past the most cards is card.invalid", () => {
    for (const name of [
      "key",
      "cards.key",
      "cards.01.key",
      "cards.-1.key",
      "cards.1e2.key",
      "cards.100.key",
      "cards.0",
    ]) {
      expect(refusal([[name, "x"]])).toBe("card.invalid");
    }
    expect(refusal([["cards.99.key", "x"]])).toBe("read");
  });

  test("more fields than a hundred full cards hold is refused before any is read", () => {
    const pairs = Array.from({ length: 100 * (CARD_FORM_MAX_FIELDS + 2) + 1 }, (_, n): [string, string] => [
      `cards.0.f${n}`,
      "",
    ]);
    expect(refusal(pairs)).toBe("card.invalid");
  });
});
