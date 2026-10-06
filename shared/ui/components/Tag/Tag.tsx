// Tag (P1.24; sheet components/Tag/README.md, v45): a status word in square brackets, in `mono` at the size around
// it. The brackets always print, so the state never rests on colour alone.
import type { ReactNode } from "react";
import { classNames } from "../../src/class-names.ts";
import styles from "./Tag.module.css";

export type TagProps = {
  /** ok: `success`. err: `danger`. info: `link`. plain: `ink-muted` (default). */
  status?: "ok" | "err" | "info" | "plain";
  /** The word inside the brackets; defaults to the status name. */
  children?: ReactNode;
  className?: string;
};

export function Tag({ status = "plain", children, className }: TagProps) {
  return <span className={classNames(styles.root, styles[status], className)}>[{children ?? status}]</span>;
}
