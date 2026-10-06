// Mark (P1.24; sheet components/Mark/README.md, v45): the three fisheyes at the source file's exact geometry, filled
// with currentColor. MARK_PATH is the sheet bundle's MARK_D; Mark.test.tsx reads the copied bundle as text and fails
// if the two differ, so a change on the sheet is a stop-and-report, not an edit here.
import { classNames } from "../../src/class-names.ts";
import styles from "./Mark.module.css";

export const MARK_PATH =
  "M126 540a110 110 0 1 0 220 0a110 110 0 1 0 -220 0ZM152 540a84 84 0 1 0 168 0a84 84 0 1 0 -168 0ZM182 540a54 54 0 1 0 108 0a54 54 0 1 0 -108 0ZM430 540a110 110 0 1 0 220 0a110 110 0 1 0 -220 0ZM456 540a84 84 0 1 0 168 0a84 84 0 1 0 -168 0ZM486 540a54 54 0 1 0 108 0a54 54 0 1 0 -108 0ZM734 540a110 110 0 1 0 220 0a110 110 0 1 0 -220 0ZM760 540a84 84 0 1 0 168 0a84 84 0 1 0 -168 0ZM790 540a54 54 0 1 0 108 0a54 54 0 1 0 -108 0Z";

export type MarkProps = {
  /** Width in px; the height follows the mark's 828:220 ratio. */
  width?: number;
  /** The accessible name. */
  title?: string;
  className?: string;
};

export function Mark({ width = 72, title = "unset.sh", className }: MarkProps) {
  return (
    <svg
      className={classNames(styles.root, className)}
      viewBox="126 430 828 220"
      width={width}
      height={Math.round((width * 220) / 828)}
      role="img"
      aria-label={title}
    >
      <path fill="currentColor" fillRule="evenodd" d={MARK_PATH} />
    </svg>
  );
}
