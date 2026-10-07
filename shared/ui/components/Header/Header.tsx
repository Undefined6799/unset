// Header (P1.24k; sheet components/Header/README.md, v45): the mark linking home, uppercase nav links and one Button,
// over a `line` rule. It folds by a container query on the header itself, not the viewport: at 440px of content or
// less the inline nav is hidden and a <details> menu shows the same links, which opens and closes with no JS. Only
// one of the two is ever displayed, so assistive tech meets the links once. The menu is the header-menu island
// (P1.24j, HeaderMenu.tsx), which adds Escape-to-close and focus return.
import headerMenu from "../../islands/header-menu.island.tsx";
import { IslandSlot } from "../../islands/slot.ts";
import type { SafeHref } from "../../safe-href.ts";
import { classNames } from "../../src/class-names.ts";
import { Mark } from "../Mark/Mark.tsx";
import styles from "./Header.module.css";
import { type NavItem, type NavLink, NavLinks } from "./HeaderMenu.tsx";

export type HeaderProps = {
  /** At most five; mark the current page. */
  nav?: readonly NavItem[];
  /** The one Button, at the end of the nav. */
  action?: NavLink;
  /** Where the mark links; default "/". */
  homeHref?: SafeHref;
  /** The folded menu's toggle word; default "menu". */
  menuLabel?: string;
  className?: string;
};

export function Header({ nav = [], action, homeHref, menuLabel = "menu", className }: HeaderProps) {
  // The menu comes before the inline nav so that, folded or not, the shown one ends the bar.
  const menu = { label: menuLabel, nav: [...nav], ...(action === undefined ? {} : { action }) };
  return (
    <header className={classNames(styles.root, className)}>
      <div className={styles.bar}>
        <a className={styles.home} href={homeHref ?? "/"}>
          <Mark width={72} title="unset.sh home" />
        </a>
        <IslandSlot name="header-menu" island={headerMenu} props={menu} />
        <div className={styles.wide}>
          <NavLinks nav={nav} action={action} />
        </div>
      </div>
    </header>
  );
}
