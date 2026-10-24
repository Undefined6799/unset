// @vitest-environment jsdom
// The share island's component (Alex 2026-10-24 00:12Z). The server markup is only the live region; hydrated in jsdom,
// the button shares through a stand-in navigator.share, or copies the address through a stand-in clipboard, the
// unmanaged dependencies (rule TE-1).
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import { ShareButton } from "./ShareButton.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PROPS = { label: "Share profile", copied: "Copied", copyFailed: "Copy failed" };

function stand(name: "share" | "clipboard", value: unknown): void {
  Object.defineProperty(navigator, name, { value, configurable: true });
}

async function mount(): Promise<HTMLElement> {
  // The server markup (share_no_js_no_button), built node by node: only the empty live region.
  const live = document.createElement("span");
  live.className = "visually-hidden";
  live.setAttribute("aria-live", "polite");
  const root = document.createElement("div");
  root.append(live);
  document.body.append(root);
  await act(async () => {
    hydrateRoot(root, <ShareButton {...PROPS} />);
  });
  return root;
}

afterEach(() => {
  document.body.replaceChildren();
  stand("share", undefined);
  stand("clipboard", undefined);
});

test("share_no_js_no_button", () => {
  expect(renderToString(<ShareButton {...PROPS} />)).not.toContain("<button");
});

test("share_uses_the_system_share_sheet", async () => {
  const share = vi.fn(async () => undefined);
  stand("share", share);
  const root = await mount();
  const button = root.querySelector("button");
  expect(button?.getAttribute("aria-label")).toBe("Share profile");
  await act(async () => button?.click());
  expect(share).toHaveBeenCalledWith({ title: document.title, url: location.href });
});

test("share_copies_the_address_without_a_share_sheet", async () => {
  const writeText = vi.fn(async () => undefined);
  stand("clipboard", { writeText });
  const root = await mount();
  await act(async () => root.querySelector("button")?.click());
  expect(writeText).toHaveBeenCalledWith(location.href);
  expect(root.querySelector("[aria-live]")?.textContent).toBe("Copied");
});

test("share_says_when_the_copy_fails", async () => {
  const root = await mount();
  await act(async () => root.querySelector("button")?.click());
  expect(root.querySelector("[aria-live]")?.textContent).toBe("Copy failed");
});
