// @vitest-environment jsdom
// The toast island (P1.24b): with JS the close control hides the toast in place and keeps the address in step; when
// the toast is missing the link is followed, as with no JS. toast_keyboard and the motion and theme checks run in a
// real browser in P1.26's harness.
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, expect, test } from "vitest";
import toast from "../../islands/toast.island.tsx";
import { type SafeHref, safeHref } from "../../safe-href.ts";
import { Toast } from "./Toast.tsx";
import { isToastCloseProps, ToastClose } from "./ToastClose.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const href = safeHref("/settings", ["path"]) as SafeHref;

afterEach(() => {
  document.body.replaceChildren();
  history.replaceState(null, "", "/");
});

/** The server's toast, with the close link hydrated as the island's own root. */
async function mount() {
  const html = renderToString(<Toast closeHref={href}>profile saved</Toast>);
  document.body.append(...new DOMParser().parseFromString(html, "text/html").body.childNodes);
  const box = document.querySelector("[role=status] > [id]") as HTMLElement;
  const link = box.querySelector("a") as HTMLAnchorElement;
  const island = document.createElement("span");
  link.replaceWith(island);
  island.append(link);
  await act(async () => {
    hydrateRoot(island, <ToastClose href={href} label="Dismiss" toast={box.id} />);
  });
  return { box, link };
}

/** A click as the browser sends it; returns whether the link would still be followed (jsdom then stops it). */
const click = async (link: HTMLAnchorElement) => {
  let followed = false;
  const stop = (event: Event) => {
    followed = !event.defaultPrevented;
    event.preventDefault();
  };
  document.addEventListener("click", stop, { once: true });
  await act(async () => link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
  return followed;
};

test("toast_island_closes_in_place", async () => {
  history.replaceState(null, "", "/settings?saved=1");
  const { box, link } = await mount();
  expect(box.hidden).toBe(false);
  expect(await click(link)).toBe(false);
  expect(box.hidden).toBe(true);
  expect(location.pathname + location.search).toBe("/settings");
  // The live region stays in the page for the next toast.
  expect(box.parentElement?.getAttribute("role")).toBe("status");
});

test("toast_close_moves_focus_to_main", async () => {
  const main = document.createElement("main");
  main.id = "main";
  document.body.append(main);
  const { link } = await mount();
  link.focus();
  await click(link);
  expect(document.activeElement).toBe(main);
  expect(main.getAttribute("tabindex")).toBe("-1");
});

test("toast_close_leaves_focus_held_elsewhere", async () => {
  const main = document.createElement("main");
  main.id = "main";
  const other = document.createElement("button");
  document.body.append(main, other);
  const { box, link } = await mount();
  other.focus();
  await click(link);
  expect(box.hidden).toBe(true);
  expect(document.activeElement).toBe(other);
  expect(main.hasAttribute("tabindex")).toBe(false);
});

test("toast_island_without_toast_follows_link", async () => {
  const { box, link } = await mount();
  box.removeAttribute("id");
  expect(await click(link)).toBe(true);
});

test("toast_island_markup_matches_server", () => {
  const server = renderToString(<Toast closeHref={href}>profile saved</Toast>);
  const id = /id="([^"]+)"/.exec(server)?.[1] ?? "";
  expect(server).toContain(renderToString(<ToastClose href={href} label="Dismiss" toast={id} />));
});

test("toast_island_props_schema", () => {
  expect(toast.propsSchema({ href: "/x", label: "Dismiss", toast: "_R_1_" })).toBe(true);
  for (const bad of [
    null,
    { href: "javascript:alert(1)", label: "Dismiss", toast: "_R_1_" },
    { href: "https://example.com/", label: "Dismiss", toast: "_R_1_" },
    { href: "/x", toast: "_R_1_" },
    { href: "/x", label: "Dismiss" },
  ])
    expect(isToastCloseProps(bad), JSON.stringify(bad)).toBe(false);
});
