import { describe, expect, test } from "vitest";
import { documentPrefs, parseTheme, resolvePrefs, THEME_COOKIE, themeCookie } from "./theme.ts";

const cookie = (value: string) => `${THEME_COOKIE}=${value}`;

describe("theme cookie", () => {
  test("theme_cookie_attributes", () => {
    expect(themeCookie("light")).toBe(
      `${THEME_COOKIE}=light; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=31536000`,
    );
    expect(themeCookie("dark")).toBe(`${THEME_COOKIE}=dark; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=31536000`);
  });

  test("theme_cookie_system_deletes", () => {
    expect(themeCookie("system")).toBe(`${THEME_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`);
  });

  test("theme_cookie_is_host_only", () => {
    expect(THEME_COOKIE.startsWith("__Host-")).toBe(true);
    expect(themeCookie("light")).not.toMatch(/domain/i);
  });

  test("parse_theme_allowlist_only", () => {
    expect(["dark", "light", "system"].map(parseTheme)).toEqual(["dark", "light", "system"]);
    for (const bad of ["", "Dark", "light ", "<script>", "auto", null, undefined, 1, ["light"]]) {
      expect(parseTheme(bad)).toBeNull();
    }
  });
});

describe("resolvePrefs", () => {
  test("app_group_reads_the_cookie", () => {
    expect(resolvePrefs("app", cookie("light"))).toEqual({ theme: "light", vary: ["Cookie"] });
    expect(resolvePrefs("app", `a=1; ${cookie("dark")}; b=2`).theme).toBe("dark");
  });

  test("app_group_bad_cookie_is_system", () => {
    for (const header of [null, "", cookie("<script>"), cookie("system"), cookie("Light"), `${THEME_COOKIE}`]) {
      expect(resolvePrefs("app", header)).toEqual({ theme: "system", vary: ["Cookie"] });
    }
  });

  test("app_group_duplicate_cookie_is_system", () => {
    expect(resolvePrefs("app", `${cookie("light")}; ${cookie("dark")}`).theme).toBe("system");
    expect(resolvePrefs("app", `${cookie("light")}; ${cookie("light")}`).theme).toBe("system");
  });

  test("public_groups_never_read_the_cookie", () => {
    for (const group of ["profile", "static", "media", "api", "admin"] as const) {
      expect(resolvePrefs(group, cookie("light"))).toEqual({ theme: "system", vary: [] });
    }
  });
});

describe("documentPrefs", () => {
  test("app_document_theme_attr", () => {
    expect(documentPrefs("app", cookie("light")).htmlAttrs).toEqual({ lang: "en", "data-theme": "light" });
    expect(documentPrefs("app", cookie("dark")).htmlAttrs).toEqual({ lang: "en", "data-theme": "dark" });
    expect(documentPrefs("app", null).htmlAttrs).toEqual({ lang: "en" });
    expect(documentPrefs("app", cookie("<script>")).htmlAttrs).toEqual({ lang: "en" });
  });

  test("color_scheme_meta_matches", () => {
    expect(documentPrefs("app", cookie("light")).colorScheme).toBe("light");
    expect(documentPrefs("app", cookie("dark")).colorScheme).toBe("dark");
    expect(documentPrefs("app", null).colorScheme).toBe("dark light");
    expect(documentPrefs("profile", cookie("light")).colorScheme).toBe("dark light");
  });

  test("theme_function_ignores_cookies_for_public_group", () => {
    const without = documentPrefs("profile", null);
    for (const header of [cookie("light"), cookie("dark"), `${cookie("light")}; __Host-locale=fr`]) {
      expect(JSON.stringify(documentPrefs("profile", header))).toBe(JSON.stringify(without));
    }
    expect(Object.keys(without.headers).map((h) => h.toLowerCase())).not.toContain("vary");
  });

  test("theme_function_varies_on_cookie_for_app_group", () => {
    for (const header of [null, cookie("light")]) {
      expect(documentPrefs("app", header).headers).toEqual({ vary: "Cookie", "cache-control": "private, no-store" });
    }
  });
});
