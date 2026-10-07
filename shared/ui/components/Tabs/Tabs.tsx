// Tabs (P1.24k; sheet components/Tabs/README.md, v45): uppercase tabs over a `line` rule, the current one in `ink`
// with a 2px underline. With no JS each tab is a link to its own address (`?tab=<id>` from `hrefFor`) and the server
// renders only the chosen panel, marked `aria-current="page"`. A `selected` value that is no tab id falls back to the
// first tab and is never printed. The tabs island (P1.24j) turns this into the ARIA tabs pattern.
import type { ReactNode } from "react";
import type { SafeHref } from "../../safe-href.ts";
import { classNames } from "../../src/class-names.ts";
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
  className?: string;
};

export function Tabs({ tabs, selected, hrefFor, label, className }: TabsProps) {
  const current = tabs.find((tab) => tab.id === selected) ?? tabs[0];
  return (
    <div className={className}>
      <nav aria-label={label}>
        <ul className={styles.list}>
          {tabs.map((tab) => (
            <li key={tab.id}>
              <a
                className={classNames(styles.tab, tab === current && styles.current)}
                href={hrefFor(tab.id)}
                aria-current={tab === current ? "page" : undefined}
              >
                {tab.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {current === undefined ? null : <div className={styles.panel}>{current.content}</div>}
    </div>
  );
}
