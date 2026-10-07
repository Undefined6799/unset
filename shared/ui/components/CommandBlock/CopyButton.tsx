// CommandBlock's copy control (P1.24j; sheet components/CommandBlock/README.md and bundle.js.txt `useCopy`, v45),
// rendered by the copy island. The server and the first browser render print only an empty polite live region, so
// with no JS there is no button; once mounted the button appears. It reads COPY, then COPIED for 1.4s, or FAILED
// for 2.4s when the clipboard is missing or refused, and then the command is selected for a manual copy.
import { useEffect, useState } from "react";
import { classNames } from "../../src/class-names.ts";
import styles from "./CommandBlock.module.css";

export type CopyButtonProps = {
  /** The exact text to copy. */
  text: string;
  /** The id of the element holding the command, selected when copying fails. */
  target: string;
};

type State = "copy" | "copied" | "failed";

const SAY: Record<State, string> = {
  copy: "",
  copied: "Copied",
  failed: "Copy failed; the command is selected, press Ctrl+C or Cmd+C",
};

export const isCopyButtonProps = (value: unknown): value is CopyButtonProps =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as CopyButtonProps).text === "string" &&
  typeof (value as CopyButtonProps).target === "string";

function selectContents(id: string): void {
  const node = document.getElementById(id);
  if (node !== null) getSelection()?.selectAllChildren(node);
}

export function CopyButton({ text, target }: CopyButtonProps) {
  const [mounted, setMounted] = useState(false);
  const [state, setState] = useState<State>("copy");
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (state === "copy") return;
    const timer = setTimeout(() => setState("copy"), state === "copied" ? 1400 : 2400);
    return () => clearTimeout(timer);
  }, [state]);

  const copy = () => {
    // The Clipboard API is missing outside a secure context; that fails like a refusal.
    (navigator.clipboard?.writeText(text) ?? Promise.reject()).then(
      () => setState("copied"),
      () => {
        selectContents(target);
        setState("failed");
      },
    );
  };

  return (
    <>
      {mounted ? (
        <button type="button" className={classNames(styles.copy, state !== "copy" && styles[state])} onClick={copy}>
          {state}
        </button>
      ) : null}
      <span className="visually-hidden" aria-live="polite">
        {SAY[state]}
      </span>
    </>
  );
}
