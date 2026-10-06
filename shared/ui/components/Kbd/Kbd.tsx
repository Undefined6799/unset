// Kbd (P1.24; sheet components/Kbd/README.md, v45): one keyboard key in a 24px box.
import type { ReactNode } from "react";
import { classNames } from "../../src/class-names.ts";
import styles from "./Kbd.module.css";

export type KbdProps = {
  /** One key: "K", "⌘", "⇧", "⏎", "Esc". */
  children: ReactNode;
  className?: string;
};

export function Kbd({ children, className }: KbdProps) {
  return <kbd className={classNames(styles.root, className)}>{children}</kbd>;
}
