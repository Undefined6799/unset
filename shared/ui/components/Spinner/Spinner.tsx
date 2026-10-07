// Spinner (P1.24a; sheet components/Spinner/README.md, v45): the text spinner `| / - \`, one frame every 140ms, drawn
// by a CSS animation of `content` (no JS) and hidden from screen readers; the label beside it is the status text.
// Under reduced motion the animation stops on the first frame, a still `|`.
import { classNames } from "../../src/class-names.ts";
import styles from "./Spinner.module.css";

export type SpinnerProps = {
  /** What is happening, lowercase, ending in "…", from the catalog; it is what screen readers announce. */
  label: string;
  className?: string;
};

export function Spinner({ label, className }: SpinnerProps) {
  return (
    <span className={classNames(styles.root, className)}>
      <span className={styles.glyph} aria-hidden="true" />{" "}
      <span className={styles.label} role="status">
        {label}
      </span>
    </span>
  );
}
