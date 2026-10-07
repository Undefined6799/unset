// @vitest-environment jsdom
// The header-menu island (P1.24j): with JS, Escape closes the open menu and puts focus back on its toggle. The
// keyboard case in a real browser runs in P1.26's harness.
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { afterEach, expect, test } from "vitest";
import headerMenu from "../../islands/header-menu.island.tsx";
import { type SafeHref, safeHref } from "../../safe-href.ts";
import { Button } from "../Button/Button.tsx";
import { HeaderMenu, type HeaderMenuProps, isHeaderMenuProps, NavLinks } from "./HeaderMenu.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const href = (raw: string) => safeHref(raw, ["path"]) as SafeHref;
const PROPS: HeaderMenuProps = {
  label: "menu",
  nav: [{ label: "Home", href: href("/"), current: true }],
  action: { label: "Sign in", href: href("/signin") },
};

afterEach(() => document.body.replaceChildren());

/** The server markup, rebuilt by the browser's own parser from renderToString's output, then hydrated. */
async function mount(): Promise<HTMLDetailsElement> {
  const parsed = new DOMParser().parseFromString(renderToString(<HeaderMenu {...PROPS} />), "text/html");
  const root = document.createElement("div");
  root.append(...parsed.body.childNodes);
  document.body.append(root);
  await act(async () => {
    hydrateRoot(root, <HeaderMenu {...PROPS} />);
  });
  return root.querySelector("details") as HTMLDetailsElement;
}

const press = (target: Element, key: string) =>
  act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });

test("header_menu_escape_closes_and_returns_focus", async () => {
  const menu = await mount();
  menu.open = true;
  const link = menu.querySelector("a") as HTMLAnchorElement;
  link.focus();
  await press(link, "Enter");
  expect(menu.open).toBe(true);
  await press(link, "Escape");
  expect(menu.open).toBe(false);
  expect(document.activeElement).toBe(menu.querySelector("summary"));
});

test("header_menu_escape_when_closed_does_nothing", async () => {
  const menu = await mount();
  const summary = menu.querySelector("summary") as HTMLElement;
  await press(summary, "Escape");
  expect(menu.open).toBe(false);
  expect(document.activeElement).not.toBe(summary);
});

test("header_action_matches_button", () => {
  const html = renderToStaticMarkup(<NavLinks nav={[]} action={{ label: "Sign in", href: href("/signin") }} />);
  const button = renderToStaticMarkup(
    <Button as="a" href={href("/signin")}>
      Sign in
    </Button>,
  );
  expect(html).toContain(button);
});

test("header_menu_props_schema", () => {
  expect(isHeaderMenuProps(PROPS)).toBe(true);
  expect(isHeaderMenuProps({ label: "menu", nav: [] })).toBe(true);
  for (const bad of [
    null,
    { nav: [] },
    { label: "menu", nav: [{ label: "x", href: "javascript:alert(1)" }] },
    { label: "menu", nav: [{ label: "x", href: "/", current: "yes" }] },
    { label: "menu", nav: [], action: { label: "x", href: "data:text/html,x" } },
  ]) {
    expect(isHeaderMenuProps(bad), JSON.stringify(bad)).toBe(false);
  }
  expect(headerMenu.propsSchema(PROPS)).toBe(true);
});
