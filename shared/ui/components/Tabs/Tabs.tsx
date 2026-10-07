// Tabs (P1.24k; sheet components/Tabs/README.md, v45): uppercase tabs over a `line` rule, the current one in `ink`
// with a 2px underline. With no JS each tab is a link to its own address (`?tab=<id>` from `hrefFor`) and the server
// renders only the chosen panel, marked `aria-current="page"`. A `selected` value that is no tab id falls back to the
// first tab and is never printed. The bar is the tabs island (P1.24j, TabsBar.tsx). The `eager` mode (step book
// record 2026-10-07-p124j-tabs-modes-and-styles-entry.md) renders every panel, the unchosen ones with the `hidden`
// attribute, so the island can switch them in place. Hiding is not a security boundary: an eager panel holds only
// what the viewer may see on this request and is cheap to render; anything else uses the default mode.
import { type ReactNode, useId } from "react";
import { IslandSlot } from "../../islands/slot.ts";
import tabsIsland from "../../islands/tabs.island.tsx";
import type { SafeHref } from "../../safe-href.ts";
import styles from "./Tabs.module.css";

export type TabsProps = {
  /** Two to five tabs, one word each. */
  tabs: readonly { id: string; label: string; content: ReactNode }[];
  /** The requested tab id, as the query carried it; anything else shows the first tab. */
  selected?: string | undefined;
  /** The address of a tab, e.g. the page with `?tab=<id>`. */
  hrefFor: (id: string) => SafeHref;
  /** Names the set of tabs for screen readers. */
  label: string;
  /** Render every panel, the unchosen ones hidden, and switch them in place with JS. */
  eager?: boolean;
  className?: string;
};

export function Tabs({ tabs, selected, hrefFor, label, eager = false, className }: TabsProps) {
  // The island reaches eager panels by ids made from React's useId, never from the tab ids.
  const base = useId();
  const current = tabs.find((tab) => tab.id === selected) ?? tabs[0];
  const bar = {
    label,
    tabs: tabs.map((tab) => ({ id: tab.id, label: tab.label, href: hrefFor(tab.id) })),
    selected: current?.id ?? "",
    ...(eager ? { base } : {}),
  };
  return (
    <div className={className}>
      <nav aria-label={label}>
        <IslandSlot name="tabs" island={tabsIsland} props={bar} />
      </nav>
      {eager ? (
        tabs.map((tab, i) => (
          <div key={tab.id} id={`${base}p${i}`} className={styles.panel} hidden={tab !== current}>
            {tab.content}
          </div>
        ))
      ) : current === undefined ? null : (
        <div className={styles.panel}>{current.content}</div>
      )}
    </div>
  );
}
