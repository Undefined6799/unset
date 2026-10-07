// @vitest-environment jsdom
// The select island (P1.24b; WAI-ARIA APG "Select-Only Combobox"): it takes over from the native <select> only once
// mounted, keeps that element as the form value, and follows the combobox pattern. Hydrated in jsdom from the server
// markup; the same tests run in a real browser on the showcase in P1.26's harness (select_island_keyboard,
// select_island_typeahead, select_island_flip_up).
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import select from "../../islands/select.island.tsx";
import styles from "./Select.module.css";
import { Select } from "./Select.tsx";
import { isSelectListboxProps, SelectListbox } from "./SelectListbox.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const options = [
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
  { value: "fy", label: "Frysk" },
];

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

async function mount(extra: { placeholder?: string } = {}) {
  const html = renderToString(<Select id="lang" name="lang" label="Language" options={options} {...extra} />);
  const form = document.createElement("form");
  form.append(...new DOMParser().parseFromString(html, "text/html").body.childNodes);
  document.body.append(form);
  const native = form.querySelector("select") as HTMLSelectElement;
  const island = document.createElement("div");
  native.parentElement?.append(island);
  const changes: string[] = [];
  native.addEventListener("change", () => changes.push(native.value));
  await act(async () => {
    hydrateRoot(island, <SelectListbox select="lang" />);
  });
  const box = form.querySelector('[role="combobox"]') as HTMLElement;
  const list = form.querySelector('[role="listbox"]') as HTMLElement;
  return { form, native, box, list, changes };
}

const press = (target: HTMLElement, key: string, init: KeyboardEventInit = {}) =>
  act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
  });
const active = (box: HTMLElement) =>
  document.getElementById(box.getAttribute("aria-activedescendant") ?? "")?.textContent;

test("select_island_takes_over_after_mount", async () => {
  const html = renderToString(<Select id="lang" name="lang" label="Language" options={options} />);
  expect(html).not.toMatch(/role="(combobox|listbox)"|\shidden[=\s>]/);
  const { form, native, box, list } = await mount();
  expect(native.hidden).toBe(true);
  expect(box.getAttribute("aria-label")).toBe("Language");
  expect(box.getAttribute("aria-expanded")).toBe("false");
  expect(box.getAttribute("aria-controls")).toBe(list.id);
  expect(box.tabIndex).toBe(0);
  expect(box.textContent).toBe("English▾");
  expect(list.hidden).toBe(true);
  expect(new FormData(form).get("lang")).toBe("en");
});

test("select_island_keyboard", async () => {
  const { form, box, list, changes } = await mount();
  box.focus();
  await press(box, "ArrowDown", { altKey: true });
  expect(box.getAttribute("aria-expanded")).toBe("true");
  expect(list.hidden).toBe(false);
  expect(active(box)).toBe("English");
  await press(box, "ArrowDown");
  expect(active(box)).toBe("Español");
  await press(box, "End");
  expect(active(box)).toBe("Frysk");
  await press(box, "ArrowDown");
  expect(active(box)).toBe("Frysk");
  await press(box, "Home");
  expect(active(box)).toBe("English");
  await press(box, "ArrowDown");
  await press(box, "ArrowDown");
  await press(box, "Enter");
  expect(box.getAttribute("aria-expanded")).toBe("false");
  expect(new FormData(form).get("lang")).toBe("fr");
  expect(changes).toEqual(["fr"]);
  expect(list.querySelector('[aria-selected="true"]')?.textContent).toBe("Français");
  await press(box, "Enter");
  await press(box, "ArrowUp");
  await press(box, "Escape");
  expect(box.getAttribute("aria-expanded")).toBe("false");
  expect(new FormData(form).get("lang")).toBe("fr");
  expect(document.activeElement).toBe(box);
});

test("select_island_typeahead", async () => {
  const { form, box } = await mount();
  vi.spyOn(Date, "now").mockReturnValue(1_000);
  // Closed: a letter picks straight away; the same letter again cycles through the matches.
  await press(box, "f");
  expect(new FormData(form).get("lang")).toBe("fr");
  await press(box, "f");
  expect(new FormData(form).get("lang")).toBe("fy");
  await press(box, "f");
  expect(new FormData(form).get("lang")).toBe("fr");
  // Open: letters typed together search as one word, and only move the highlight.
  vi.spyOn(Date, "now").mockReturnValue(5_000);
  await press(box, "Home");
  await press(box, "f");
  await press(box, "r");
  expect(active(box)).toBe("Français");
  await press(box, "y");
  expect(active(box)).toBe("Frysk");
  expect(new FormData(form).get("lang")).toBe("fr");
});

test("select_island_flip_up", async () => {
  const { box, list } = await mount();
  const rect = (top: number) => vi.spyOn(box, "getBoundingClientRect").mockReturnValue(new DOMRect(0, top, 200, 40));
  rect(innerHeight - 60);
  await press(box, "ArrowDown");
  expect(list.classList.contains(styles.up as string)).toBe(true);
  await press(box, "Escape");
  rect(20);
  await press(box, "ArrowDown");
  expect(list.classList.contains(styles.up as string)).toBe(false);
});

test("select_island_click_picks", async () => {
  const { form, box, list } = await mount({ placeholder: "pick one" });
  expect(box.textContent).toBe("pick one▾");
  expect(list.querySelectorAll('[role="option"]')).toHaveLength(4);
  await act(async () => box.click());
  expect(box.getAttribute("aria-expanded")).toBe("true");
  await act(async () => (list.querySelectorAll('[role="option"]')[1] as HTMLElement).click());
  expect(new FormData(form).get("lang")).toBe("es");
  expect(box.getAttribute("aria-expanded")).toBe("false");
});

test("select_island_props_schema", () => {
  expect(select.propsSchema({ select: "_R_1_" })).toBe(true);
  for (const bad of [null, {}, { select: 1 }]) expect(isSelectListboxProps(bad), JSON.stringify(bad)).toBe(false);
});
