// Switch (P1.24s; sheet components/Switch/README.md, v45; approved by Alex 2026-10-03 18:16Z): an on/off setting
// drawn as text, `[──◉] on` in `success` or `[○──] off` in `ink-muted`, label on the left. A real checkbox with
// role="switch" sits underneath; the drawing follows it through CSS, so it works and posts with no JS.
import { type ReactNode, useId } from "react";
import { classNames } from "../../src/class-names.ts";
import styles from "./Switch.module.css";

export type SwitchProps = {
  label: ReactNode;
  name?: string;
  value?: string;
  defaultChecked?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
};

export function Switch(props: SwitchProps) {
  const generated = useId();
  return (
    <label className={classNames(styles.root, props.className)} htmlFor={props.id ?? generated}>
      <span>{props.label}</span>
      <input
        id={props.id ?? generated}
        className={styles.input}
        type="checkbox"
        // ARIA in HTML (w3.org/TR/html-aria, input type=checkbox) allows role=switch and says authors MUST NOT set
        // aria-checked: the native checked state is the switch's state.
        // biome-ignore lint/a11y/useAriaPropsForRole: the checked state is the input's own
        role="switch"
        name={props.name}
        value={props.value}
        defaultChecked={props.defaultChecked}
        disabled={props.disabled}
      />
      <span className={styles.track} aria-hidden="true">
        <span className={styles.on}>[──◉] on</span>
        <span className={styles.off}>[○──] off</span>
      </span>
    </label>
  );
}
