// @vitest-environment jsdom
// The search island (P1.24u; sheet components/Search/README.md): `/` focuses the bar unless a text field has focus,
// Enter submits to `action` as with no JS, and Ctrl+Enter (⌘+Enter on a Mac) submits the same `q` to `webAction`.
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, expect, test } from "vitest";
import search from "../../islands/search.island.tsx";
import { type SafeHref, safeHref } from "../../safe-href.ts";
import { Search } from "./Search.tsx";
import { isSearchKeysProps, SearchKeys } from "./SearchKeys.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const people = safeHref("/people", ["path"]) as SafeHref;
const web = safeHref("/search", ["path"]) as SafeHref;

afterEach(() => {
  document.body.replaceChildren();
});

/** The server's form, with the island's markup hydrated as the island's own root. */
async function mount(shortcut = true) {
  const html = renderToString(<Search action={people} webAction={web} shortcut={shortcut} />);
  document.body.append(...new DOMParser().parseFromString(html, "text/html").body.childNodes);
  const form = document.querySelector("form") as HTMLFormElement;
  const input = form.querySelector("input") as HTMLInputElement;
  const button = form.querySelector("button[formaction]") as HTMLButtonElement;
  const island = document.createElement("span");
  button.replaceWith(island);
  island.append(button);
  await act(async () => {
    hydrateRoot(island, <SearchKeys form={form.id} web={web} shortcut={shortcut} />);
  });
  return { form, input };
}

const key = (target: EventTarget, init: KeyboardEventInit) =>
  act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  });

/** The submitter's formaction of the next submit, or null for none; the submit itself is stopped. */
function nextSubmit(form: HTMLFormElement): { action: string | null } {
  const seen: { action: string | null } = { action: null };
  form.addEventListener(
    "submit",
    (event) => {
      event.preventDefault();
      seen.action = (event as SubmitEvent).submitter?.getAttribute("formaction") ?? form.getAttribute("action");
    },
    { once: true },
  );
  return seen;
}

test("slash_focuses_the_bar", async () => {
  const { input } = await mount();
  await key(document.body, { key: "/" });
  expect(document.activeElement).toBe(input);
});

test("slash_ignored_while_typing_in_a_field", async () => {
  const { input } = await mount();
  const other = document.createElement("textarea");
  document.body.append(other);
  other.focus();
  await key(other, { key: "/" });
  expect(document.activeElement).toBe(other);
  expect(input.value).toBe("");
});

test("slash_ignored_in_contenteditable", async () => {
  const { input } = await mount();
  const editor = document.createElement("div");
  editor.setAttribute("contenteditable", "true");
  document.body.append(editor);
  editor.focus();
  await key(editor, { key: "/" });
  expect(document.activeElement).not.toBe(input);
});

test("slash_off_when_shortcut_false", async () => {
  const { input } = await mount(false);
  await key(document.body, { key: "/" });
  expect(document.activeElement).not.toBe(input);
});

test("ctrl_or_cmd_enter_searches_the_web", async () => {
  const { form, input } = await mount();
  input.value = "atproto";
  for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) {
    const seen = nextSubmit(form);
    await key(input, { key: "Enter", ...modifier });
    expect(seen.action).toBe("/search");
  }
});

test("plain_enter_is_left_to_the_form", async () => {
  const { form, input } = await mount();
  input.value = "atproto";
  const seen = nextSubmit(form);
  await key(input, { key: "Enter" });
  expect(seen.action).toBeNull();
});

test("search_island_props_schema", () => {
  expect(isSearchKeysProps({ form: "f", web: "/search", shortcut: true })).toBe(true);
  expect(isSearchKeysProps({ form: "f", web: "https://evil.example/", shortcut: true })).toBe(false);
  expect(isSearchKeysProps({ form: "f", web: "/search" })).toBe(false);
  expect(search.propsSchema({ form: "f", web: "//evil.example", shortcut: true })).toBe(false);
  expect(search.propsSchema({ form: "f", web: "javascript:alert(1)", shortcut: true })).toBe(false);
});
