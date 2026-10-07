// The tabs island's bar (P1.24j; sheet components/Tabs/README.md, v45; step book record 2026-10-07-p124j-tabs-modes-
// and-styles-entry.md). The server and the first browser render print the P1.24k links, `aria-current` on the chosen
// one. Once JS runs, arrow keys, Home and End move between the tabs. In the default mode a tab still navigates to its
// own address; in the eager mode (`base` set) the bar becomes the ARIA tabs pattern (WAI-ARIA APG, Tabs with
// automatic activation): roving tabindex, every panel shown or hidden here with the `hidden` attribute, and the
// address kept in step with history.replaceState. Panels are reached by ids made from `base`, React's useId.
import { type KeyboardEvent, type MouseEvent, useEffect, useState } from "react";
import { type SafeHref, safeHref } from "../../safe-href.ts";
import { classNames } from "../../src/class-names.ts";
import styles from "./Tabs.module.css";

export type TabsBarTab = { id: string; label: string; href: SafeHref };

export type TabsBarProps = {
  /** Names the tablist in the eager mode; the nav around the bar carries it otherwise. */
  label: string;
  tabs: TabsBarTab[];
  /** The id of the chosen tab, already resolved by Tabs. */
  selected: string;
  /** Eager mode only: tab i is `<base>t<i>` and its panel `<base>p<i>`. */
  base?: string;
};

const isTab = (value: unknown): value is TabsBarTab => {
  const tab = value as Partial<TabsBarTab> | null;
  return (
    typeof tab?.id === "string" &&
    typeof tab.label === "string" &&
    typeof tab.href === "string" &&
    safeHref(tab.href, ["path", "https:", "http:"]) !== null
  );
};

export const isTabsBarProps = (value: unknown): value is TabsBarProps => {
  const props = value as Partial<TabsBarProps> | null;
  return (
    typeof props?.label === "string" &&
    Array.isArray(props.tabs) &&
    props.tabs.every(isTab) &&
    typeof props.selected === "string" &&
    (props.base === undefined || typeof props.base === "string")
  );
};

const STEP: Readonly<Record<string, (at: number, count: number) => number>> = {
  ArrowRight: (at, count) => (at + 1) % count,
  ArrowLeft: (at, count) => (at + count - 1) % count,
  Home: () => 0,
  End: (_at, count) => count - 1,
};

export function TabsBar({ label, tabs, selected, base }: TabsBarProps) {
  const [mounted, setMounted] = useState(false);
  const [current, setCurrent] = useState(selected);
  useEffect(() => setMounted(true), []);
  const eager = mounted && base !== undefined;
  useEffect(() => {
    if (!eager) return;
    tabs.forEach((tab, i) => {
      const panel = document.getElementById(`${base}p${i}`);
      if (panel === null) return;
      panel.hidden = tab.id !== current;
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", `${base}t${i}`);
    });
  }, [eager, base, tabs, current]);

  const select = (tab: TabsBarTab) => {
    setCurrent(tab.id);
    history.replaceState(history.state, "", tab.href);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const links = [...event.currentTarget.querySelectorAll("a")];
    const at = links.indexOf(document.activeElement as HTMLAnchorElement);
    const step = STEP[event.key];
    if (step === undefined || at < 0) return;
    event.preventDefault();
    const next = step(at, links.length);
    links[next]?.focus();
    const tab = tabs[next];
    if (eager && tab !== undefined) select(tab);
  };

  return (
    <ul
      className={styles.list}
      role={eager ? "tablist" : undefined}
      aria-label={eager ? label : undefined}
      onKeyDown={onKeyDown}
    >
      {tabs.map((tab, i) => {
        const chosen = tab.id === current;
        const asTab = eager
          ? {
              id: `${base}t${i}`,
              role: "tab",
              "aria-selected": chosen,
              "aria-controls": `${base}p${i}`,
              tabIndex: chosen ? 0 : -1,
              onClick: (event: MouseEvent) => {
                event.preventDefault();
                select(tab);
              },
            }
          : { "aria-current": chosen ? ("page" as const) : undefined };
        return (
          <li key={tab.id} role={eager ? "presentation" : undefined}>
            <a className={classNames(styles.tab, chosen && styles.current)} href={tab.href} {...asTab}>
              {tab.label}
            </a>
          </li>
        );
      })}
    </ul>
  );
}
