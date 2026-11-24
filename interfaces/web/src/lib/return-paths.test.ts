import { describe, expect, test } from "vitest";
import { signInHref, themeReturn } from "./return-paths.ts";

const at = (address: string): URL => new URL(address, "https://unset.test");

describe("the shell's return paths", () => {
  test("sign_in_returns_to_the_page_except_from_home_and_the_sign_in_pages", () => {
    expect(signInHref("/legal/terms")).toBe("/login?next=%2Flegal%2Fterms");
    expect(signInHref("/@alice.unset.org")).toBe("/login?next=%2F%40alice.unset.org");
    for (const path of ["/", "/signed-out", "/login", "/login/continue"]) expect(signInHref(path), path).toBe("/login");
  });

  test("the_link_is_always_our_sign_in_page_whatever_the_path_holds", () => {
    for (const path of ["//evil.test/x", "/\\evil.test", "/javascript:alert(1)", '/"><script>', "/a?b=c&next=/x#y"]) {
      const href = signInHref(path);
      expect(href.startsWith("/login?next="), path).toBe(true);
      const link = at(href);
      expect(link.origin, path).toBe("https://unset.test");
      expect(link.pathname, path).toBe("/login");
      // One parameter, the path whole: nothing in it becomes a second parameter or a fragment.
      expect([...link.searchParams.keys()], path).toEqual(["next"]);
      expect(link.searchParams.get("next"), path).toBe(path);
      expect(link.hash, path).toBe("");
    }
  });

  test("an_address_too_long_to_return_to_is_not_sent", () => {
    expect(signInHref(`/${"a".repeat(511)}`)).toBe(`/login?next=%2F${"a".repeat(511)}`);
    expect(signInHref(`/${"a".repeat(512)}`)).toBe("/login");
    expect(themeReturn(at(`/${"a".repeat(511)}`))).toBe(`/${"a".repeat(511)}`);
    expect(themeReturn(at(`/${"a".repeat(512)}`))).toBe("/");
    // A sign-in page with a long query keeps its path.
    expect(themeReturn(at(`/login?next=/${"a".repeat(600)}`))).toBe("/login");
  });

  test("the_theme_form_returns_to_the_page_and_keeps_the_query_only_on_a_sign_in_page", () => {
    expect(themeReturn(at("/settings/profile?tab=x"))).toBe("/settings/profile");
    expect(themeReturn(at("/login?next=%2Fme&handle=alice.unset.org"))).toBe(
      "/login?next=%2Fme&handle=alice.unset.org",
    );
    expect(themeReturn(at("/login/continue?next=%2Fme"))).toBe("/login/continue?next=%2Fme");
    expect(themeReturn(at("/"))).toBe("/");
  });
});
