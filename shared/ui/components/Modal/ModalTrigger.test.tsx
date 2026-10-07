// @vitest-environment jsdom
// The modal island (P1.24j): with JS the trigger opens the <dialog> in place, and closing it returns focus to the
// trigger; with no <dialog> support the link is followed. jsdom 30.1.1 has HTMLDialogElement but no showModal, so the
// stand-in below is the platform's part (rule TE-1: an unmanaged dependency); modal_dialog_focus_return runs in a real
// browser in P1.26's harness.
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import modal from "../../islands/modal.island.tsx";
import { type SafeHref, safeHref } from "../../safe-href.ts";
import { Modal } from "./Modal.tsx";
import { isModalTriggerProps, ModalTrigger } from "./ModalTrigger.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const href = safeHref("/drafts/1/delete", ["path"]) as SafeHref;

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

async function mount() {
  const html = renderToString(
    <Modal trigger="Delete draft" fallbackHref={href} title="Delete this draft?">
      It is removed for good.
    </Modal>,
  );
  const root = document.createElement("div");
  root.append(...new DOMParser().parseFromString(html, "text/html").body.childNodes);
  const dialog = root.querySelector("dialog") as HTMLDialogElement;
  const trigger = root.querySelector("a") as HTMLAnchorElement;
  // The island's root holds only the trigger; the dialog is a sibling, outside it.
  const island = document.createElement("div");
  island.append(trigger);
  document.body.append(island, dialog);
  await act(async () => {
    hydrateRoot(island, <ModalTrigger label="Delete draft" href={href} dialog={dialog.id} />);
  });
  return { dialog, trigger };
}

/** A click as the browser sends it; returns whether the link would still be followed (jsdom then stops it). */
const click = async (trigger: HTMLAnchorElement) => {
  let followed = false;
  const stop = (event: Event) => {
    followed = !event.defaultPrevented;
    event.preventDefault();
  };
  document.addEventListener("click", stop, { once: true });
  await act(async () => trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
  return followed;
};

test("modal_island_opens_dialog_and_returns_focus", async () => {
  const { dialog, trigger } = await mount();
  dialog.showModal = function (this: HTMLDialogElement) {
    this.open = true;
  };
  trigger.focus();
  expect(await click(trigger)).toBe(false);
  expect(dialog.open).toBe(true);
  (document.querySelector("h2") as HTMLElement).tabIndex = -1;
  (document.querySelector("h2") as HTMLElement).focus();
  dialog.open = false;
  dialog.dispatchEvent(new Event("close"));
  expect(document.activeElement).toBe(trigger);
});

test("modal_island_without_dialog_follows_link", async () => {
  const { dialog, trigger } = await mount();
  vi.stubGlobal("HTMLDialogElement", undefined);
  expect(await click(trigger)).toBe(true);
  expect(dialog.open).toBe(false);
});

test("modal_island_props_schema", () => {
  expect(isModalTriggerProps({ label: "Open", href: "/x", dialog: "_R_1_" })).toBe(true);
  for (const bad of [
    null,
    { label: "Open", href: "https://example.com/x", dialog: "_R_1_" },
    { label: "Open", href: "javascript:alert(1)", dialog: "_R_1_" },
    { label: "Open", href: "/x" },
  ]) {
    expect(isModalTriggerProps(bad), JSON.stringify(bad)).toBe(false);
  }
  expect(modal.propsSchema({ label: "Open", href: "/x", dialog: "_R_1_" })).toBe(true);
});
