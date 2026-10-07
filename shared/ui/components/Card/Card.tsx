// Card (P1.24a; sheet components/Card/README.md, v45): level 2, on the opaque `surface-card` (sheet v40, approved by
// Alex 2026-10-04), so there is no solid variant. The action is a standalone Link, which ends in the `next` Icon.
import type { ReactNode } from "react";
import type { SafeHref } from "../../safe-href.ts";
import { classNames } from "../../src/class-names.ts";
import { Link } from "../Link/Link.tsx";
import styles from "./Card.module.css";

export type CardProps = {
  /** Small mono line above the title: an index ("01"), a path or a date. */
  eyebrow?: ReactNode;
  title?: ReactNode;
  /** One or two sentences in `ink-muted`. */
  children?: ReactNode;
  action?: { label: string; href: SafeHref };
  className?: string;
};

export function Card({ eyebrow, title, children, action, className }: CardProps) {
  return (
    <div className={classNames(styles.root, className)}>
      {eyebrow === undefined ? null : <div className={styles.eyebrow}>{eyebrow}</div>}
      {title === undefined ? null : <h3 className={styles.title}>{title}</h3>}
      {children === undefined ? null : <div className={styles.body}>{children}</div>}
      {action === undefined ? null : (
        <div className={styles.action}>
          <Link href={action.href} variant="standalone">
            {action.label}
          </Link>
        </div>
      )}
    </div>
  );
}
