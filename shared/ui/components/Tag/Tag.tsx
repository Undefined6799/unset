// Tag (P1.24; sheet components/Tag/README.md, quiet brackets approved 2026-10-21): a status word in square brackets,
// "[ ERR ]", in `mono` a touch smaller than the text around it. The brackets and the word always print, so the state
// never rests on colour alone.
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
  return (
    <span className={classNames(styles.root, styles[status], className)}>
      <span className={styles.bracket}>{"[ "}</span>
      <span className={styles.word}>{children ?? status}</span>
      <span className={styles.bracket}>{" ]"}</span>
    </span>
  );
}
