// The owner's README, editable in place (Alex 2026-10-23 23:09Z: on your profile, a double-click or the pencil starts
// editing). The server draws the README as it reads, inside a plain form that posts to POST /profile/readme; the
// editor chunk (apps/web src/editor/readme-form.tsx) shows the pencil, swaps the README for the editor on a pencil
// click or a double-click, and on Save writes the editor's document into the hidden textarea. With no script the
// pencil and the Save stay hidden, so the page reads like a visitor's.
import type { ReactNode } from "react";
import edit from "../../icons/drawings/edit.generated.ts";
import { Button } from "../Button/Button.tsx";
import { IconDrawing } from "../Icon/Icon.tsx";
import styles from "./Profile.module.css";

export type ReadmeFormLabels = {
  readonly edit: string;
  /** The editor's accessible name. */
  readonly label: string;
  readonly save: string;
  readonly cancel: string;
  readonly discard: string;
  readonly unsaved: string;
};

export type ReadmeFormProps = {
  /** The stored README as the editor's document (domains/profile toEditorDocument), as JSON. */
  readonly document: string;
  readonly labels: ReadmeFormLabels;
  /** What the owner sees where an empty README would be. */
  readonly placeholder: string;
  /** The README as it reads; null when there is none. */
  readonly children: ReactNode;
};

export function ReadmeForm({ document, labels, placeholder, children }: ReadmeFormProps) {
  return (
    <form method="post" action="/profile/readme" data-readme-editor data-readme-discard={labels.discard}>
      <textarea name="readme" hidden readOnly aria-label={labels.label} defaultValue={document} data-readme-document />
      <div className={styles.readmeActions} hidden data-readme-actions>
        <Button type="submit">{labels.save}</Button>
        <Button type="button" variant="standalone" name="cancel">
          {labels.cancel}
        </Button>
        <p className={styles.readmeStatus} role="status" hidden data-readme-unsaved>
          {labels.unsaved}
        </p>
      </div>
      <div className={styles.editableBlock}>
        <div data-readme-editor-mount>{children ?? <p className={styles.placeholder}>{placeholder}</p>}</div>
        <button
          type="button"
          className={`${styles.pencil} ${styles.readmePencil}`}
          aria-label={labels.edit}
          title={labels.edit}
          hidden
          data-readme-edit
        >
          <IconDrawing paths={edit} size={16} />
        </button>
      </div>
    </form>
  );
}
