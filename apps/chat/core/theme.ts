// unset.sh's light / dark / device switch, carried to the chat so it is one setting everywhere (Alex 2026-11-23:
// "that switch that we built for light, dark, or device should be affecting everything"). unset.sh keeps it in its own
// HttpOnly cookie (interfaces/web lib/server/theme.ts), which this origin cannot read, so it comes here two ways: the
// box hears it from the shell (core/dock.ts `theme`), and the chat page reads it from the sign-in hop's fragment
// (interfaces/web chat-sign-in.ts) and keeps it in this origin's storage for its next loads. It is applied as unset.sh
// applies it (interfaces/web +layout.svelte applyTheme): data-theme on <html>, which shared/ui/theme.css and app.css's
// dark variant read, and the color-scheme meta.
export type Theme = "dark" | "light" | "system";

const SAVED = "unset.theme";

export const parseTheme = (value: unknown): Theme | null =>
  value === "dark" || value === "light" || value === "system" ? value : null;

/** The choice the hop's fragment names once, else null. */
export function themeFromFragment(hash: string): Theme | null {
  const values = new URLSearchParams(hash.replace(/^#/, "")).getAll("theme");
  return values.length === 1 ? parseTheme(values[0]) : null;
}

type Page = {
  readonly documentElement: Pick<Element, "setAttribute" | "removeAttribute">;
  readonly querySelector: (selector: string) => Pick<Element, "setAttribute"> | null;
};

export function applyTheme(page: Page, theme: Theme): void {
  if (theme === "system") page.documentElement.removeAttribute("data-theme");
  else page.documentElement.setAttribute("data-theme", theme);
  page.querySelector('meta[name="color-scheme"]')?.setAttribute("content", theme === "system" ? "dark light" : theme);
}

/** This origin's last known choice; storage can be off, which reads as the device setting. */
export function savedTheme(storage: Pick<Storage, "getItem">): Theme {
  try {
    return parseTheme(storage.getItem(SAVED)) ?? "system";
  } catch {
    return "system";
  }
}

export function saveTheme(storage: Pick<Storage, "setItem">, theme: Theme): void {
  try {
    storage.setItem(SAVED, theme);
  } catch {
    // Storage can be off: the choice then lasts this page only.
  }
}
