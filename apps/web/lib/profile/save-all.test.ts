// The one Save from the owner's page (ADR 0074): the form it posts, the size check before sending, and how the page
// reads the action's answer.
import { describe, expect, test } from "vitest";
import { readSaveAnswer, type TextEdit, textSaveForm } from "./save-all.ts";

const V = "bafyreie5737gdxlw5i64vzichcalba3z2v5n6icifvx5xytvske7mr3hpm";
const edit = (key: string, text: string, extra: Partial<TextEdit> = {}): TextEdit => ({
  key,
  version: V,
  text,
  width: "full",
  surface: "filled",
  ...extra,
});

describe("textSaveForm", () => {
  test("names each changed Text card under its own index, as the action reads it", () => {
    const form = textSaveForm([edit("a", "One"), edit("b", "Two", { width: "half", surface: "plain" })], 1_000);
    expect(form.kind).toBe("ok");
    expect(form.kind === "ok" && [...form.body]).toEqual([
      ["cards.0.key", "a"],
      ["cards.0.version", V],
      ["cards.0.kind", "readme"],
      ["cards.0.width", "full"],
      ["cards.0.surface", "filled"],
      ["cards.0.text", "One"],
      ["cards.1.key", "b"],
      ["cards.1.version", V],
      ["cards.1.kind", "readme"],
      ["cards.1.width", "half"],
      ["cards.1.surface", "plain"],
      ["cards.1.text", "Two"],
    ]);
  });

  test("a Save past the form cap, counted as the body is sent, is not sent", () => {
    const body = textSaveForm([edit("a", "é".repeat(400))], 1_000);
    expect(body).toEqual({ kind: "too_large" });
    // é is six bytes once percent-encoded, x one.
    expect(textSaveForm([edit("a", "x".repeat(400))], 1_000).kind).toBe("ok");
  });
});

describe("readSaveAnswer", () => {
  test("a redirect is saved", () => {
    expect(readSaveAnswer({ type: "redirect" })).toEqual({ kind: "saved" });
  });

  test("a refusal keeps its message and names its card, field and the cards saved", () => {
    expect(
      readSaveAnswer({
        type: "failure",
        data: { code: "card.save_partial", message: "Some of your cards were saved", saved: ["a"], card: undefined },
      }),
    ).toEqual({ kind: "refused", code: "card.save_partial", message: "Some of your cards were saved", saved: ["a"] });
    expect(
      readSaveAnswer({
        type: "failure",
        data: { code: "card.too_long", message: "Too long", card: "b", field: "cards.0.text" },
      }),
    ).toEqual({ kind: "refused", code: "card.too_long", message: "Too long", card: "b", field: "cards.0.text" });
  });

  test("anything else, a dropped connection or a page error, is a failure the member can try again", () => {
    expect(readSaveAnswer({ type: "error" })).toEqual({ kind: "failed" });
    expect(readSaveAnswer({ type: "failure", data: { message: 3 } })).toEqual({ kind: "failed" });
  });
});
