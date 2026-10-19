// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type SafeHref, safeHref } from "../../safe-href.ts";
import { Navigation, type NavigationProps } from "./Navigation.tsx";

const path = (value: string) => safeHref(value, ["path"]) as SafeHref;
const props: NavigationProps = {
  account: { href: path("/me"), label: "Your profile", name: "Alex" },
  primary: { href: path("/"), label: "Home", icon: "home" },
  items: [{ href: path("/settings/profile"), label: "Settings", icon: "settings", current: true }],
  menuLabel: "Menu",
  closeLabel: "Close menu",
};
const documentFor = (value: NavigationProps = props) =>
  new DOMParser().parseFromString(renderToStaticMarkup(<Navigation {...value} />), "text/html");

describe("Navigation", () => {
  it("keeps account and settings destinations usable as ordinary links", () => {
    const doc = documentFor();
    expect([...doc.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual([
      "/me",
      "/",
      "/settings/profile",
      "/",
      "/me",
      "/settings/profile",
    ]);
    expect([...doc.querySelectorAll('[aria-current="page"]')].map((link) => link.getAttribute("href"))).toEqual([
      "/settings/profile",
      "/settings/profile",
    ]);
    expect(doc.querySelector('[role="menu"], [role="menuitem"]')).toBeNull();
  });

  it("wires native toggle and close buttons to their own popover without scripts", () => {
    const doc = new DOMParser().parseFromString(
      renderToStaticMarkup(
        <>
          <Navigation {...props} />
          <Navigation {...props} />
        </>,
      ),
      "text/html",
    );
    const panels = [...doc.querySelectorAll('[popover="auto"]')];
    expect(panels).toHaveLength(2);
    expect(new Set(panels.map((panel) => panel.id)).size).toBe(2);
    for (const panel of panels) {
      const controls = [...doc.querySelectorAll("button")].filter(
        (button) => button.getAttribute("popovertarget") === panel.id,
      );
      expect(controls.map((button) => button.getAttribute("popovertargetaction"))).toEqual(["toggle", "hide"]);
      expect(controls.map((button) => button.getAttribute("aria-label"))).toEqual(["Menu", "Close menu"]);
      expect(controls.every((button) => button.type === "button")).toBe(true);
    }
    expect(doc.querySelector("script, [data-island]")).toBeNull();
    expect(doc.body.innerHTML).not.toMatch(/\son\w+=/);
  });

  it("names icon-only links independently of their native hover labels", () => {
    const doc = documentFor();
    const named = [...doc.querySelectorAll("a[aria-label]")];
    expect(named.map((link) => link.getAttribute("aria-label"))).toEqual([
      "Your profile",
      "Home",
      "Settings",
      "Home",
      "Your profile",
    ]);
    expect([...doc.querySelectorAll("a[title]")].map((link) => link.getAttribute("title"))).toEqual([
      "Your profile",
      "Home",
      "Settings",
    ]);
  });

  it("shows anonymous account artwork rather than invented initials", () => {
    const doc = documentFor({ ...props, account: { href: path("/login"), label: "Sign in" } });
    const account = doc.querySelector('a[href="/login"]');
    expect(account?.querySelector("svg")).not.toBeNull();
    expect(account?.querySelector("img")).toBeNull();
    expect(account?.textContent).toBe("Sign in");
    expect(account?.querySelector(".visually-hidden")?.textContent).toBe("Sign in");
  });

  it("marks the phone menu current only when it contains the current destination", () => {
    const toggle = (value: NavigationProps) => documentFor(value).querySelector('button[popovertargetaction="toggle"]');
    expect(toggle(props)?.getAttribute("data-current")).toBe("true");
    expect(
      toggle({
        ...props,
        items: [{ href: path("/settings/profile"), label: "Settings", icon: "settings" }],
      })?.hasAttribute("data-current"),
    ).toBe(false);
  });
});
