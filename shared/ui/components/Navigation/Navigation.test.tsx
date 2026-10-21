// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
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
      "Settings",
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
    expect(account?.getAttribute("aria-label")).toBe("Sign in");
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

describe("Navigation presentation adapter", () => {
  it("forwards safe destinations and accessible attributes in every placement", () => {
    const received: import("./Navigation.tsx").NavigationAnchorProps[] = [];
    const doc = documentFor({
      ...props,
      renderLink: (anchor) => {
        received.push(anchor);
        return <a {...anchor} data-adapted="true" />;
      },
    });
    expect(doc.querySelectorAll('a[data-adapted="true"]')).toHaveLength(6);
    expect(
      [...doc.querySelectorAll("a")].map((a) => [
        a.getAttribute("href"),
        a.getAttribute("aria-label"),
        a.getAttribute("aria-current") ?? undefined,
      ]),
    ).toEqual([
      ["/me", "Your profile", undefined],
      ["/", "Home", undefined],
      ["/settings/profile", "Settings", "page"],
      ["/", "Home", undefined],
      ["/me", "Your profile", undefined],
      ["/settings/profile", "Settings", "page"],
    ]);
    expect(received.every((anchor) => anchor.className.length > 0 && anchor.children !== undefined)).toBe(true);
    for (const link of doc.querySelectorAll("a")) expect(link.textContent).not.toBe("");
  });

  it("keeps remaining destinations at the end unless start placement is requested", () => {
    const end = documentFor().querySelector("nav > div");
    const start = documentFor({ ...props, itemsPlacement: "start" }).querySelector("nav > div");
    expect(end?.className).not.toContain("start");
    expect(start?.className).toContain("start");
    expect(
      [...documentFor({ ...props, itemsPlacement: "start" }).querySelectorAll("nav:first-child a")].map((a) =>
        a.getAttribute("href"),
      ),
    ).toEqual(["/me", "/", "/settings/profile"]);
  });
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("cleans up its document Escape listener across strict replay and unmount", async () => {
  const add = vi.spyOn(document, "addEventListener");
  const remove = vi.spyOn(document, "removeEventListener");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <StrictMode>
          <Navigation {...props} />
        </StrictMode>,
      ),
    );
    const added = add.mock.calls.filter(([type]) => type === "keydown");
    const removed = remove.mock.calls.filter(([type]) => type === "keydown");
    expect(added.length - removed.length).toBe(1);
    await act(async () => root.unmount());
    expect(remove.mock.calls.filter(([type]) => type === "keydown").map(([, listener]) => listener)).toEqual(
      added.map(([, listener]) => listener),
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
    add.mockRestore();
    remove.mockRestore();
  }
});
