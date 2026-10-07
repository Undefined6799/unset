// The select island's listbox (P1.24b; sheet components/Select/README.md, v45; WAI-ARIA APG "Select-Only Combobox").
// The server and the first browser render print nothing, so with no JS the P1.24 native <select> stays and posts with
// its form. Once mounted, the island reads the options from that <select> (reached by an id from React's useId),
// hides it with the hidden attribute (out of view, the tab order and the accessibility tree, still posted), and draws
// the sheet's list: a combobox that opens a listbox, with typeahead, Home and End, opening upward when there is no
// room below. A pick writes the native element's value and fires its change event, so the form POST is unchanged.
// P1.24c: a required <select> stays native; the combobox is named by the visible label through aria-labelledby, and a
// click on that label focuses it.
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { classNames } from "../../src/class-names.ts";
import styles from "./Select.module.css";

export type SelectListboxProps = {
  /** The id of the native <select>. */
  select: string;
};

export const isSelectListboxProps = (value: unknown): value is SelectListboxProps =>
  typeof (value as Partial<SelectListboxProps> | null)?.select === "string";

/** The list's height cap in Select.module.css; below that much room, it opens upward. */
const LIST_MAX = 240;
/** Letters typed within this many milliseconds of each other make one search. */
const TYPEAHEAD_MS = 500;

type Native = { element: HTMLSelectElement; options: HTMLOptionElement[] };

/** The first option from `from` on, wrapping round, whose text starts with `query`; -1 when none does. */
function findMatch(options: readonly HTMLOptionElement[], from: number, query: string): number {
  for (let step = 0; step < options.length; step++) {
    const index = (from + step + options.length) % options.length;
    if (options[index]?.text.toLowerCase().startsWith(query)) return index;
  }
  return -1;
}

export function SelectListbox({ select }: SelectListboxProps) {
  const [native, setNative] = useState<Native | null>(null);
  const [chosen, setChosen] = useState(-1);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const list = useId();

  useEffect(() => {
    const element = document.getElementById(select);
    // A required select stays native: hidden, the browser could not focus it to show its message, and the form would
    // silently not submit (P1.24c record; how a required listbox shows its error is a sheet question).
    if (!(element instanceof HTMLSelectElement) || element.required) return;
    const options = [...element.options].filter((option) => !option.disabled);
    setNative({ element, options });
    setChosen(options.indexOf(element.options[element.selectedIndex] as HTMLOptionElement));
    element.hidden = true;
    // A click on the visible label would focus the hidden native control; it focuses the combobox instead.
    const focusBox = (event: Event) => {
      event.preventDefault();
      box.current?.focus();
    };
    const labels = [...(element.labels ?? [])];
    for (const label of labels) label.addEventListener("click", focusBox);
    return () => {
      for (const label of labels) label.removeEventListener("click", focusBox);
    };
  }, [select]);
  useEffect(() => {
    if (open) document.getElementById(`${list}-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [open, active, list]);

  if (native === null) return null;
  const { element, options } = native;
  const last = options.length - 1;

  const pick = (index: number) => {
    const option = options[index];
    setOpen(false);
    if (option === undefined || index === chosen) return;
    element.value = option.value;
    element.dispatchEvent(new Event("change", { bubbles: true }));
    setChosen(index);
  };
  const show = (index: number) => {
    const rect = box.current?.getBoundingClientRect();
    const below = rect === undefined ? LIST_MAX : innerHeight - rect.bottom;
    setUp(below < LIST_MAX && (rect?.top ?? 0) > below);
    setActive(Math.max(0, index));
    setOpen(true);
  };
  const move = (index: number) => (open ? setActive(index) : show(index));
  // Typing the same letter again cycles through the options that start with it; other letters extend the search.
  const search = (letter: string) => {
    const t = typed.current;
    const now = Date.now();
    t.text = now - t.at < TYPEAHEAD_MS ? t.text + letter : letter;
    t.at = now;
    const cycling = [...t.text].every((c) => c === t.text[0]);
    const query = (cycling ? letter : t.text).toLowerCase();
    const index = findMatch(options, (open ? active : chosen) + (cycling ? 1 : 0), query);
    if (index === -1) return;
    if (open) setActive(index);
    else pick(index);
  };

  const keys: Record<string, () => void> = {
    ArrowDown: () => move(open ? Math.min(active + 1, last) : chosen),
    ArrowUp: () => (open ? setActive(Math.max(active - 1, 0)) : show(chosen)),
    Home: () => move(0),
    End: () => move(last),
    Enter: () => (open ? pick(active) : show(chosen)),
    " ": () => (open ? pick(active) : show(chosen)),
    Escape: () => setOpen(false),
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (element.disabled) return;
    if (event.key === "Tab") return open ? pick(active) : undefined;
    if (event.altKey && event.key === "ArrowUp" && open) {
      event.preventDefault();
      return pick(active);
    }
    const key = keys[event.key];
    if (key !== undefined) {
      event.preventDefault();
      return key();
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) search(event.key);
  };

  return (
    <>
      <div
        ref={box}
        role="combobox"
        tabIndex={element.disabled ? -1 : 0}
        aria-labelledby={element.labels?.[0]?.id || undefined}
        aria-controls={list}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-activedescendant={open ? `${list}-${active}` : undefined}
        aria-disabled={element.disabled || undefined}
        aria-describedby={element.getAttribute("aria-describedby") ?? undefined}
        aria-invalid={element.getAttribute("aria-invalid") === "true" || undefined}
        className={styles.combobox}
        onKeyDown={onKeyDown}
        onClick={() => (element.disabled ? undefined : open ? setOpen(false) : show(chosen))}
        onBlur={() => setOpen(false)}
      >
        {element.options[element.selectedIndex]?.text}
        <span className={styles.caret} aria-hidden="true">
          {open ? "▴" : "▾"}
        </span>
      </div>
      <div role="listbox" id={list} hidden={!open} className={classNames(styles.list, up && styles.up)}>
        {options.map((option, index) => (
          // The options take no focus and no keys of their own: the combobox keeps the focus and points at the active
          // option with aria-activedescendant (APG Select-Only Combobox), so its key handler serves the list.
          // biome-ignore lint/a11y/useFocusableInteractive: focus stays on the combobox
          // biome-ignore lint/a11y/useKeyWithClickEvents: the combobox's keys drive the list
          <div
            key={option.value}
            id={`${list}-${index}`}
            role="option"
            aria-selected={index === chosen}
            className={classNames(styles.option, index === active && styles.active)}
            // Keeps the focus on the combobox, so its blur does not close the list before the click lands.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => pick(index)}
          >
            {option.text}
          </div>
        ))}
      </div>
    </>
  );
}
