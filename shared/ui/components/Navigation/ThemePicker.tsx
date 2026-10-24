// The menu drawer's theme picker (P2.13e; Figma 151:939, option A, Alex 2026-10-23): three icon buttons in one outlined
// group, the chosen one pressed and boxed. It is a plain form whose buttons POST the choice, so it works with no script
// and the kit's CSRF gate decides it like any form. Once its island runs, a choice is POSTed in the background and
// applied to <html> in place, so the drawer it sits in stays open (Alex, 2026-10-23 02:15Z); if that save fails, the
// plain form is submitted instead. The drawings are the three generated modules, so the island bundles no other icon.
// Background POST: fetch with `redirect: "manual"` resolves the route's 303 as an opaque-redirect response
// (https://fetch.spec.whatwg.org/#concept-request-redirect-mode, read 2026-10-23); the Set-Cookie on that 303 is
// stored by the browser's HTTP-network fetch either way (same spec, "HTTP-network fetch"). No test here runs a real
// browser against it yet, so that cookie step is unverified until staging or an e2e test with a session shows it.
import { type FormEvent, useEffect, useRef, useState } from "react";
import bulbOff from "../../icons/drawings/bulb-off.generated.ts";
import bulbOn from "../../icons/drawings/bulb-on.generated.ts";
import tv from "../../icons/drawings/tv.generated.ts";
import { IconDrawing, type IconPaths } from "../Icon/Icon.tsx";
import styles from "./Navigation.module.css";

export type ThemeChoice = "dark" | "system" | "light";

/** The one route a choice is saved to (interfaces/http/routes/prefs.ts), a literal so no caller can redirect it. */
const ACTION = "/prefs/theme";

export type ThemePickerProps = {
  theme: ThemeChoice;
  /** The page to come back to, already checked by the server; the route checks it again. */
  returnTo: string;
  labels: { group: string; dark: string; system: string; light: string };
};

const CHOICES: readonly { value: ThemeChoice; paths: IconPaths }[] = [
  { value: "dark", paths: bulbOff },
  { value: "system", paths: tv },
  { value: "light", paths: bulbOn },
];
const isChoice = (value: unknown): value is ThemeChoice => CHOICES.some((choice) => choice.value === value);

export const isThemePickerProps = (value: unknown): value is ThemePickerProps => {
  const props = value as Partial<ThemePickerProps> | null;
  const labels = props?.labels as Partial<ThemePickerProps["labels"]> | undefined;
  return (
    props !== null &&
    isChoice(props.theme) &&
    typeof props.returnTo === "string" &&
    ["group", "dark", "system", "light"].every((key) => typeof labels?.[key as keyof typeof labels] === "string")
  );
};

/** What the server renders for a choice (interfaces/http/prefs/theme.ts): data-theme and the color-scheme meta. */
function apply(theme: ThemeChoice): void {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
  document
    .querySelector('meta[name="color-scheme"]')
    ?.setAttribute("content", theme === "system" ? "dark light" : theme);
}

/** This tab's last saved choice, for pages the back-forward cache restores; the theme cookie is HttpOnly. */
const SAVED = "unset.theme";
function remember(theme: ThemeChoice): void {
  try {
    sessionStorage.setItem(SAVED, theme);
  } catch {
    // Storage can be off; the cookie still holds the choice for every page the server renders.
  }
}
function remembered(): ThemeChoice | null {
  try {
    const value = sessionStorage.getItem(SAVED);
    return isChoice(value) ? value : null;
  } catch {
    return null;
  }
}

export function ThemePicker({ theme, returnTo, labels }: ThemePickerProps) {
  const [current, setCurrent] = useState(theme);
  // Saves run one after another, so two quick choices cannot finish out of order: the last click wins.
  const saving = useRef(Promise.resolve());
  // Back can restore an earlier page as it was left (https://web.dev/articles/bfcache, read 2026-10-23), theme too.
  // A fresh page's theme comes from the cookie, so it replaces whatever this tab stored before.
  useEffect(() => {
    remember(theme);
    const restore = (event: PageTransitionEvent) => {
      const saved = event.persisted ? remembered() : null;
      if (saved === null) return;
      apply(saved);
      setCurrent(saved);
    };
    window.addEventListener("pageshow", restore);
    return () => window.removeEventListener("pageshow", restore);
  }, [theme]);
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    const form = event.currentTarget;
    const choice = ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value;
    if (!isChoice(choice)) return;
    event.preventDefault();
    saving.current = saving.current.then(() => save(form, choice));
  };
  const save = async (form: HTMLFormElement, choice: ThemeChoice) => {
    try {
      const response = await fetch("/prefs/theme", {
        method: "POST",
        body: new URLSearchParams({ theme: choice, return: returnTo }),
        credentials: "same-origin",
        redirect: "manual",
        // The save outlives this page if a drawer link is followed at once (Fetch Standard, keepalive flag,
        // https://fetch.spec.whatwg.org/, Living Standard 19 October 2026).
        keepalive: true,
      });
      if (response.type !== "opaqueredirect" && !response.ok) throw new Error(`theme save: ${response.status}`);
    } catch {
      // The plain form carries the choice in a hidden field, since submit() sends no submitter.
      const field = Object.assign(document.createElement("input"), { type: "hidden", name: "theme", value: choice });
      form.append(field);
      form.submit();
      return;
    }
    apply(choice);
    remember(choice);
    setCurrent(choice);
  };
  return (
    <form method="post" action={ACTION} onSubmit={onSubmit}>
      <input type="hidden" name="return" value={returnTo} />
      <fieldset className={styles.themes}>
        <legend className="visually-hidden">{labels.group}</legend>
        {CHOICES.map((choice) => (
          <button
            key={choice.value}
            className={styles.theme}
            type="submit"
            name="theme"
            value={choice.value}
            aria-pressed={choice.value === current}
            title={labels[choice.value]}
          >
            <IconDrawing paths={choice.paths} size={20} label={labels[choice.value]} />
          </button>
        ))}
      </fieldset>
    </form>
  );
}
