// Approved core shell: components/Navigation/README.md. P2.13e replaces the desktop rail and the phone popup with one
// left drawer (Figma 135:806, 135:858, 135:935; Alex 2026-10-23). The native auto popover supplies zero-JS opening,
// Escape and outside dismissal, the top layer and focus restoration:
// https://html.spec.whatwg.org/multipage/popover.html (2026-10-20 Living Standard, read 2026-10-21).
import { type ReactNode, type Ref, useEffect, useRef } from "react";
import type { SafeHref } from "../../safe-href.ts";
import { classNames } from "../../src/class-names.ts";
import { Avatar } from "../Avatar/Avatar.tsx";
import header from "../Header/Header.module.css";
import { Icon, type IconName } from "../Icon/Icon.tsx";
import { Mark } from "../Mark/Mark.tsx";
import styles from "./Navigation.module.css";

type NavigationLink = { href: SafeHref; label: string; current?: boolean };
type NavigationItem = NavigationLink & { icon: IconName };

/** Return one real anchor, forwarding every supplied attribute and child. */
export type NavigationAnchorProps = {
  href: SafeHref;
  className: string;
  children: ReactNode;
  "aria-label"?: string | undefined;
  "aria-current"?: "page" | undefined;
  ref?: Ref<HTMLAnchorElement>;
};
export type NavigationLinkRenderer = (props: NavigationAnchorProps) => ReactNode;
const anchor: NavigationLinkRenderer = (props) => <a {...props} />;

export type NavigationProps = {
  /** The drawer's id; NavigationMenuButton names the same id. One drawer per page. */
  menuId: string;
  account: NavigationLink & { name?: string; src?: SafeHref };
  primary: NavigationItem;
  items: readonly NavigationItem[];
  menuLabel: string;
  closeLabel?: string;
  homeLabel?: string;
  /** Keep the phone bar in document flow for the kit showcase. */
  inline?: boolean;
  renderLink?: NavigationLinkRenderer;
  /** Advance after a committed selection, including same-target navigation and history traversal. */
  navigationKey?: string | number;
  /** Under a line after the destinations. The caller owns the controls (sign-out form). */
  actions?: ReactNode;
  /** The very bottom of the drawer, under a line (theme picker). The caller owns the control. */
  extra?: ReactNode;
};

const controlClass = `${header.home} ${header.nav} ${styles.control}`;

/** The header's menu button on desktop; phones use the floating bar's. */
export function NavigationMenuButton({ menuId, label }: { menuId: string; label: string }) {
  return (
    <button
      className={`${controlClass} ${styles.menuButton}`}
      type="button"
      aria-label={label}
      popoverTarget={menuId}
      popoverTargetAction="toggle"
    >
      <Icon name="menu" size={24} label={label} />
    </button>
  );
}

export function Navigation({
  menuId,
  account,
  primary,
  items,
  menuLabel,
  closeLabel = "Close menu",
  homeLabel = "unset.sh home",
  inline = false,
  renderLink = anchor,
  navigationKey,
  actions,
  extra,
}: NavigationProps) {
  const drawerRef = useRef<HTMLElement>(null);
  const previousKey = useRef(navigationKey);
  // Caller-confirmed commits are independent of click preventDefault (SPA adapters use it on success).
  // hidePopover restores focus natively: HTML Living Standard popover algorithm, read 2026-10-21.
  useEffect(() => {
    if (previousKey.current !== navigationKey && drawerRef.current?.matches(":popover-open"))
      drawerRef.current.hidePopover();
    previousKey.current = navigationKey;
  }, [navigationKey]);
  const avatar = (size: 24 | 40) => (
    <Avatar
      name={account.name ?? ""}
      src={account.src}
      size={size}
      fallback={<Icon name="profile" size={size === 24 ? 16 : 20} />}
    />
  );
  const row = (item: NavigationLink, art: ReactNode) =>
    renderLink({
      className: classNames(styles.row, item.current && styles.current),
      href: item.href,
      "aria-current": item.current ? "page" : undefined,
      children: (
        <>
          {art}
          <span>{item.label}</span>
        </>
      ),
    });
  return (
    <>
      <nav className={styles.drawer} id={menuId} ref={drawerRef} popover="auto" aria-label={menuLabel}>
        <div className={styles.head}>
          {renderLink({
            className: `${header.home}`,
            href: primary.href,
            "aria-label": homeLabel,
            children: <Mark width={72} />,
          })}
          <button
            className={styles.close}
            type="button"
            aria-label={closeLabel}
            popoverTarget={menuId}
            popoverTargetAction="hide"
          >
            <Icon name="close" size={24} label={closeLabel} />
          </button>
        </div>
        <ul className={styles.list}>
          <li>{row(primary, <Icon name={primary.icon} size={24} />)}</li>
          <li>{row(account, avatar(24))}</li>
          {items.map((item) => (
            <li key={item.href}>{row(item, <Icon name={item.icon} size={24} />)}</li>
          ))}
        </ul>
        {actions == null ? null : <div className={styles.actions}>{actions}</div>}
        {extra == null ? null : <div className={styles.extra}>{extra}</div>}
      </nav>
      <nav className={classNames(styles.phone, inline && styles.inline)} aria-label={menuLabel}>
        <button
          className={controlClass}
          type="button"
          aria-label={menuLabel}
          popoverTarget={menuId}
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
          "aria-current": account.current ? "page" : undefined,
          children: (
            <>
              {avatar(40)}
              <span className="visually-hidden">{account.label}</span>
            </>
          ),
        })}
      </nav>
    </>
  );
}
