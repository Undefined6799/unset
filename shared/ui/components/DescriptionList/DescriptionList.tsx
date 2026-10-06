// DescriptionList (P1.24s; sheet components/DescriptionList/README.md, v45; approved by Alex 2026-10-04 22:00Z): a
// real <dl> of label and value pairs on `line` hairlines. Labels sit beside their values, and above them when the
// list is 440px wide or narrower (a container query); an empty value prints "—"; long values wrap anywhere.
import type { ReactNode } from "react";
import { classNames } from "../../src/class-names.ts";
import styles from "./DescriptionList.module.css";

export type DescriptionItem = {
  /** Unique within the list; it is also the row's key. */
  label: string;
  value: ReactNode;
  /** For DIDs, handles, hashes and dates a machine printed. */
  mono?: boolean;
};

export type DescriptionListProps = { items: readonly DescriptionItem[]; className?: string };

export function DescriptionList({ items, className }: DescriptionListProps) {
  return (
    <dl className={classNames(styles.root, className)}>
      {items.map(({ label, value, mono }) => (
        <div key={label} className={styles.row}>
          <dt className={styles.label}>{label}</dt>
          <dd className={classNames(styles.value, mono === true && styles.mono)}>
            {value === null || value === undefined || value === "" ? "—" : value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
