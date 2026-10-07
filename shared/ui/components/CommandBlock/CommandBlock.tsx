// CommandBlock (P1.24f; sheet components/CommandBlock/README.md, v45): one shell command in `code` on `surface-raised`,
// led by an `ink-muted` prompt that is never copied, with optional output 2px below, where `[ok]`, `[err]` and
// `[info]` at the start of a line become a Tag and `#` lines are muted. The copy control is the copy island (P1.24j),
// placed by IslandSlot: with no JS there is no button and the command stays selectable.
import { useId } from "react";
import copy from "../../islands/copy.island.tsx";
import { IslandSlot } from "../../islands/slot.ts";
import { Tag } from "../Tag/Tag.tsx";
import styles from "./CommandBlock.module.css";

export type CommandBlockProps = {
  /** The exact text to copy. */
  command: string;
  /** Lines of output. */
  output?: readonly string[];
  /** Replaces the `$`; null drops it. */
  prompt?: string | null;
  /** false hides the copy control. */
  copyable?: boolean;
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

export function CommandBlock({ command, output = [], prompt = "$", copyable = true, className }: CommandBlockProps) {
  // The copy island selects the command by this id when the clipboard refuses; it comes from React, never from data.
  const codeId = useId();
  return (
    <div className={className}>
      <div className={styles.line}>
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a long command scrolls sideways, so the keyboard must reach it */}
        <pre className={styles.command} tabIndex={0}>
          <code id={codeId}>
            {prompt === null ? null : (
              <span className={styles.prompt} aria-hidden="true">
                {`${prompt} `}
              </span>
            )}
            {command}
          </code>
        </pre>
        {copyable ? <IslandSlot name="copy" island={copy} props={{ text: command, target: codeId }} /> : null}
      </div>
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
