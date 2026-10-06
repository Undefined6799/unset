// Textarea (P1.24; sheet components/Textarea/README.md, v45): styled exactly like Input; four rows by default,
// at least 96px tall, resizing vertically only (base.css).
import { type TextareaHTMLAttributes, useId } from "react";
import { classNames } from "../../src/class-names.ts";
import { Field, type FieldMessages, fieldIds } from "../Input/field.tsx";
import inputStyles from "../Input/Input.module.css";

type NativeTextarea = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "className" | "aria-describedby" | "aria-invalid" | "children"
>;

export type TextareaProps = NativeTextarea & FieldMessages & { label: string; className?: string };

export function Textarea({ label, hint, error, id, rows = 4, className, ...native }: TextareaProps) {
  const generated = useId();
  const ids = fieldIds(id ?? generated, label, { hint, error });
  return (
    <Field ids={ids} label={label} className={classNames(inputStyles.field, className)} hint={hint} error={error}>
      <textarea {...native} {...ids.aria} id={ids.control} rows={rows} className={inputStyles.control} />
    </Field>
  );
}
