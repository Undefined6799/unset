// CommandBlock (P1.24f; sheet components/CommandBlock/README.md, v45): one shell command in `code` on `surface-raised`,
// led by an `ink-muted` prompt that is never copied, with optional output 2px below, where `[ok]`, `[err]` and
// `[info]` at the start of a line become a Tag and `#` lines are muted. The copy control is the copy island (P1.24j),
// so with no JS there is no button and the command stays selectable.
import { Tag } from "../Tag/Tag.tsx";
import styles from "./CommandBlock.module.css";

export type CommandBlockProps = {
  /** The exact text to copy. */
  command: string;
  /** Lines of output. */
  output?: readonly string[];
  /** Replaces the `$`; null drops it. */
  prompt?: string | null;
  className?: string;
};

function OutputLine({ line }: { line: string }) {
  const tagged = /^\[(ok|err|info)\]\s?(.*)$/.exec(line);
  if (tagged !== null)
    return (
      <div>
        <Tag status={tagged[1] as "ok" | "err" | "info"} /> {tagged[2]}
      </div>
    );
  return <div className={line.startsWith("#") ? styles.comment : undefined}>{line}</div>;
}

export function CommandBlock({ command, output = [], prompt = "$", className }: CommandBlockProps) {
  return (
    <div className={className}>
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a long command scrolls sideways, so the keyboard must reach it */}
      <pre className={styles.line} tabIndex={0}>
        <code>
          {prompt === null ? null : (
            <span className={styles.prompt} aria-hidden="true">
              {`${prompt} `}
            </span>
          )}
          {command}
        </code>
      </pre>
      {output.length === 0 ? null : (
        <pre className={styles.output}>
          {output.map((line, index) => (
            // One entry per output line, fixed and never reordered.
            // biome-ignore lint/suspicious/noArrayIndexKey: static lines
            <OutputLine key={index} line={line} />
          ))}
        </pre>
      )}
    </div>
  );
}
