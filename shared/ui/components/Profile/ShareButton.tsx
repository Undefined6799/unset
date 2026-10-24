// The profile's Share button (Alex 2026-10-24 00:12Z: under the handle, a share icon, then the contact means the
// member turns on), rendered by the share island. With no JS there is no button, since sharing needs script. It
// offers the page's own address: the system share sheet where the browser has one (navigator.share), otherwise the
// address goes to the clipboard and a polite live region says so.
import { useEffect, useState } from "react";
import share from "../../icons/drawings/share.generated.ts";
import { IconDrawing } from "../Icon/Icon.tsx";
import styles from "./Profile.module.css";

export type ShareButtonProps = {
  /** The button's accessible name. */
  label: string;
  copied: string;
  copyFailed: string;
};

export const isShareButtonProps = (value: unknown): value is ShareButtonProps =>
  typeof value === "object" &&
  value !== null &&
  ["label", "copied", "copyFailed"].every((key) => typeof (value as Record<string, unknown>)[key] === "string");

type State = "idle" | "copied" | "failed";

export function ShareButton({ label, copied, copyFailed }: ShareButtonProps) {
  const [mounted, setMounted] = useState(false);
  const [state, setState] = useState<State>("idle");
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), 2400);
    return () => clearTimeout(timer);
  }, [state]);

  const onShare = () => {
    const url = location.href;
    if (typeof navigator.share === "function") {
      // A dismissed share sheet rejects with AbortError; nothing went wrong, so nothing is said.
      navigator.share({ title: document.title, url }).catch(() => undefined);
      return;
    }
    // The Clipboard API is missing outside a secure context; that fails like a refusal.
    (navigator.clipboard?.writeText(url) ?? Promise.reject()).then(
      () => setState("copied"),
      () => setState("failed"),
    );
  };

  return (
    <>
      {mounted ? (
        <button type="button" className={styles.contact} aria-label={label} title={label} onClick={onShare}>
          <IconDrawing paths={share} size={16} />
        </button>
      ) : null}
      <span className="visually-hidden" aria-live="polite">
        {state === "copied" ? copied : state === "failed" ? copyFailed : ""}
      </span>
    </>
  );
}
