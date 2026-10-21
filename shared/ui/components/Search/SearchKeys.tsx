// The search island's keys (P1.24u; sheet components/Search/README.md). It prints a hidden submit button aimed at the
// web search page, and once mounted: `/` anywhere outside a text field focuses the bar (unless `shortcut` is false),
// and Ctrl+Enter or ⌘+Enter in the bar submits the form through that button, so the same `q` goes to `web` with the
// form's own validation. A plain Enter is left to the form. The form is reached by an id from React's useId.
import { useEffect, useRef } from "react";
import { type SafeHref, safeHref } from "../../safe-href.ts";

export type SearchKeysProps = {
  /** The id of the Search form. */
  form: string;
  /** The web search page, a same-origin path. */
  web: SafeHref;
  /** Whether `/` focuses the bar. */
  shortcut: boolean;
};

export const isSearchKeysProps = (value: unknown): value is SearchKeysProps => {
  const props = value as Partial<SearchKeysProps> | null;
  return (
    typeof props?.form === "string" &&
    typeof props.web === "string" &&
    safeHref(props.web, ["path"]) !== null &&
    typeof props.shortcut === "boolean"
  );
};

/** Whether keys typed with focus on `target` are text, so `/` belongs to it. */
const typing = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit", "reset"].includes(target.type)));

export function SearchKeys({ form, web, shortcut }: SearchKeysProps) {
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const element = document.getElementById(form);
    const field = element instanceof HTMLFormElement ? element.elements.namedItem("q") : null;
    if (!(element instanceof HTMLFormElement) || !(field instanceof HTMLInputElement)) return;
    const onPage = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey || typing(event.target)) return;
      event.preventDefault();
      field.focus();
    };
    const onField = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey) || button.current === null) return;
      event.preventDefault();
      element.requestSubmit(button.current);
    };
    if (shortcut) document.addEventListener("keydown", onPage);
    field.addEventListener("keydown", onField);
    return () => {
      document.removeEventListener("keydown", onPage);
      field.removeEventListener("keydown", onField);
    };
  }, [form, shortcut]);

  return (
    <button ref={button} type="submit" formAction={web} hidden tabIndex={-1}>
      search the web
    </button>
  );
}
