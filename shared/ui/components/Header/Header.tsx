// Header (P1.24k; sheet components/Header/README.md, v45): the mark linking home, uppercase nav links and one Button,
// over a `line` rule. It folds by a container query on the header itself, not the viewport: at 440px of content or
// less the inline nav is hidden and a <details> menu shows the same links, which opens and closes with no JS. Only
// one of the two is ever displayed, so assistive tech meets the links once. The header-menu island (P1.24j) adds
// Escape-to-close and focus return.
import type { SafeHref } from "../../safe-href.ts";
import { classNames } from "../../src/class-names.ts";
import { Button } from "../Button/Button.tsx";
import { Mark } from "../Mark/Mark.tsx";
import styles from "./Header.module.css";

export type HeaderProps = {
  /** At most five; mark the current page. */
  nav?: readonly { label: string; href: SafeHref; current?: boolean }[];
  /** The one Button, at the end of the nav. */
  action?: { label: string; href: SafeHref };
  /** Where the mark links; default "/". */
  homeHref?: SafeHref;
  /** The folded menu's toggle word; default "menu". */
  menuLabel?: string;
  className?: string;
};

function NavLinks({ nav = [], action }: { nav: HeaderProps["nav"] | undefined; action: HeaderProps["action"] }) {
  return (
    <nav className={styles.nav} aria-label="Main">
      {nav.map((item) => (
        <a
          key={item.href}
          href={item.href}
          className={classNames(styles.item, item.current === true && styles.current)}
          aria-current={item.current === true ? "page" : undefined}
        >
          {item.label}
        </a>
      ))}
      {action === undefined ? null : (
        <Button as="a" href={action.href}>
          {action.label}
        </Button>
      )}
    </nav>
  );
}

export function Header({ nav, action, homeHref, menuLabel = "menu", className }: HeaderProps) {
  return (
    <header className={classNames(styles.root, className)}>
      <div className={styles.bar}>
        <a className={styles.home} href={homeHref ?? "/"}>
          <Mark width={72} title="unset.sh home" />
        </a>
        <div className={styles.wide}>
          <NavLinks nav={nav} action={action} />
        </div>
        <details className={styles.menu}>
          <summary className={styles.toggle}>
            {menuLabel}
            <span className={styles.caret} aria-hidden="true" />
          </summary>
          <div className={styles.panel}>
            <NavLinks nav={nav} action={action} />
          </div>
        </details>
      </div>
    </header>
  );
}
