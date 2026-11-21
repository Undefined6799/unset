// The one Save from the owner's page (ADR 0074): the form it posts, the size check before sending, and how the page
// reads the action's answer.
import { describe, expect, test } from "vitest";
import { type CardEdit, cardSaveForm, readSaveAnswer } from "./save-all.ts";

const HERE = "/did:plc:abc";
const V = "bafyreie5737gdxlw5i64vzichcalba3z2v5n6icifvx5xytvske7mr3hpm";
const edit = (key: string, text: string, extra: Partial<CardEdit> = {}): CardEdit => ({
  key,
  version: V,
  kind: "readme",
  fields: { text },
  width: "full",
  surface: "filled",
  ...extra,
});

describe("cardSaveForm", () => {
  test("names each changed Text card under its own index, as the action reads it", () => {
    const form = cardSaveForm([edit("a", "One"), edit("b", "Two", { width: "half", surface: "plain" })], 1_000);
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
    const body = cardSaveForm([edit("a", "é".repeat(400))], 1_000);
    expect(body).toEqual({ kind: "too_large" });
    // é is six bytes once percent-encoded, x one.
    expect(cardSaveForm([edit("a", "x".repeat(400))], 1_000).kind).toBe("ok");
  });
});

describe("readSaveAnswer", () => {
  test("a redirect back to the owner's page is saved", () => {
    expect(readSaveAnswer({ type: "redirect", location: "/did:plc:abc" }, "/did:plc:abc")).toEqual({ kind: "saved" });
    expect(readSaveAnswer({ type: "success" }, "/did:plc:abc")).toEqual({ kind: "saved" });
  });

  // Codex review of f6c6a2f: a sign-in that ended sends the Save to sign in again with nothing written.
  test("a redirect anywhere else is followed with nothing saved", () => {
    expect(readSaveAnswer({ type: "redirect", location: "/login?error=login.session_ended" }, "/did:plc:abc")).toEqual({
      kind: "elsewhere",
      location: "/login?error=login.session_ended",
    });
    expect(readSaveAnswer({ type: "redirect" }, "/did:plc:abc")).toEqual({ kind: "failed" });
  });

  test("a refusal keeps its message and names its card, field and the cards saved", () => {
    expect(
      readSaveAnswer(
        {
          type: "failure",
          data: { code: "card.save_partial", message: "Some of your cards were saved", saved: ["a"], card: undefined },
        },
        HERE,
      ),
    ).toEqual({ kind: "refused", code: "card.save_partial", message: "Some of your cards were saved", saved: ["a"] });
    expect(
      readSaveAnswer(
        {
          type: "failure",
          data: { code: "card.too_long", message: "Too long", card: "b", field: "cards.0.text" },
        },
        HERE,
      ),
    ).toEqual({ kind: "refused", code: "card.too_long", message: "Too long", card: "b", field: "cards.0.text" });
  });

  // P1.21v follow-up (Codex on c6cddd7): the answer names each written card's new version, so the page settles on it.
  test("a_save_s_answer_names_the_version_each_written_card_now_has", () => {
    const versions = [{ key: "a", version: "bafy-a2" }];
    expect(readSaveAnswer({ type: "success", data: { versions } }, HERE)).toEqual({
      kind: "saved",
      versions: new Map([["a", "bafy-a2"]]),
    });
    expect(
      readSaveAnswer(
        { type: "failure", data: { code: "card.save_partial", message: "Some", saved: ["a"], versions } },
        HERE,
      ),
    ).toEqual({
      kind: "refused",
      code: "card.save_partial",
      message: "Some",
      saved: ["a"],
      versions: new Map([["a", "bafy-a2"]]),
    });
    const odd = [{ key: "a", version: 3 }, "b", null, { key: 1, version: "x" }];
    expect(readSaveAnswer({ type: "success", data: { versions: odd } }, HERE)).toEqual({ kind: "saved" });
  });

  test("anything else, a dropped connection or a page error, is a failure the member can try again", () => {
    expect(readSaveAnswer({ type: "error" }, HERE)).toEqual({ kind: "failed" });
    expect(readSaveAnswer({ type: "failure", data: { message: 3 } }, HERE)).toEqual({ kind: "failed" });
  });
});
