// @vitest-environment jsdom
// P2.13e: the menu drawer (Figma 135:806, 135:858, 135:935; Alex 2026-10-23). One native popover, opened by the
// header's menu button on desktop and by the floating bar's menu button on phones.
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type SafeHref, safeHref } from "../../safe-href.ts";
import header from "../Header/Header.module.css";
import { Navigation, NavigationMenuButton, type NavigationProps } from "./Navigation.tsx";

const path = (value: string) => safeHref(value, ["path"]) as SafeHref;
const props: NavigationProps = {
  menuId: "core-menu",
  account: { href: path("/me"), label: "Your profile", name: "Alex" },
  primary: { href: path("/"), label: "Home", icon: "home" },
  items: [{ href: path("/settings/profile"), label: "Settings", icon: "settings", current: true }],
  menuLabel: "Menu",
  closeLabel: "Close menu",
};
const render = (node: React.ReactNode) =>
  new DOMParser().parseFromString(renderToStaticMarkup(<>{node}</>), "text/html");
const documentFor = (value: NavigationProps = props) => render(<Navigation {...value} />);
const drawerOf = (doc: Document) => doc.querySelector('[popover="auto"]') as HTMLElement;

describe("Navigation drawer", () => {
  it("is one native popover with the brand, a close button and every destination with its label", () => {
    const doc = documentFor();
    const drawers = doc.querySelectorAll("[popover]");
    expect(drawers).toHaveLength(1);
    const drawer = drawerOf(doc);
    expect(drawer.id).toBe("core-menu");
    expect(drawer.getAttribute("aria-label")).toBe("Menu");
    const close = drawer.querySelector("button");
    expect(close?.getAttribute("popovertarget")).toBe("core-menu");
    expect(close?.getAttribute("popovertargetaction")).toBe("hide");
    expect(close?.getAttribute("aria-label")).toBe("Close menu");
    expect(close?.type).toBe("button");
    const links = [...drawer.querySelectorAll("li a")];
    expect(links.map((a) => [a.getAttribute("href"), a.querySelector("span:last-child")?.textContent])).toEqual([
      ["/", "Home"],
      ["/me", "Your profile"],
      ["/settings/profile", "Settings"],
    ]);
    expect(links.map((a) => a.getAttribute("aria-current"))).toEqual([null, null, "page"]);
    expect(drawer.querySelector("a")?.getAttribute("href")).toBe("/");
  });

  it("puts the caller's actions under a line and the extra at the very bottom", () => {
    const doc = documentFor({
      ...props,
      actions: <form id="sign-out" />,
      extra: <form id="theme" />,
    });
    const drawer = drawerOf(doc);
    expect(drawer.querySelector("#sign-out")).not.toBeNull();
    expect(drawer.lastElementChild?.querySelector("#theme")).not.toBeNull();
    expect(drawer.querySelector("ul ~ div #sign-out")).not.toBeNull();
  });

  it("comes before the phone bar, so the bar can hide while the drawer is open", () => {
    const doc = documentFor();
    const [drawer, bar] = [...doc.body.children];
    expect(drawer?.hasAttribute("popover")).toBe(true);
    expect(bar?.tagName).toBe("NAV");
    const toggle = bar?.querySelector("button");
    expect(toggle?.getAttribute("popovertarget")).toBe("core-menu");
    expect(toggle?.getAttribute("popovertargetaction")).toBe("toggle");
    expect([...(bar?.querySelectorAll("a") ?? [])].map((a) => a.getAttribute("href"))).toEqual(["/", "/me"]);
  });

  it("has no desktop rail, no script and no inline handlers", () => {
    const doc = documentFor();
    expect(doc.querySelectorAll("nav")).toHaveLength(2);
    expect(doc.querySelector("script, [data-island]")).toBeNull();
    expect(doc.body.innerHTML).not.toMatch(/\son\w+=/);
    expect(doc.querySelector('[role="menu"], [role="menuitem"]')).toBeNull();
  });

  it("shows anonymous account artwork rather than invented initials", () => {
    const doc = documentFor({ ...props, account: { href: path("/login"), label: "Sign in" } });
    const accounts = [...doc.querySelectorAll('a[href="/login"]')];
    expect(accounts).toHaveLength(2);
    for (const account of accounts) {
      expect(account.querySelector("svg")).not.toBeNull();
      expect(account.querySelector("img")).toBeNull();
      expect(account.textContent).toBe("Sign in");
    }
  });
});

describe("NavigationMenuButton", () => {
  it("toggles the drawer it names", () => {
    const doc = render(<NavigationMenuButton menuId="core-menu" label="Menu" />);
    const button = doc.querySelector("button");
    expect(button?.type).toBe("button");
    expect(button?.getAttribute("popovertarget")).toBe("core-menu");
    expect(button?.getAttribute("popovertargetaction")).toBe("toggle");
    expect(button?.getAttribute("aria-label")).toBe("Menu");
    // Alex 2026-10-23 02:14Z: inside the brand header, Header's .home rule squashed the icon to the mark's ratio.
    expect(button?.className).not.toContain(header.home);
    expect(button?.querySelector("svg")?.getAttribute("width")).toBe("24");
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
    const links = [...doc.querySelectorAll("a")];
    expect(links.every((a) => a.dataset.adapted === "true")).toBe(true);
    expect(links.map((a) => [a.getAttribute("href"), a.getAttribute("aria-current") ?? undefined])).toEqual([
      ["/", undefined],
      ["/", undefined],
      ["/me", undefined],
      ["/settings/profile", "page"],
      ["/", undefined],
      ["/me", undefined],
    ]);
    expect(received.every((anchor) => anchor.className.length > 0 && anchor.children !== undefined)).toBe(true);
    for (const link of links) expect(link.getAttribute("aria-label") ?? link.textContent).not.toBe("");
  });
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("hides an open drawer only when the caller's navigation key changes", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <StrictMode>
          <Navigation {...props} navigationKey={1} />
        </StrictMode>,
      ),
    );
    const drawer = host.querySelector("[popover]") as HTMLElement & { hidePopover: () => void };
    let hidden = 0;
    drawer.matches = ((selector: string) => selector === ":popover-open") as unknown as typeof drawer.matches;
    drawer.hidePopover = () => {
      hidden += 1;
    };
    const again = (key: number) =>
      act(async () =>
        root.render(
          <StrictMode>
            <Navigation {...props} navigationKey={key} />
          </StrictMode>,
        ),
      );
    await again(1);
    expect(hidden).toBe(0);
    await again(2);
    expect(hidden).toBe(1);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
