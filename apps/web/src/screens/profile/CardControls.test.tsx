// @vitest-environment jsdom
// The owner's card controls (ADR 0051): labelled move and delete buttons the keyboard reaches, a README editor whose
// text is escaped into its textarea, and none of it on a page with no published profile.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { Me, type MeProps } from "../Me.tsx";
import type { CardView } from "./ProfileCards.tsx";

const DID = `did:plc:${"a".repeat(24)}`;
const readme = (key: string, text: string): CardView => ({ key, width: "full", content: { kind: "readme", text } });
const links = (key: string): CardView => ({
  key,
  width: "half",
  content: { kind: "links", title: "Elsewhere", layout: "list", items: [] },
});
const base: MeProps = { handle: "alice.test", did: DID, handleUnavailable: false, issuer: null, ours: false };
const profile = { displayName: "Alice", headline: "", location: "", website: "" };
const page = (props: Partial<MeProps>) =>
  new DOMParser().parseFromString(renderToStaticMarkup(<Me {...base} {...props} />), "text/html");

describe("card controls", () => {
  test("each card has a labelled group; the first cannot move up and the last cannot move down", () => {
    const doc = page({ profile, cards: [readme("k1", "Hi"), links("k2")] });
    // Each card's own group (its legend is for assistive tech only), not a width choice in an editor.
    const groups = [...doc.querySelectorAll("fieldset")].filter((g) =>
      g.querySelector(":scope > legend")?.classList.contains("visually-hidden"),
    );
    expect(groups.map((g) => g.querySelector("legend")?.textContent)).toEqual(["README card", "Elsewhere card"]);
    const labels = (g: Element) => [...g.querySelectorAll("button, a")].map((b) => b.textContent);
    expect(labels(groups[0] as Element)).toEqual(["Edit", "Cancel", "Save", "Move down", "Delete", "Cancel", "Delete"]);
    expect(labels(groups[1] as Element)).toEqual(["Move up", "Delete", "Cancel", "Delete"]);
    expect([...doc.querySelectorAll("button")].every((b) => b.type === "button" || b.type === "submit")).toBe(true);
  });

  test("each control is a plain form that posts to its card route", () => {
    const doc = page({ profile, cards: [readme("k1", "Hi"), links("k2"), readme("k3", "Bye")] });
    const forms = [...doc.querySelectorAll('fieldset form[method="post"]')].map((f) => [
      f.getAttribute("action"),
      // What the browser posts: every input but an unchecked radio.
      [...f.querySelectorAll("input")]
        .filter((i) => i.type !== "radio" || i.checked)
        .map((i) => `${i.name}=${i.value}`)
        .join("&"),
    ]);
    expect(forms.filter(([action]) => action === "/card-order").map(([, body]) => body)).toEqual([
      "order=k2&order=k1&order=k3",
      "order=k2&order=k1&order=k3",
      "order=k1&order=k3&order=k2",
      "order=k1&order=k3&order=k2",
    ]);
    expect(forms.filter(([action]) => action?.endsWith("/delete")).map(([action]) => action)).toEqual([
      "/cards/k1/delete",
      "/cards/k2/delete",
      "/cards/k3/delete",
    ]);
    expect(forms.filter(([action]) => action === "/cards/k1")).toEqual([["/cards/k1", "kind=readme&width=full"]]);
    const save = [...doc.querySelectorAll("button")].find((b) => b.textContent === "Save");
    expect(doc.getElementById(save?.getAttribute("form") ?? "")?.getAttribute("action")).toBe("/cards/k1");
  });

  test("the delete confirm is an alert dialog, and its trigger falls back to the owner's own page", () => {
    const doc = page({ profile, cards: [links("k2")] });
    const dialog = doc.querySelector('dialog[role="alertdialog"]');
    expect(dialog?.textContent).toContain("Delete this card?");
    expect(doc.querySelector("fieldset a")?.getAttribute("href")).toBe(`/${DID}`);
  });

  test("a README's text is escaped into the editor, never parsed as markup", () => {
    const text = "</textarea><script>alert(1)</script>";
    const doc = page({ profile, cards: [readme("k1", text)] });
    const area = doc.querySelector('fieldset textarea[name="text"]') as HTMLTextAreaElement;
    expect(area.value).toBe(text);
    expect(doc.querySelector("script")).toBeNull();
    const form = area.closest("form");
    expect(form?.querySelector('input[name="kind"]')?.getAttribute("value")).toBe("readme");
    expect(form?.querySelector('input[name="width"]')?.getAttribute("value")).toBe("full");
  });

  test("the page ends with an empty README to add, and a note for when script is off", () => {
    const html = renderToStaticMarkup(<Me {...base} profile={profile} cards={[]} />);
    expect(html).toContain("Add README");
    expect(html).toContain("<noscript>");
  });

  test("a page with no published profile has no controls", () => {
    const doc = page({ profile: null, cards: [readme("k1", "Hi")] });
    expect(doc.querySelector("fieldset")).toBeNull();
    expect(doc.body.textContent).not.toContain("Add README");
  });
});
