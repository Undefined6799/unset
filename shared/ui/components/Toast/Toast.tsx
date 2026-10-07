// Toast (P1.24f; sheet components/Toast/README.md, v45, approved by Alex 2026-10-03, no timer): one status line at
// the bottom on a level-3 surface, `[ok] profile saved`. The region is in every page from the start (`role="status"`,
// or `role="alert"` for an error), so screen readers announce what appears in it. With no JS the server prints the
// toast into the page after a form post, and the close control is a plain link back to the same page; the toast
// island (P1.24j) closes it in place. It never hides on a timer.
import type { ReactNode } from "react";
import type { SafeHref } from "../../safe-href.ts";
import { classNames } from "../../src/class-names.ts";
import { Icon } from "../Icon/Icon.tsx";
import { Tag } from "../Tag/Tag.tsx";
import styles from "./Toast.module.css";

export type ToastProps = {
  /** ok (default), err or info: the Tag word in front. */
  tone?: "ok" | "err" | "info";
  /** One short lowercase line with no full stop; leave out to print only the empty region. */
  children?: ReactNode;
  /** The same page without the toast; shows the close control. */
  closeHref?: SafeHref;
  /** The close control's hidden label; default "Dismiss". */
  closeLabel?: string;
  /** In place instead of fixed at the bottom, for the showcase. */
  inline?: boolean;
  className?: string;
};

export function Toast({ tone = "ok", children, closeHref, closeLabel = "Dismiss", inline, className }: ToastProps) {
  return (
    <div
      className={classNames(styles.region, inline === true && styles.inline, className)}
      role={tone === "err" ? "alert" : "status"}
    >
      {children === undefined ? null : (
        <div className={styles.toast}>
          <Tag status={tone} />
          <span className={styles.text}>{children}</span>
          {closeHref === undefined ? null : (
            <a className={styles.close} href={closeHref}>
              <Icon name="close" size={16} label={closeLabel} />
            </a>
          )}
        </div>
      )}
    </div>
  );
}
