// Input (P1.24; sheet components/Input/README.md, v45): a single-line field, 40px, with the label above and the
// hint or "[err] …" below. Server-rendered with no JS: it posts with its form.
import { type InputHTMLAttributes, useId } from "react";
import { classNames } from "../../src/class-names.ts";
import { Field, type FieldMessages, fieldIds } from "./field.tsx";
import styles from "./Input.module.css";

type NativeInput = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "className" | "type" | "aria-describedby" | "aria-invalid" | "children"
>;

export type InputProps = NativeInput &
  FieldMessages & {
    /** Shown above the field; a placeholder is an example value, never the label. */
    label: string;
    /** Text kinds only; Checkbox and RadioGroup draw the others. */
    type?: "text" | "email" | "url" | "search" | "password" | "tel" | "number";
    className?: string;
  };

export function Input({ label, hint, error, id, type = "text", className, ...native }: InputProps) {
  const generated = useId();
  const ids = fieldIds(id ?? generated, label, { hint, error });
  return (
    <Field ids={ids} label={label} className={classNames(styles.field, className)} hint={hint} error={error}>
      <input {...native} {...ids.aria} id={ids.control} type={type} className={styles.control} />
    </Field>
  );
}
