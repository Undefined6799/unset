// @vitest-environment jsdom
// The card dialog every editor opens (ADR 0051; mockup "Design profile card modules"): each offers the card's width,
// full or half, with the stored width chosen, and posts the choice as `width`.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { Me, type MeProps } from "../Me.tsx";
import type { CardView } from "./ProfileCards.tsx";

const DID = `did:plc:${"a".repeat(24)}`;
const base: MeProps = { handle: "alice.test", did: DID, handleUnavailable: false, issuer: null, ours: false };
const profile = { displayName: "Alice", headline: "", location: "", website: "" };
const limits = { links: 30, collection: 30, buttons: 5 };
const page = (props: Partial<MeProps>) =>
  new DOMParser().parseFromString(renderToStaticMarkup(<Me {...base} {...props} />), "text/html");
const widths = (form: Element | null) =>
  [...(form?.querySelectorAll('input[name="width"]') ?? [])].map(
    (i) =>
      `${(i as HTMLInputElement).type}:${(i as HTMLInputElement).value}${(i as HTMLInputElement).checked ? "*" : ""}`,
  );
const addForm = (doc: Document, kind: string) =>
  doc.querySelector(`form[action="/cards"] input[name="kind"][value="${kind}"]`)?.closest("form") ?? null;

describe("card width", () => {
  test("each new card offers full or half, starting from its kind's usual width", () => {
    const doc = page({ profile, cards: [], cardEditLimits: limits });
    for (const kind of ["readme", "links", "collection"]) {
      expect(widths(addForm(doc, kind))).toEqual(["radio:full*", "radio:half"]);
    }
    expect(widths(addForm(doc, "buttons"))).toEqual(["radio:full", "radio:half*"]);
  });

  test("an edited card starts from its stored width", () => {
    const half: CardView = { key: "k1", width: "half", content: { kind: "readme", text: "Hi" } };
    const full: CardView = {
      key: "k2",
      width: "full",
      content: { kind: "buttons", heading: "Work", text: "", buttons: [] },
    };
    const doc = page({ profile, cards: [half, full], cardEditLimits: limits });
    expect(widths(doc.querySelector('form[action="/cards/k1"]'))).toEqual(["radio:full", "radio:half*"]);
    expect(widths(doc.querySelector('form[action="/cards/k2"]'))).toEqual(["radio:full*", "radio:half"]);
  });
});
