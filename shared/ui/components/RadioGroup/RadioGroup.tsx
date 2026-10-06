// RadioGroup (P1.24; sheet components/RadioGroup/README.md, v45): a <fieldset> whose <legend> names the group, with
// real radios drawn as text, `(•)` in `success` and `( )` in `ink-muted` (base.css). Arrow keys move between them
// natively. Server-rendered with no JS; `name` is required so the radios form one group and post with the form.
import { type ReactNode, useId } from "react";
import { classNames } from "../../src/class-names.ts";
import { FieldMessageLines, type FieldMessages, fieldIds } from "../Input/field.tsx";
import styles from "./RadioGroup.module.css";

export type RadioOption = { value: string; label: ReactNode };

export type RadioGroupProps = FieldMessages & {
  /** The legend, uppercased by the style. */
  label: ReactNode;
  /** Two to five; more belong in a Select. */
  options: readonly RadioOption[];
  name: string;
  /** The option chosen at first; none is chosen without it. */
  defaultValue?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  className?: string;
};

export function RadioGroup(props: RadioGroupProps) {
  const { label, hint, error } = props;
  const generated = useId();
  const ids = fieldIds(props.id ?? generated, label, { hint, error });
  return (
    <fieldset
      {...ids.aria}
      id={ids.control}
      disabled={props.disabled}
      className={classNames(styles.root, props.className)}
    >
      <legend>{label}</legend>
      {props.options.map((option) => (
        <label key={option.value} className={styles.option}>
          <input
            type="radio"
            name={props.name}
            value={option.value}
            defaultChecked={option.value === props.defaultValue}
            required={props.required}
          />
          <span>{option.label}</span>
        </label>
      ))}
      <FieldMessageLines ids={ids} hint={hint} error={error} />
    </fieldset>
  );
}
