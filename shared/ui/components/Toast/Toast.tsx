// Toast (P1.24f; sheet components/Toast/README.md, v45, approved by Alex 2026-10-03, no timer): one status line at
// the bottom on a level-3 surface, `[ok] profile saved`. The region is in every page from the start (`role="status"`,
// or `role="alert"` for an error), so screen readers announce what appears in it. With no JS the server prints the
// toast into the page after a form post, and the close control is a plain link back to the same page; the toast
// island (P1.24b), placed by IslandSlot, closes it in place. It never hides on a timer.
import { type ReactNode, useId } from "react";
import { IslandSlot } from "../../islands/slot.ts";
import toast from "../../islands/toast.island.tsx";
import type { SafeHref } from "../../safe-href.ts";
import { classNames } from "../../src/class-names.ts";
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
  // The toast island hides the toast by this id; it comes from React, never from data.
  const id = useId();
  return (
    <div
      className={classNames(styles.region, inline === true && styles.inline, className)}
      role={tone === "err" ? "alert" : "status"}
    >
      {children === undefined ? null : (
        <div className={styles.toast} id={id}>
          <Tag status={tone} />
          <span className={styles.text}>{children}</span>
          {closeHref === undefined ? null : (
            <IslandSlot name="toast" island={toast} props={{ href: closeHref, label: closeLabel, toast: id }} />
          )}
        </div>
      )}
    </div>
  );
}
