// Modal (P1.24k; sheet components/Modal/README.md, v45): level 4, a dialog on `ground` with a 1px `ink` border over
// the `scrim`. With no JS the trigger is a link to `fallbackHref`, a full page with the same content, and the native
// <dialog> stays closed, so it is neither shown nor read. The trigger is the modal island (P1.24j, ModalTrigger.tsx),
// which opens it with showModal(), bringing the focus trap, Escape and the backdrop from the platform, and returns
// focus to the trigger.
import { type ReactNode, useId } from "react";
import modal from "../../islands/modal.island.tsx";
import { IslandSlot } from "../../islands/slot.tsx";
import type { SafeHref } from "../../safe-href.ts";
import { classNames } from "../../src/class-names.ts";
import styles from "./Modal.module.css";

export type ModalProps = {
  /** The trigger's label. */
  trigger: string;
  /** The page with the same content, for when the dialog cannot open. */
  fallbackHref: SafeHref;
  /** The question, e.g. "Delete this draft?". */
  title: ReactNode;
  /** The consequence, in one or two sentences, or a small form. */
  children?: ReactNode;
  /** A standalone Link to cancel, then one Button that repeats the verb. */
  actions?: ReactNode;
  /** "danger" for irreversible actions: an alert dialog. */
  tone?: "default" | "danger";
  className?: string;
};

export function Modal({ trigger, fallbackHref, title, children, actions, tone = "default", className }: ModalProps) {
  const titleId = useId();
  const dialogId = useId();
  return (
    <>
      <IslandSlot name="modal" island={modal} props={{ label: trigger, href: fallbackHref, dialog: dialogId }} />
      <dialog
        id={dialogId}
        className={classNames(styles.root, className)}
        role={tone === "danger" ? "alertdialog" : undefined}
        aria-labelledby={titleId}
      >
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        {children === undefined ? null : <div className={styles.body}>{children}</div>}
        {actions === undefined ? null : <div className={styles.actions}>{actions}</div>}
      </dialog>
    </>
  );
}
