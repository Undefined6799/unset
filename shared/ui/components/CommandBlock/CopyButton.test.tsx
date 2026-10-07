// @vitest-environment jsdom
// The copy island's component (P1.24j). The browser pair commandblock_copy_announces and
// commandblock_copy_denied_announces runs in P1.26's harness; these hydrate the server markup in jsdom with a
// stand-in clipboard, the one unmanaged dependency (rule TE-1).
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import copyIsland from "../../islands/copy.island.tsx";
import styles from "./CommandBlock.module.css";
import { CopyButton, isCopyButtonProps } from "./CopyButton.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LIVE = '<span class="visually-hidden" aria-live="polite"></span>';

function useClipboard(clipboard: { writeText: (text: string) => Promise<void> } | undefined): void {
  Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
}

/** The server markup (LIVE, as copy_island_no_js_no_button checks) beside a command, built node by node, then
 * hydrated as the bootstrap would. */
async function mount(): Promise<HTMLElement> {
  const command = document.createElement("code");
  command.id = "cmd";
  command.textContent = "npm ci";
  const live = document.createElement("span");
  live.className = "visually-hidden";
  live.setAttribute("aria-live", "polite");
  const root = document.createElement("div");
  root.append(live);
  document.body.append(command, root);
  await act(async () => {
    hydrateRoot(root, <CopyButton text="npm ci" target="cmd" />);
  });
  return root;
}

const click = async (root: HTMLElement) =>
  act(async () => {
    root.querySelector("button")?.click();
  });

afterEach(() => {
  document.body.replaceChildren();
  getSelection()?.removeAllRanges();
  vi.useRealTimers();
});

test("copy_island_no_js_no_button", () => {
  expect(renderToString(<CopyButton text="npm ci" target="cmd" />)).toBe(LIVE);
});

test("copy_island_button_after_mount", async () => {
  const root = await mount();
  expect(root.querySelector("button")?.outerHTML).toBe(`<button type="button" class="${styles.copy}">copy</button>`);
});

test("copy_island_announces_copied", async () => {
  const writeText = vi.fn(() => Promise.resolve());
  useClipboard({ writeText });
  const root = await mount();
  await click(root);
  expect(writeText).toHaveBeenCalledWith("npm ci");
  expect(root.querySelector("button")?.textContent).toBe("copied");
  expect(root.querySelector("[aria-live]")?.textContent).toBe("Copied");
});

test("copy_island_denied_selects_command", async () => {
  useClipboard({ writeText: () => Promise.reject(new DOMException("denied", "NotAllowedError")) });
  const root = await mount();
  await click(root);
  expect(root.querySelector("button")?.textContent).toBe("failed");
  expect(root.querySelector("[aria-live]")?.textContent).toMatch(/^Copy failed; the command is selected/);
  expect(getSelection()?.toString()).toBe("npm ci");
});

test("copy_island_without_clipboard_fails", async () => {
  useClipboard(undefined);
  const root = await mount();
  await click(root);
  expect(root.querySelector("button")?.textContent).toBe("failed");
});

test("copy_island_resets_after_sheet_delay", async () => {
  useClipboard({ writeText: () => Promise.resolve() });
  const root = await mount();
  vi.useFakeTimers();
  await click(root);
  await act(async () => vi.advanceTimersByTime(1399));
  expect(root.querySelector("button")?.textContent).toBe("copied");
  await act(async () => vi.advanceTimersByTime(1));
  expect(root.querySelector("button")?.textContent).toBe("copy");
  expect(root.querySelector("[aria-live]")?.textContent).toBe("");
});

test("copy_island_props_schema", () => {
  expect(isCopyButtonProps({ text: "npm ci", target: "cmd" })).toBe(true);
  for (const bad of [null, "npm ci", {}, { text: "npm ci" }, { text: 1, target: "cmd" }]) {
    expect(isCopyButtonProps(bad), JSON.stringify(bad)).toBe(false);
  }
  expect(copyIsland.propsSchema({ text: "npm ci", target: "cmd" })).toBe(true);
});
