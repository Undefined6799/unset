// Callout (P1.24a; sheet components/Callout/README.md, v45): a notice on `surface-raised` led by one text glyph in a
// 24px dashed box, both in the tone's colour, with a bold title and one muted sentence. `danger` is announced as an
// alert; the other tones are notes.
import type { ReactNode } from "react";
import { classNames } from "../../src/class-names.ts";
import styles from "./Callout.module.css";

const GLYPH = { info: "i", danger: "!", success: "+", note: "*" } as const;

export type CalloutProps = {
  /** info (default, `i`, `link`), danger (`!`), success (`+`) or note (`*`, `ink-muted`). */
  tone?: keyof typeof GLYPH;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
};

export function Callout({ tone = "info", title, children, className }: CalloutProps) {
  return (
    <div className={classNames(styles.root, styles[tone], className)} role={tone === "danger" ? "alert" : "note"}>
      <span className={styles.glyph} aria-hidden="true">
        {GLYPH[tone]}
      </span>
      <div className={styles.body}>
        {title === undefined ? null : <div className={styles.title}>{title}</div>}
        {children === undefined ? null : <div className={styles.text}>{children}</div>}
      </div>
    </div>
  );
}
