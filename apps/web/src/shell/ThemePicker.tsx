// The menu drawer's theme picker (P2.13e; Figma 151:939, option A, Alex 2026-10-23): three icon buttons in one outlined
// group, the chosen one boxed. Each is a submit button of one plain form that POSTs to /prefs/theme, so it works with
// no script and the kit's CSRF gate decides it like PrefsForms. `returnTo` already passed safeReturnPath on the server.
import { Icon, type IconName } from "@unset/shared-ui";
import styles from "../screens/CoreShell.module.css";
import { PREFS } from "./messages.ts";
import type { PrefsFormsProps } from "./PrefsForms.tsx";

const CHOICES: readonly { value: PrefsFormsProps["theme"]; label: string; icon: IconName }[] = [
  { value: "dark", label: PREFS.dark, icon: "bulb-off" },
  { value: "system", label: PREFS.system, icon: "tv" },
  { value: "light", label: PREFS.light, icon: "bulb-on" },
];

export function ThemePicker({ theme, returnTo }: PrefsFormsProps) {
  return (
    <form method="post" action="/prefs/theme">
      <input type="hidden" name="return" value={returnTo} />
      <fieldset className={styles.themes}>
        <legend className="visually-hidden">{PREFS.theme}</legend>
        {CHOICES.map((choice) => (
          <button
            key={choice.value}
            className={styles.theme}
            type="submit"
            name="theme"
            value={choice.value}
            aria-label={choice.label}
            aria-pressed={choice.value === theme}
            title={choice.label}
          >
            <Icon name={choice.icon} size={20} label={choice.label} />
          </button>
        ))}
      </fieldset>
    </form>
  );
}
