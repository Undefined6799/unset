// Table (P1.24a; sheet components/Table/README.md, v45): a real <table> with a required <caption> and `scope` on its
// headers; uppercase mono headers over a `line-strong` rule, `line` hairlines between rows, no fills. It scrolls
// sideways on phones inside a focusable <section> named by the caption (a region), so the keyboard can scroll it too.
import { type ReactNode, useId } from "react";
import { classNames } from "../../src/class-names.ts";
import styles from "./Table.module.css";

export type TableColumn = {
  key: string;
  label: string;
  /** Right-align numbers. */
  align?: "left" | "right";
  /** Cells are mono unless false. */
  mono?: boolean;
  muted?: boolean;
};

export type TableProps = {
  columns: readonly TableColumn[];
  /** Objects keyed by column; an empty value prints —. */
  rows: readonly Readonly<Record<string, ReactNode>>[];
  caption: ReactNode;
  className?: string;
};

const cellClass = (column: TableColumn) =>
  classNames(
    column.mono === false ? undefined : styles.mono,
    column.muted === true && styles.muted,
    column.align === "right" && styles.right,
  );

export function Table({ columns, rows, caption, className }: TableProps) {
  const captionId = useId();
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region must take focus to scroll by keyboard
    <section className={classNames(styles.wrap, className)} aria-labelledby={captionId} tabIndex={0}>
      <table className={styles.table}>
        <caption id={captionId} className={styles.caption}>
          {caption}
        </caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" className={column.align === "right" ? styles.right : undefined}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            // Rows are rendered once on the server and never reordered, so the position is a stable key.
            // biome-ignore lint/suspicious/noArrayIndexKey: static rows
            <tr key={index}>
              {columns.map((column) => {
                const value = row[column.key];
                return (
                  <td key={column.key} className={cellClass(column) || undefined}>
                    {value === undefined || value === null || value === "" ? "—" : value}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
