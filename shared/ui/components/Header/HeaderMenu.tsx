// The Header's links and its folded menu (P1.24j; sheet components/Header/README.md, v45). The menu is the
// header-menu island: a <details> that opens and closes with no JS, to which the island adds Escape-to-close with
// focus back on the toggle. Its props are only labels and links, and the schema re-checks every link with safeHref,
// so a link that is not one never reaches the browser's markup. The action is a link styled as the kit's Button,
// written out here because Button's module also carries the Icon drawings, which would weigh on every page's island
// budget; header_action_matches_button keeps the two the same. P2.05p: an action that names a dialog is a button
// that opens that <dialog> as a modal with no script, through the invoker commands `commandfor` and
// `command="show-modal"` (HTML Living Standard, the button element; MDN marks them Baseline 2025, read 2026-10-23).
// The page draws the dialog, and the action's href is then only the fallback the page offers elsewhere. React 19.3
// does not know these attributes, so they are passed through as written.
import type { KeyboardEvent } from "react";
import { type HrefScheme, type SafeHref, safeHref } from "../../safe-href.ts";
import { classNames } from "../../src/class-names.ts";
import buttonStyles from "../Button/Button.module.css";
import styles from "./Header.module.css";

export type NavLink = { label: string; href: SafeHref; dialog?: string };
export type NavItem = NavLink & { current?: boolean };

export type HeaderMenuProps = {
  /** The toggle word. */
  label: string;
  nav: NavItem[];
  action?: NavLink;
};

const SCHEMES: readonly HrefScheme[] = ["path", "https:", "http:", "mailto:"];

/** A dialog id the page wrote: lowercase words joined by hyphens, nothing a selector or markup could read twice. */
const DIALOG_ID = /^[a-z]+(?:-[a-z]+)*$/;

const isLink = (value: unknown): value is NavLink => {
  const link = value as Partial<NavLink> | null;
  return (
    typeof link?.label === "string" &&
    typeof link.href === "string" &&
    safeHref(link.href, SCHEMES) !== null &&
    (link.dialog === undefined || (typeof link.dialog === "string" && DIALOG_ID.test(link.dialog)))
  );
};

export const isHeaderMenuProps = (value: unknown): value is HeaderMenuProps => {
  const props = value as Partial<HeaderMenuProps> | null;
  return (
    typeof props?.label === "string" &&
    Array.isArray(props.nav) &&
    props.nav.every((item) => isLink(item) && (item.current === undefined || typeof item.current === "boolean")) &&
    (props.action === undefined || isLink(props.action))
  );
};

/** The invoker-command attributes that open dialog `id` as a modal; React 19.3 passes unknown lowercase names through. */
const showModal = (id: string) => ({ commandfor: id, command: "show-modal" });

export function NavLinks({ nav, action }: { nav: readonly NavItem[]; action: NavLink | undefined }) {
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
      {action === undefined ? null : action.dialog === undefined ? (
        <a className={buttonStyles.root} href={action.href}>
          <span className={buttonStyles.fill} aria-hidden="true" />
          {action.label}
        </a>
      ) : (
        <button className={buttonStyles.root} type="button" {...showModal(action.dialog)}>
          <span className={buttonStyles.fill} aria-hidden="true" />
          {action.label}
        </button>
      )}
    </nav>
  );
}

function closeOnEscape(event: KeyboardEvent<HTMLDetailsElement>): void {
  const menu = event.currentTarget;
  if (event.key !== "Escape" || !menu.open) return;
  menu.open = false;
  menu.querySelector("summary")?.focus();
}

export function HeaderMenu({ label, nav, action }: HeaderMenuProps) {
  return (
    <details className={styles.menu} onKeyDown={closeOnEscape}>
      <summary className={styles.toggle}>
        {label}
        <span className={styles.caret} aria-hidden="true" />
      </summary>
      <div className={styles.panel}>
        <NavLinks nav={nav} action={action} />
      </div>
    </details>
  );
}
