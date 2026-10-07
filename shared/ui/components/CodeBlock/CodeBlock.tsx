// CodeBlock (P1.24a; sheet components/CodeBlock/README.md, v45): multi-line code on `surface-raised` under a bar with
// the file name, coloured by the sheet's own light rules (no highlighting library): comments `ink-muted`, `[section]`
// headers `plum`, strings `cyan`, numbers and true/false/null `emerald`. The copy control is an island (P1.24j), so
// without JS the bar has no button and the code stays selectable.
import { Fragment, type ReactNode } from "react";
import { classNames } from "../../src/class-names.ts";
import styles from "./CodeBlock.module.css";

export type CodeBlockProps = {
  code: string;
  /** Shown in the bar, e.g. `~/.unset/config.toml`. */
  filename?: string;
  /** "plain" turns colour off. */
  language?: string;
  className?: string;
};

/** The sheet's token pattern: a quoted string, or a keyword or number. */
const TOKEN = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\b(?:true|false|null|nil|yes|no)\b|\b-?\d+(?:\.\d+)?\b)/g;

function colour(line: string): ReactNode {
  const text = line.trimStart();
  if (/^(#|\/\/|;)/.test(text)) return <span className={styles.comment}>{line}</span>;
  if (/^\[[^\]]+\]\s*$/.test(text)) return <span className={styles.section}>{line}</span>;
  const out: ReactNode[] = [];
  let last = 0;
  for (const match of line.matchAll(TOKEN)) {
    if (match.index > last) out.push(line.slice(last, match.index));
    out.push(
      <span key={match.index} className={match[1] === undefined ? styles.number : styles.string}>
        {match[0]}
      </span>,
    );
    last = match.index + match[0].length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

export function CodeBlock({ code, filename, language, className }: CodeBlockProps) {
  const lines = code.replace(/\n$/, "").split("\n");
  return (
    <div className={classNames(styles.root, className)}>
      <div className={styles.bar}>{filename ?? language ?? ""}</div>
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: code scrolls sideways, so the keyboard must reach it */}
      <pre className={styles.pre} tabIndex={0}>
        <code>
          {lines.map((line, index) => (
            // One entry per line of a fixed string, never reordered, so the position is a stable key.
            // biome-ignore lint/suspicious/noArrayIndexKey: static lines
            <Fragment key={index}>
              {language === "plain" ? line : colour(line)}
              {index < lines.length - 1 ? "\n" : null}
            </Fragment>
          ))}
        </code>
      </pre>
    </div>
  );
}
