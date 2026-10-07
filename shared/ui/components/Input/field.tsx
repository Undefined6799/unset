// The parts every field shares (P1.24; book P1.24 Outputs): a required visible label, an optional hint and error
// under the control, and the ids that wire them. The control lists the hint's and the error's ids in
// aria-describedby and is aria-invalid while an error shows (WAI-ARIA 1.2, aria-describedby and aria-invalid).
import type { ReactNode } from "react";
import { Tag } from "../Tag/Tag.tsx";
import styles from "./Input.module.css";

export type FieldMessages = {
  /** Helper text under the control. */
  hint?: string | undefined;
  /** Error text, already resolved from the catalog; written lowercase without a full stop. */
  error?: string | undefined;
};

export type FieldIds = {
  control: string;
  /** The visible label's id, for a control drawn by an island that names itself with aria-labelledby (P1.24c). */
  label: string;
  hint: string | undefined;
  error: string | undefined;
  /** Spread onto the control (or the group, for radios). */
  aria: { "aria-describedby"?: string; "aria-invalid"?: true };
};

/** The ids for a field with this base id; refuses a field without a visible label (the sheet: "always give a label"). */
export function fieldIds(control: string, label: ReactNode, { hint, error }: FieldMessages): FieldIds {
  if (label === undefined || label === null || label === "" || label === false) {
    throw new Error("a field needs a visible label");
  }
  const hintId = hint === undefined ? undefined : `${control}-hint`;
  const errorId = error === undefined ? undefined : `${control}-error`;
  const describedBy = [hintId, errorId].filter((id) => id !== undefined).join(" ");
  return {
    control,
    label: `${control}-label`,
    hint: hintId,
    error: errorId,
    aria: {
      ...(describedBy === "" ? {} : { "aria-describedby": describedBy }),
      ...(error === undefined ? {} : { "aria-invalid": true }),
    },
  };
}

/** The hint, then the error as "[err] <error>", each under its id. */
export function FieldMessageLines({ ids, hint, error }: FieldMessages & { ids: FieldIds }) {
  return (
    <>
      {hint === undefined ? null : (
        <p id={ids.hint} className={styles.hint}>
          {hint}
        </p>
      )}
      {error === undefined ? null : (
        <p id={ids.error} className={styles.error}>
          <Tag status="err" /> {error}
        </p>
      )}
    </>
  );
}

/** A labelled control with its messages: Input, Textarea and Select. */
export function Field({
  ids,
  label,
  hint,
  error,
  className,
  children,
}: FieldMessages & { ids: FieldIds; label: string; className: string; children: ReactNode }) {
  return (
    <div className={className}>
      <label id={ids.label} className={styles.label} htmlFor={ids.control}>
        {label}
      </label>
      {children}
      <FieldMessageLines ids={ids} hint={hint} error={error} />
    </div>
  );
}
