// @vitest-environment jsdom
// P2.13e: the menu drawer's theme picker (Figma 151:939). Without script it is a plain form that POSTs and comes back;
// once its island runs, a choice is saved in the background and applied in place, so the drawer stays open (Alex,
// 2026-10-23 02:15Z).
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isThemePickerProps, ThemePicker, type ThemePickerProps } from "./ThemePicker.tsx";

const props: ThemePickerProps = {
  theme: "system",
  returnTo: "/settings/account",
  labels: { group: "Theme", dark: "Dark", system: "System", light: "Light" },
};
const markup = (value: ThemePickerProps = props) =>
  new DOMParser().parseFromString(renderToStaticMarkup(<ThemePicker {...value} />), "text/html");

describe("ThemePicker without script", () => {
  it("is one form of three submit buttons, the current one pressed", () => {
    const doc = markup({ ...props, theme: "light" });
    const form = doc.querySelector("form");
    expect([form?.getAttribute("method"), form?.getAttribute("action")]).toEqual(["post", "/prefs/theme"]);
    expect(doc.querySelector('input[type="hidden"][name="return"]')?.getAttribute("value")).toBe("/settings/account");
    expect(doc.querySelector("fieldset > legend")?.textContent).toBe("Theme");
    const buttons = [...doc.querySelectorAll("button")];
    expect(buttons.map((b) => [b.type, b.name, b.value, b.getAttribute("aria-pressed"), b.textContent])).toEqual([
      ["submit", "theme", "dark", "false", "Dark"],
      ["submit", "theme", "system", "false", "System"],
      ["submit", "theme", "light", "true", "Light"],
    ]);
    expect(buttons.every((b) => b.querySelector("svg") !== null)).toBe(true);
  });

  it("accepts only its own props shape", () => {
    expect(isThemePickerProps(props)).toBe(true);
    expect(isThemePickerProps({ ...props, theme: "blue" })).toBe(false);
    expect(isThemePickerProps({ ...props, returnTo: 1 })).toBe(false);
    expect(isThemePickerProps({ ...props, labels: { group: "Theme" } })).toBe(false);
  });
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ThemePicker with script", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute("data-theme");
    document.head.replaceChildren();
    document.body.replaceChildren();
  });

  async function mount(theme: ThemePickerProps["theme"] = "system") {
    document.head.replaceChildren(
      Object.assign(document.createElement("meta"), { name: "color-scheme", content: "dark light" }),
    );
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<ThemePicker {...props} theme={theme} />));
    const form = host.querySelector("form") as HTMLFormElement;
    const button = (value: string) => host.querySelector(`button[value="${value}"]`) as HTMLButtonElement;
    return { form, button };
  }

  it("saves the choice in the background and applies it in place", async () => {
    const fetch = vi.fn(async () => ({ type: "opaqueredirect", ok: false, status: 0 }) as Response);
    vi.stubGlobal("fetch", fetch);
    const navigated = vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => undefined);
    const { form, button } = await mount();
    await act(async () => form.requestSubmit(button("dark")));
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/prefs/theme");
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin", redirect: "manual" });
    expect(String(init.body)).toBe("theme=dark&return=%2Fsettings%2Faccount");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.querySelector('meta[name="color-scheme"]')?.getAttribute("content")).toBe("dark");
    expect(button("dark").getAttribute("aria-pressed")).toBe("true");
    expect(button("system").getAttribute("aria-pressed")).toBe("false");
    expect(navigated).not.toHaveBeenCalled();

    await act(async () => form.requestSubmit(button("system")));
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(document.querySelector('meta[name="color-scheme"]')?.getAttribute("content")).toBe("dark light");
    navigated.mockRestore();
  });

  it("falls back to the plain form when the save fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("offline");
      }),
    );
    const navigated = vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => undefined);
    const { form, button } = await mount();
    await act(async () => form.requestSubmit(button("light")));
    expect(navigated).toHaveBeenCalledTimes(1);
    expect(form.querySelector('input[type="hidden"][name="theme"]')?.getAttribute("value")).toBe("light");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    navigated.mockRestore();
  });
});
