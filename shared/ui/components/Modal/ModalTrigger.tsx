// The modal island's trigger (P1.24j; sheet components/Modal/README.md, v45). The server and the first browser
// render print the P1.24k trigger: a link to the full page with the same content, styled as the kit's Button (written
// out, as the Header's action is, so the Icon drawings stay out of the island). Once JS runs, a click opens the
// <dialog> with showModal(), which brings the focus trap, Escape and the inert page from the platform (HTML Living
// Standard, the dialog element), and closing it puts focus back on the trigger. A browser with no <dialog> keeps
// following the link. The dialog is reached by an id from React's useId.
import { type MouseEvent, useEffect, useState } from "react";
import { type SafeHref, safeHref } from "../../safe-href.ts";
import buttonStyles from "../Button/Button.module.css";

export type ModalTriggerProps = {
  label: string;
  /** The page with the same content. */
  href: SafeHref;
  /** The id of the closed <dialog>. */
  dialog: string;
};

export const isModalTriggerProps = (value: unknown): value is ModalTriggerProps => {
  const props = value as Partial<ModalTriggerProps> | null;
  return (
    typeof props?.label === "string" &&
    typeof props.href === "string" &&
    safeHref(props.href, ["path"]) !== null &&
    typeof props.dialog === "string"
  );
};

export function ModalTrigger({ label, href, dialog }: ModalTriggerProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    const target = document.getElementById(dialog);
    if (!(mounted && typeof HTMLDialogElement === "function" && target instanceof HTMLDialogElement)) return;
    event.preventDefault();
    const trigger = event.currentTarget;
    target.addEventListener("close", () => trigger.focus(), { once: true });
    target.showModal();
  };
  return (
    <a className={buttonStyles.root} href={href} onClick={open}>
      {label}
    </a>
  );
}
