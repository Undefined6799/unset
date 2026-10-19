// The footer's preference form (P1.25f; phase-1.md P1.22 "PrefsForms() for app pages"): native radios and a submit
// button that POST to /prefs/theme with no script, so the kit's CSRF and Origin gate decides it like any form. Only
// app pages show it: the theme follows the system on public pages, so a choice there would change nothing.
// The language form is P1.22b's. `returnTo` already passed safeReturnPath on the server; the route checks it again.
import { Button, RadioGroup } from "@unset/shared-ui";
import { PREFS } from "./messages.ts";

export type ThemeChoice = "dark" | "light" | "system";

export type PrefsFormsProps = Readonly<{ theme: ThemeChoice; returnTo: string }>;

const THEMES = [
  { value: "dark", label: PREFS.dark },
  { value: "light", label: PREFS.light },
  { value: "system", label: PREFS.system },
] as const;

export function PrefsForms({ theme, returnTo }: PrefsFormsProps) {
  return (
    <form method="post" action="/prefs/theme">
      <RadioGroup label={PREFS.theme} name="theme" options={THEMES} defaultValue={theme} />
      <input type="hidden" name="return" value={returnTo} />
      <Button type="submit">{PREFS.save}</Button>
    </form>
  );
}
