// Select (P1.24; sheet components/Select/README.md, v45): the native <select>, styled like Input with a ▾ caret.
// It works with no JS and posts with its form; the sheet's listbox, drawn by the kit, is an island in P1.24a that
// takes over from this one when it loads.
import { useId } from "react";
import { classNames } from "../../src/class-names.ts";
import { Field, type FieldMessages, fieldIds } from "../Input/field.tsx";
import inputStyles from "../Input/Input.module.css";
import styles from "./Select.module.css";

export type SelectOption = { value: string; label: string };

export type SelectProps = FieldMessages & {
  label: string;
  options: readonly SelectOption[];
  name?: string;
  defaultValue?: string;
  /** Shown, and not choosable, until an option is picked. */
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  className?: string;
};

export function Select(props: SelectProps) {
  const { label, hint, error, options, placeholder } = props;
  const generated = useId();
  const ids = fieldIds(props.id ?? generated, label, { hint, error });
  const initial = props.defaultValue ?? (placeholder === undefined ? undefined : "");
  return (
    <Field ids={ids} label={label} className={classNames(inputStyles.field, props.className)} hint={hint} error={error}>
      <span className={styles.wrap}>
        <select
          {...ids.aria}
          id={ids.control}
          name={props.name}
          defaultValue={initial}
          disabled={props.disabled}
          required={props.required}
          className={classNames(inputStyles.control, styles.control)}
        >
          {placeholder === undefined ? null : (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span className={styles.caret} aria-hidden="true">
          ▾
        </span>
      </span>
    </Field>
  );
}
