// Button (P1.24; sheet components/Button/README.md, v45): one style, the solid `ink` shape with its bottom-right
// corner cut. A link that looks like a button takes a `SafeHref`; a refused link (`null`) renders a disabled button
// with no `href` at all, so an unsafe link never reaches the page.
import type { ReactNode } from "react";
import type { SafeHref } from "../../safe-href.ts";
import { classNames } from "../../src/class-names.ts";
import { Icon } from "../Icon/Icon.tsx";
import styles from "./Button.module.css";

type ButtonCommon = {
  /** The label, one to three words in sentence case; the style uppercases it. */
  children: ReactNode;
  /** Ends the label in the 16px `next` icon, where the sheet shows it (sheet v34), never a typed arrow. */
  next?: boolean;
  disabled?: boolean;
  className?: string;
};

export type ButtonProps = ButtonCommon &
  (
    | { as?: "button"; type?: "button" | "submit" | "reset"; name?: string; value?: string; form?: string }
    | { as: "a"; href: SafeHref | null }
  );

export function Button(props: ButtonProps) {
  const className = classNames(styles.root, props.className);
  const label = (
    <>
      {props.children}
      {props.next === true ? <Icon name="next" size={16} /> : null}
    </>
  );
  if (props.as === "a") {
    if (props.href === null || props.disabled === true) {
      // A refused or disabled link has nowhere to go, so it is a disabled button: announced as unavailable, never
      // focusable, and carrying no href.
      return (
        <button className={className} type="button" disabled>
          {label}
        </button>
      );
    }
    return (
      <a className={className} href={props.href}>
        {label}
      </a>
    );
  }
  return (
    <button
      className={className}
      type={props.type ?? "button"}
      name={props.name}
      value={props.value}
      form={props.form}
      disabled={props.disabled}
    >
      {label}
    </button>
  );
}
