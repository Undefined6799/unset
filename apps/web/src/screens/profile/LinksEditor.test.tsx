// @vitest-environment jsdom
// The links editor (ADR 0051): a plain form of indexed rows (interfaces/http/card-form.ts reads it), every stored row
// shown so a save never drops one, and blank rows to add more, up to the editor's limit.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { Me, type MeProps } from "../Me.tsx";
import type { CardView } from "./ProfileCards.tsx";

const DID = `did:plc:${"a".repeat(24)}`;
const base: MeProps = { handle: "alice.test", did: DID, handleUnavailable: false, issuer: null, ours: false };
const profile = { displayName: "Alice", headline: "", location: "", website: "" };
const limits = { links: 4, collection: 30, buttons: 5 };
const links = (key: string, count: number): CardView => ({
  key,
  width: "half",
  content: {
    kind: "links",
    title: "Elsewhere",
    layout: "grid",
    items: Array.from({ length: count }, (_, i) => ({
      uri: `https://x.example/${i}`,
      label: `L${i}`,
      description: "",
    })),
  },
});
const page = (props: Partial<MeProps>) =>
  new DOMParser().parseFromString(renderToStaticMarkup(<Me {...base} {...props} />), "text/html");
const fields = (form: Element | null) =>
  [...(form?.querySelectorAll("input") ?? [])]
    .filter((i) => i.type !== "radio" || i.checked)
    .map((i) => `${i.name}=${i.value}`);

describe("links editor", () => {
  test("a links card's form holds its title, layout, width and each stored row, then blank rows", () => {
    const doc = page({ profile, cards: [links("k1", 2)], cardEditLimits: limits });
    expect(fields(doc.querySelector('form[action="/cards/k1"]'))).toEqual([
      "kind=links",
      "width=half",
      "title=Elsewhere",
      "layout=grid",
      "items.0.uri=https://x.example/0",
      "items.0.label=L0",
      "items.0.description=",
      "items.1.uri=https://x.example/1",
      "items.1.label=L1",
      "items.1.description=",
      "items.2.uri=",
      "items.2.label=",
      "items.2.description=",
      "items.3.uri=",
      "items.3.label=",
      "items.3.description=",
    ]);
  });

  test("a card at or past the editor's limit shows every stored row and no blank one", () => {
    const doc = page({ profile, cards: [links("k1", 6)], cardEditLimits: limits });
    const form = fields(doc.querySelector('form[action="/cards/k1"]'));
    expect(form.filter((f) => f.includes(".uri="))).toHaveLength(6);
    expect(form).not.toContain("items.6.uri=");
  });

  test("the page offers a new links card with blank rows, posted to /cards", () => {
    const doc = page({ profile, cards: [], cardEditLimits: limits });
    const form = doc.querySelector('form[action="/cards"] input[value="links"]')?.closest("form") ?? null;
    expect(fields(form).filter((f) => f.endsWith(".uri="))).toEqual(["items.0.uri=", "items.1.uri=", "items.2.uri="]);
    expect(fields(form)).toContain("layout=list");
    expect(doc.body.textContent).toContain("Add links");
  });

  test("stored text is escaped into the fields, never parsed as markup", () => {
    const card = links("k1", 1);
    const evil = '"><script>alert(1)</script>';
    const content = { ...card.content, title: evil } as CardView["content"];
    const doc = page({ profile, cards: [{ ...card, content }], cardEditLimits: limits });
    expect((doc.querySelector('input[name="title"]') as HTMLInputElement).value).toBe(evil);
    expect(doc.querySelector("script")).toBeNull();
  });

  test("without the editor's limits there is no links editor", () => {
    const doc = page({ profile, cards: [links("k1", 1)] });
    expect(doc.querySelector('form[action="/cards/k1"]')).toBeNull();
    expect(doc.body.textContent).not.toContain("Add links");
  });
});
