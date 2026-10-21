// Approved core shell: components/Navigation/README.md. The native auto popover supplies zero-JS dismissal
// and focus restoration: https://html.spec.whatwg.org/multipage/popover.html (2026-10-20 Living Standard, read 2026-10-21).
import { type ReactNode, type Ref, useEffect, useId, useRef, useState } from "react";
import type { SafeHref } from "../../safe-href.ts";
import { classNames } from "../../src/class-names.ts";
import { Avatar } from "../Avatar/Avatar.tsx";
import header from "../Header/Header.module.css";
import { Icon, type IconName } from "../Icon/Icon.tsx";
import styles from "./Navigation.module.css";

type NavigationLink = { href: SafeHref; label: string; current?: boolean };
type NavigationItem = NavigationLink & { icon: IconName };

/** Return one real anchor, forwarding every supplied attribute and child. */
export type NavigationAnchorProps = {
  href: SafeHref;
  className: string;
  children: ReactNode;
  "aria-label": string;
  "aria-current"?: "page" | undefined;
  title?: string | undefined;
  ref?: Ref<HTMLAnchorElement>;
};
export type NavigationLinkRenderer = (props: NavigationAnchorProps) => ReactNode;
const anchor: NavigationLinkRenderer = (props) => <a {...props} />;

export type NavigationProps = {
  account: NavigationLink & { name?: string; src?: SafeHref };
  primary: NavigationItem;
  items: readonly NavigationItem[];
  menuLabel: string;
  closeLabel: string;
  /** Keep the bars in document flow for the kit showcase. */
  inline?: boolean;
  itemsPlacement?: "end" | "start";
  renderLink?: NavigationLinkRenderer;
  /** Advance after a committed selection, including same-target navigation and history traversal. */
  navigationKey?: string | number;
};

const controlClass = `${header.home} ${header.nav} ${styles.control}`;

function RailLink({
  item,
  children,
  renderLink,
  enhanced,
}: {
  item: NavigationLink;
  children: ReactNode;
  renderLink: NavigationLinkRenderer;
  enhanced: boolean;
}) {
  return renderLink({
    className: controlClass,
    href: item.href,
    "aria-label": item.label,
    title: enhanced ? undefined : item.label,
    "aria-current": item.current ? "page" : undefined,
    children: (
      <>
        {children}
        <span className={styles.label} aria-hidden="true">
          {item.label}
        </span>
      </>
    ),
  });
}

export function Navigation({
  account,
  primary,
  items,
  menuLabel,
  closeLabel,
  inline = false,
  itemsPlacement = "end",
  renderLink = anchor,
  navigationKey,
}: NavigationProps) {
  const panel = useId();
  const panelRef = useRef<HTMLElement>(null);
  const previousKey = useRef(navigationKey);
  const [labelsDismissed, setLabelsDismissed] = useState(false);
  const [enhanced, setEnhanced] = useState(false);
  useEffect(() => setEnhanced(true), []);
  // Caller-confirmed commits are independent of click preventDefault (SPA adapters use it on success).
  // hidePopover restores focus natively: HTML Living Standard popover algorithm, read 2026-10-21.
  useEffect(() => {
    if (previousKey.current !== navigationKey && panelRef.current?.matches(":popover-open"))
      panelRef.current.hidePopover();
    previousKey.current = navigationKey;
  }, [navigationKey]);
  const avatar = <Avatar name={account.name ?? ""} src={account.src} fallback={<Icon name="profile" size={20} />} />;
  return (
    <>
      <nav
        className={classNames(
          header.nav,
          styles.rail,
          enhanced && styles.enhanced,
          inline && styles.inline,
          labelsDismissed && styles.labelsDismissed,
        )}
        aria-label={menuLabel}
        onKeyDown={(event) => {
          if (event.key === "Escape") setLabelsDismissed(true);
        }}
        onBlur={() => setLabelsDismissed(false)}
        onPointerLeave={() => setLabelsDismissed(false)}
      >
        <RailLink item={account} renderLink={renderLink} enhanced={enhanced}>
          {avatar}
        </RailLink>
        <RailLink item={primary} renderLink={renderLink} enhanced={enhanced}>
          <Icon name={primary.icon} size={24} />
        </RailLink>
        <div className={classNames(styles.items, itemsPlacement === "start" && styles.start)}>
          {items.map((item) => (
            <RailLink key={item.href} item={item} renderLink={renderLink} enhanced={enhanced}>
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
        {renderLink({
          className: controlClass,
          href: primary.href,
          "aria-label": primary.label,
          "aria-current": primary.current ? "page" : undefined,
          children: <Icon name={primary.icon} size={24} label={primary.label} />,
        })}
        {renderLink({
          className: controlClass,
          href: account.href,
          "aria-label": account.label,
          "aria-current": account.current ? "page" : undefined,
          children: (
            <>
              {avatar}
              <span className="visually-hidden">{account.label}</span>
            </>
          ),
        })}
      </nav>
      <nav className={`${header.item} ${styles.panel}`} id={panel} ref={panelRef} popover="auto" aria-label={menuLabel}>
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
          <span key={item.href} className={styles.row}>
            {renderLink({
              className: classNames(header.nav, header.item, item.current && header.current),
              href: item.href,
              "aria-label": item.label,
              "aria-current": item.current ? "page" : undefined,
              children: (
                <>
                  <Icon name={item.icon} size={20} />
                  <span>{item.label}</span>
                </>
              ),
            })}
          </span>
        ))}
      </nav>
    </>
  );
}
