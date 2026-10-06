// SectionHeading (P1.24; sheet components/SectionHeading/README.md, v45): the optional two-digit index in `mono`
// `ink-muted` with an em dash, then the title as an <h2>, over a 1px `line` rule.
import type { ReactNode } from "react";
import { classNames } from "../../src/class-names.ts";
import styles from "./SectionHeading.module.css";

export type SectionHeadingProps = {
  title: ReactNode;
  /** A two-digit string, "01"; the component adds " —". */
  index?: string;
  className?: string;
};

export function SectionHeading({ title, index, className }: SectionHeadingProps) {
  return (
    <div className={classNames(styles.root, className)}>
      {index === undefined ? null : <span className={styles.index}>{index} —</span>}
      <h2 className={styles.title}>{title}</h2>
    </div>
  );
}
