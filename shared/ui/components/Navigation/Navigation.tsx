// Approved core shell: components/Navigation/README.md. The native auto popover supplies zero-JS dismissal
// and focus restoration: https://html.spec.whatwg.org/multipage/popover.html (2026-10-16 Living Standard).
import { type ReactNode, useId } from "react";
import type { SafeHref } from "../../safe-href.ts";
import { classNames } from "../../src/class-names.ts";
import { Avatar } from "../Avatar/Avatar.tsx";
import header from "../Header/Header.module.css";
import { Icon, type IconName } from "../Icon/Icon.tsx";
import styles from "./Navigation.module.css";

type NavigationLink = { href: SafeHref; label: string; current?: boolean };
type NavigationItem = NavigationLink & { icon: IconName };

export type NavigationProps = {
  account: NavigationLink & { name?: string; src?: SafeHref };
  primary: NavigationItem;
  items: readonly NavigationItem[];
  menuLabel: string;
  closeLabel: string;
  /** Keep the bars in document flow for the kit showcase. */
  inline?: boolean;
};

const controlClass = `${header.home} ${header.nav} ${styles.control}`;

function RailLink({ item, children }: { item: NavigationLink; children: ReactNode }) {
  return (
    <a
      className={controlClass}
      href={item.href}
      aria-label={item.label}
      title={item.label}
      aria-current={item.current ? "page" : undefined}
    >
      {children}
      <span className="visually-hidden">{item.label}</span>
    </a>
  );
}

export function Navigation({ account, primary, items, menuLabel, closeLabel, inline = false }: NavigationProps) {
  const panel = useId();
  const avatar = <Avatar name={account.name ?? ""} src={account.src} fallback={<Icon name="profile" size={20} />} />;
  return (
    <>
      <nav className={classNames(header.nav, styles.rail, inline && styles.inline)} aria-label={menuLabel}>
        <RailLink item={account}>{avatar}</RailLink>
        <RailLink item={primary}>
          <Icon name={primary.icon} size={24} />
        </RailLink>
        <div className={styles.items}>
          {items.map((item) => (
            <RailLink key={item.href} item={item}>
              <Icon name={item.icon} size={24} />
            </RailLink>
          ))}
        </div>
      </nav>
      <nav className={classNames(styles.phone, inline && styles.inline)} aria-label={menuLabel}>
        <button
          className={controlClass}
          type="button"
          aria-label={menuLabel}
          data-current={items.some((item) => item.current) || undefined}
          popoverTarget={panel}
          popoverTargetAction="toggle"
        >
          <Icon name="menu" size={24} label={menuLabel} />
        </button>
        <a
          className={controlClass}
          href={primary.href}
          aria-label={primary.label}
          aria-current={primary.current ? "page" : undefined}
        >
          <Icon name={primary.icon} size={24} label={primary.label} />
        </a>
        <a
          className={controlClass}
          href={account.href}
          aria-label={account.label}
          aria-current={account.current ? "page" : undefined}
        >
          {avatar}
          <span className="visually-hidden">{account.label}</span>
        </a>
      </nav>
      <nav className={`${header.item} ${styles.panel}`} id={panel} popover="auto" aria-label={menuLabel}>
        <div className={header.nav}>
          <span>{menuLabel}</span>
          <button
            className={controlClass}
            type="button"
            aria-label={closeLabel}
            popoverTarget={panel}
            popoverTargetAction="hide"
          >
            <Icon name="close" size={20} label={closeLabel} />
          </button>
        </div>
        {items.map((item) => (
          <a
            key={item.href}
            className={`${header.nav} ${header.item} ${item.current ? header.current : ""}`}
            href={item.href}
            aria-current={item.current ? "page" : undefined}
          >
            <Icon name={item.icon} size={20} />
            <span>{item.label}</span>
          </a>
        ))}
      </nav>
    </>
  );
}
