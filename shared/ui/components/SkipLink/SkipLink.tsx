// SkipLink (P1.24s; sheet components/SkipLink/README.md, v45; approved by Alex 2026-10-03 18:21Z): the first
// focusable element on every page, off-screen until focused. Its target is a fragment on the same page, so its href
// needs no `SafeHref`: the type admits only "#…".
import type { ReactNode } from "react";
import { classNames } from "../../src/class-names.ts";
import styles from "./SkipLink.module.css";

export type SkipLinkProps = {
  /** The target; the shell's <main id="main"> by default. */
  href?: `#${string}`;
  children?: ReactNode;
  /** Shows it without focus, for the showcase. */
  shown?: boolean;
  className?: string;
};

export function SkipLink({ href = "#main", children = "Skip to content", shown = false, className }: SkipLinkProps) {
  return (
    <a className={classNames(styles.root, shown && styles.shown, className)} href={href}>
      {children}
    </a>
  );
}
