// @vitest-environment jsdom
// The tabs island (P1.24j): keys in both modes, and the ARIA tabs pattern in the eager mode. The server markup is
// Tabs' own, parsed by the browser, and the bar is hydrated in its <nav> as the bootstrap would. The real-browser
// tabs_island_keyboard and axe run in P1.26's harness.
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, expect, test } from "vitest";
import tabsIsland from "../../islands/tabs.island.tsx";
import { type SafeHref, safeHref } from "../../safe-href.ts";
import { Tabs } from "./Tabs.tsx";
import { isTabsBarProps, TabsBar, type TabsBarProps } from "./TabsBar.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TABS = ["a", "b", "c"].map((id) => ({ id, label: id.toUpperCase(), content: `panel ${id}` }));
const hrefFor = (id: string) => safeHref(`/install?tab=${id}`, ["path"]) as SafeHref;

afterEach(() => {
  document.body.replaceChildren();
  history.replaceState(null, "", "/");
});

async function mount(eager: boolean) {
  const html = renderToString(<Tabs tabs={TABS} selected="a" hrefFor={hrefFor} label="Install" eager={eager} />);
  document.body.append(...new DOMParser().parseFromString(html, "text/html").body.childNodes);
  const base = /id="([^"]+)p0"/.exec(html)?.[1];
  const props: TabsBarProps = {
    label: "Install",
    tabs: TABS.map((tab) => ({ id: tab.id, label: tab.label, href: hrefFor(tab.id) })),
    selected: "a",
    ...(base === undefined ? {} : { base }),
  };
  await act(async () => {
    hydrateRoot(document.querySelector("nav") as HTMLElement, <TabsBar {...props} />);
  });
  const links = [...document.querySelectorAll("a")];
  const panels = base === undefined ? [] : TABS.map((_tab, i) => document.getElementById(`${base}p${i}`));
  return { links, panels };
}

const press = (key: string) =>
  act(async () => {
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });

test("tabs_island_eager_aria_pattern", async () => {
  const { links, panels } = await mount(true);
  expect(document.querySelector("ul")?.getAttribute("role")).toBe("tablist");
  expect(links.map((link) => [link.getAttribute("role"), link.getAttribute("aria-selected"), link.tabIndex])).toEqual([
    ["tab", "true", 0],
    ["tab", "false", -1],
    ["tab", "false", -1],
  ]);
  expect(panels.map((panel) => [panel?.getAttribute("role"), panel?.hidden])).toEqual([
    ["tabpanel", false],
    ["tabpanel", true],
    ["tabpanel", true],
  ]);
  expect(panels[1]?.getAttribute("aria-labelledby")).toBe(links[1]?.id);
  expect(links[1]?.getAttribute("aria-controls")).toBe(panels[1]?.id);
});

test("tabs_island_keyboard", async () => {
  const { links, panels } = await mount(true);
  links[0]?.focus();
  await press("ArrowRight");
  expect(document.activeElement).toBe(links[1]);
  expect(panels.map((panel) => panel?.hidden)).toEqual([true, false, true]);
  expect(location.search).toBe("?tab=b");
  await press("End");
  expect(document.activeElement).toBe(links[2]);
  await press("ArrowRight");
  expect(document.activeElement).toBe(links[0]);
  await press("ArrowLeft");
  await press("Home");
  expect(document.activeElement).toBe(links[0]);
  expect(links.map((link) => link.tabIndex)).toEqual([0, -1, -1]);
  expect(location.search).toBe("?tab=a");
});

test("tabs_island_click_switches_in_place", async () => {
  const { links, panels } = await mount(true);
  await act(async () => links[2]?.click());
  expect(panels.map((panel) => panel?.hidden)).toEqual([true, true, false]);
  expect(location.search).toBe("?tab=c");
});

test("tabs_island_default_mode_keys_only", async () => {
  const { links } = await mount(false);
  expect(document.querySelector("[role]")).toBeNull();
  links[0]?.focus();
  await press("ArrowRight");
  expect(document.activeElement).toBe(links[1]);
  // Focus moved; the choice is still the page's, made by following the link.
  expect(links[0]?.getAttribute("aria-current")).toBe("page");
  expect(location.search).toBe("");
});

test("tabs_island_props_schema", () => {
  const good = { label: "x", tabs: [{ id: "a", label: "A", href: "/a" }], selected: "a" };
  expect(isTabsBarProps(good)).toBe(true);
  expect(isTabsBarProps({ ...good, base: "_R_1_" })).toBe(true);
  for (const bad of [
    null,
    { ...good, tabs: [{ id: "a", label: "A", href: "javascript:alert(1)" }] },
    { ...good, selected: 1 },
    { ...good, base: 1 },
  ]) {
    expect(isTabsBarProps(bad), JSON.stringify(bad)).toBe(false);
  }
  expect(tabsIsland.propsSchema(good)).toBe(true);
});
