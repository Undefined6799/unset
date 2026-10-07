// The toast island's close control (P1.24b; sheet components/Toast/README.md, v45). The server and the first browser
// render print P1.24f's close link back to the same page without the toast. Once JS runs, a click hides the toast in
// place and puts that same address in the history entry with replaceState, so a reload still shows no toast; it never
// hides on a timer. The toast is reached by an id from React's useId, and the close drawing is the one generated
// module, so the island never bundles the other icons (architecture record 2026-10-07-p124b-island-icons.md).
import type { MouseEvent } from "react";
import close from "../../icons/drawings/close.generated.ts";
import { type SafeHref, safeHref } from "../../safe-href.ts";
import { IconDrawing } from "../Icon/Icon.tsx";
import styles from "./Toast.module.css";

export type ToastCloseProps = {
  /** The same page without the toast. */
  href: SafeHref;
  /** The hidden label. */
  label: string;
  /** The id of the toast. */
  toast: string;
};

export const isToastCloseProps = (value: unknown): value is ToastCloseProps => {
  const props = value as Partial<ToastCloseProps> | null;
  return (
    typeof props?.label === "string" &&
    typeof props.href === "string" &&
    safeHref(props.href, ["path"]) !== null &&
    typeof props.toast === "string"
  );
};

export function ToastClose({ href, label, toast }: ToastCloseProps) {
  const dismiss = (event: MouseEvent<HTMLAnchorElement>) => {
    const target = document.getElementById(toast);
    if (target === null) return;
    event.preventDefault();
    target.hidden = true;
    history.replaceState(history.state, "", href);
  };
  return (
    <a className={styles.close} href={href} onClick={dismiss}>
      <IconDrawing paths={close} size={16} label={label} />
    </a>
  );
}
