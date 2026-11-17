// @vitest-environment jsdom
// The collection and buttons editors (ADR 0051): plain forms of indexed rows (interfaces/http/card-form.ts reads them),
// every stored row shown, and blank rows up to the editor's limit.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { Me, type MeProps } from "../Me.tsx";
import type { CardView } from "./ProfileCards.tsx";

const DID = `did:plc:${"a".repeat(24)}`;
const base: MeProps = { handle: "alice.test", did: DID, handleUnavailable: false, issuer: null, ours: false };
const profile = { displayName: "Alice", headline: "", location: "", website: "" };
const limits = { links: 4, collection: 3, buttons: 2 };
const page = (props: Partial<MeProps>) =>
  new DOMParser().parseFromString(renderToStaticMarkup(<Me {...base} {...props} />), "text/html");
const fields = (form: Element | null) =>
  [...(form?.querySelectorAll("input, textarea") ?? [])]
    .filter((i) => !(i instanceof HTMLInputElement && i.type === "radio" && !i.checked))
    .map((i) => `${(i as HTMLInputElement).name}=${(i as HTMLInputElement).value}`);
const addForm = (doc: Document, kind: string) =>
  doc.querySelector(`form[action="/cards"] input[name="kind"][value="${kind}"]`)?.closest("form") ?? null;

const collection: CardView = {
  key: "k1",
  width: "full",
  content: {
    kind: "collection",
    title: "Work",
    layout: "grid",
    items: [{ title: "Talk", tag: "2026", description: "On cards", uri: "https://x.example/t" }],
  },
};
const buttons: CardView = {
  key: "k2",
  width: "half",
  content: {
    kind: "buttons",
    heading: "Work with me",
    text: "Open to projects",
    buttons: [{ kind: "email", address: "me@x.example" }],
  },
};

describe("collection editor", () => {
  test("a collection card's form holds its title, layout and each stored entry, then blank rows", () => {
    const doc = page({ profile, cards: [collection], cardEditLimits: limits });
    expect(fields(doc.querySelector('form[action="/cards/k1"]'))).toEqual([
      "kind=collection",
      "width=full",
      "title=Work",
      "layout=grid",
      "items.0.title=Talk",
      "items.0.tag=2026",
      "items.0.description=On cards",
      "items.0.uri=https://x.example/t",
      ...[1, 2].flatMap((n) => ["title", "tag", "description", "uri"].map((f) => `items.${n}.${f}=`)),
    ]);
  });

  test("the page offers a new collection, laid out as a carousel by default", () => {
    const form = addForm(page({ profile, cards: [], cardEditLimits: limits }), "collection");
    expect(fields(form)).toContain("layout=carousel");
    expect(fields(form).filter((f) => f.endsWith(".title="))).toHaveLength(3);
  });
});

describe("buttons editor", () => {
  test("a buttons card's form holds its heading, text and each stored button, then blank rows", () => {
    const doc = page({ profile, cards: [buttons], cardEditLimits: limits });
    expect(fields(doc.querySelector('form[action="/cards/k2"]'))).toEqual([
      "kind=buttons",
      "width=half",
      "heading=Work with me",
      "text=Open to projects",
      "buttons.0.kind=email",
      "buttons.0.address=me@x.example",
      "buttons.0.preset=custom",
      "buttons.0.uri=",
      "buttons.0.label=",
      "buttons.1.kind=link",
      "buttons.1.address=",
      "buttons.1.preset=custom",
      "buttons.1.uri=",
      "buttons.1.label=",
    ]);
  });

  test("a stored link button keeps its preset, address and label", () => {
    const content = {
      ...buttons.content,
      buttons: [{ kind: "link", preset: "hire", uri: "https://x.example/h", label: "" }],
    } as CardView["content"];
    const doc = page({ profile, cards: [{ ...buttons, content }], cardEditLimits: limits });
    expect(fields(doc.querySelector('form[action="/cards/k2"]'))).toEqual(
      expect.arrayContaining(["buttons.0.kind=link", "buttons.0.preset=hire", "buttons.0.uri=https://x.example/h"]),
    );
  });

  test("the page offers new buttons with a required heading", () => {
    const form = addForm(page({ profile, cards: [], cardEditLimits: limits }), "buttons");
    expect(form?.querySelector('input[name="heading"]')?.hasAttribute("required")).toBe(true);
    expect(fields(form).filter((f) => f.endsWith(".address="))).toHaveLength(2);
  });

  test("the hint says a button is removed only when its addresses and its own text are all empty", () => {
    const form = addForm(page({ profile, cards: [], cardEditLimits: limits }), "buttons");
    expect(form?.textContent).toContain("Leave a button's email address, web address and own text empty to remove it.");
  });

  test("an editor offers ten blank rows while its limit allows, so ten new rows take one save", () => {
    const doc = page({ profile, cards: [], cardEditLimits: { links: 30, collection: 30, buttons: 5 } });
    expect(fields(addForm(doc, "links")).filter((f) => f.endsWith(".uri="))).toHaveLength(10);
    expect(fields(addForm(doc, "collection")).filter((f) => f.endsWith(".tag="))).toHaveLength(10);
    expect(fields(addForm(doc, "buttons")).filter((f) => f.endsWith(".address="))).toHaveLength(5);
  });
});
