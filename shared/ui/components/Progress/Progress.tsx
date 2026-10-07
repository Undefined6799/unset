// Progress (P1.24a; sheet components/Progress/README.md, v45): a bar drawn as text, `[#####-----] 50%`, which is
// hidden from screen readers; a real <progress> underneath carries the value (the sheet: "keep real inputs
// underneath") and takes its name from the label, since both sit in one <label>.
import { classNames } from "../../src/class-names.ts";
import styles from "./Progress.module.css";

export type ProgressProps = {
  /** 0 to `max`; values outside are clamped. */
  value: number;
  /** Default 100. */
  max?: number;
  /** Bar width in characters; default 20. */
  width?: number;
  /** What is in progress, in `ink-muted`; it names the bar for screen readers. */
  label: string;
  className?: string;
};

export function Progress({ value, max = 100, width = 20, label, className }: ProgressProps) {
  const clamped = Math.max(0, Math.min(max, value));
  const done = Math.round((clamped / max) * width);
  return (
    <label className={classNames(styles.root, className)}>
      <span aria-hidden="true">
        <span className={styles.rule}>[</span>
        <span className={styles.done}>{"#".repeat(done)}</span>
        <span className={styles.rule}>{"-".repeat(width - done)}]</span> {Math.round((clamped / max) * 100)}%
      </span>{" "}
      <span className={styles.label}>{label}</span>
      <progress className="visually-hidden" value={clamped} max={max} />
    </label>
  );
}
