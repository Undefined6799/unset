// AsciiBackground (P1.24a; sheet components/AsciiBackground/README.md, v45): the brand's static ASCII wave, computed
// on the server by the sheet's own formula from a seed the caller passes (never Math.random, so every render of a
// seed is the same), hidden from screen readers and never animated. Zero JS. A text seed is hashed to an integer
// first, so the text never reaches the DOM.
import type { ReactNode } from "react";
import { classNames } from "../../src/class-names.ts";
import styles from "./AsciiBackground.module.css";

const RAMP = " .:-=+*#%@";

export type AsciiBackgroundProps = {
  /** The content on top, usually Cards. */
  children?: ReactNode;
  /** 0 to 1, default 0.6. */
  density?: number;
  /** false keeps the field grey; default true. */
  accents?: boolean;
  /** Varies the pattern; text is hashed first. */
  seed?: number | string;
  /** Default 160 × 32. */
  cols?: number;
  rows?: number;
  /** "left" keeps the left side clear for a title. */
  fadeFrom?: "left";
  className?: string;
};

type Field = Required<Pick<AsciiBackgroundProps, "density" | "accents" | "cols" | "rows">> & {
  seed: number;
  fade: boolean;
};

/** FNV-1a (32-bit) of the text, reduced to 0..999 so the sine arguments stay small. */
function hashSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (const char of text) hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 0x01000193);
  return (hash >>> 0) % 1000;
}

/** The sheet's colour band for a ramp index at row `y`: sparse in `line`, mid in `line-strong`, dense in accents. */
function band(index: number, y: number, field: Field): string | undefined {
  if (index <= 2) return styles.sparse;
  if (index <= 5 || !field.accents) return styles.mid;
  if (y < field.rows / 3) return styles.plum;
  return y < (field.rows * 2) / 3 ? styles.cyan : styles.emerald;
}

/** One row of the field as runs of characters sharing a band. */
function row(y: number, field: Field): ReactNode[] {
  const { cols, rows, density, seed } = field;
  const runs: { band: string | undefined; text: string }[] = [];
  for (let x = 0; x < cols; x++) {
    const wave =
      (Math.sin(x * 0.16 + seed + Math.sin(y * 0.33 + seed) * 2.2) +
        Math.sin(y * 0.45 - x * 0.06) +
        Math.cos(Math.hypot(x - cols * 0.55, (y - rows / 2) * 2.1) * 0.22)) /
      3;
    let value = ((wave + 1) / 2) * (0.4 + density);
    if (field.fade) value *= Math.min(1, x / (cols * 0.45));
    const index = Math.max(0, Math.min(9, Math.floor(value * 10)));
    const cls = band(index, y, field);
    const last = runs.at(-1);
    if (last !== undefined && last.band === cls) last.text += RAMP[index];
    else runs.push({ band: cls, text: RAMP[index] ?? " " });
  }
  return runs.map((run, i) => (
    // Runs are computed in order from fixed inputs, so the position is a stable key.
    // biome-ignore lint/suspicious/noArrayIndexKey: static runs
    <span key={i} className={run.band}>
      {run.text}
    </span>
  ));
}

export function AsciiBackground(props: AsciiBackgroundProps) {
  const field: Field = {
    density: props.density ?? 0.6,
    accents: props.accents ?? true,
    cols: props.cols ?? 160,
    rows: props.rows ?? 32,
    seed: typeof props.seed === "string" ? hashSeed(props.seed) : (props.seed ?? 0),
    fade: props.fadeFrom === "left",
  };
  return (
    <div className={classNames(styles.root, props.className)}>
      <pre className={styles.field} aria-hidden="true">
        {Array.from({ length: field.rows }, (_, y) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: one row per y, fixed
          <div key={y}>{row(y, field)}</div>
        ))}
      </pre>
      {props.children === undefined ? null : <div className={styles.content}>{props.children}</div>}
    </div>
  );
}
