// Checkbox (P1.24; sheet components/Checkbox/README.md, v45): a real checkbox drawn as text, `[x]` in `success` or
// `[ ]` in `ink-muted` (base.css draws the brackets on the input itself, so the focus outline goes around them),
// then the label. Server-rendered with no JS: `defaultChecked` sets its first state and it posts with its form.
import { type ReactNode, useId } from "react";
import { classNames } from "../../src/class-names.ts";
import { FieldMessageLines, type FieldMessages, fieldIds } from "../Input/field.tsx";
import styles from "./Checkbox.module.css";

export type CheckboxProps = FieldMessages & {
  /** Lowercase and short, phrased as the thing that turns on. */
  label: ReactNode;
  name?: string;
  value?: string;
  defaultChecked?: boolean;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  className?: string;
};

export function Checkbox(props: CheckboxProps) {
  const { label, hint, error } = props;
  const generated = useId();
  const ids = fieldIds(props.id ?? generated, label, { hint, error });
  return (
    <div className={classNames(styles.root, props.className)}>
      <label className={styles.row}>
        <input
          {...ids.aria}
          id={ids.control}
          type="checkbox"
          name={props.name}
          value={props.value}
          defaultChecked={props.defaultChecked}
          disabled={props.disabled}
          required={props.required}
        />
        <span>{label}</span>
      </label>
      <FieldMessageLines ids={ids} hint={hint} error={error} />
    </div>
  );
}
