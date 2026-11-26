// unset.sh's light / dark / device switch, carried to the chat (Alex 2026-11-23: "that switch ... should be affecting
// everything"): read from the sign-in hop's fragment, kept by this origin, and put on <html data-theme> as unset.sh does.
import { describe, expect, test } from "vitest";
import { applyTheme, parseTheme, themeFromFragment } from "./theme.ts";

describe("theme", () => {
  test("chat.theme_parse: only light, dark or system", () => {
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("system")).toBe("system");
    expect(parseTheme("Dark")).toBeNull();
    expect(parseTheme(null)).toBeNull();
    expect(parseTheme(3)).toBeNull();
  });

  test("chat.theme_from_hop: the hop's fragment names the choice once, else nothing", () => {
    expect(themeFromFragment("#ticket=abc&theme=dark")).toBe("dark");
    expect(themeFromFragment("#ticket=abc")).toBeNull();
    expect(themeFromFragment("#theme=dark&theme=light")).toBeNull();
    expect(themeFromFragment("#theme=evil")).toBeNull();
    expect(themeFromFragment("")).toBeNull();
  });

  test("chat.theme_apply: a choice sets data-theme and the colour-scheme meta; device clears it", () => {
    const attributes = new Map<string, string>();
    const meta = new Map<string, string>();
    const page = {
      documentElement: {
        setAttribute: (k: string, v: string) => attributes.set(k, v),
        removeAttribute: (k: string) => attributes.delete(k),
      },
      querySelector: () => ({ setAttribute: (k: string, v: string) => meta.set(k, v) }),
    };
    applyTheme(page, "dark");
    expect(attributes.get("data-theme")).toBe("dark");
    expect(meta.get("content")).toBe("dark");
    applyTheme(page, "system");
    expect(attributes.has("data-theme")).toBe(false);
    expect(meta.get("content")).toBe("dark light");
  });
});
