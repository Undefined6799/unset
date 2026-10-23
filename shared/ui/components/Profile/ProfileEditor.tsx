// The owner's profile editing (Alex 2026-10-23; Figma 4hrOlzQ1d0lA8Acm4KyLVf, page Profile, v4 frames 177:1147.. and
// v5 frames 179:1173..). The page is the editor: hovering a field shows a pencil (always shown on touch screens), and
// the pencil or a double-click edits the field in place, with Save and Cancel (Enter saves, Esc cancels, Ctrl/⌘+Enter
// in the README). Each change goes on a draft; once there is one, a draft box above the profile offers revert, undo
// and redo (Ctrl/⌘+Z, Ctrl/⌘+Shift+Z or Ctrl+Y), view as a visitor, and Save, which posts the plain form to
// POST /profile; the server writes the record to the member's PDS. Before hydration, and with no script, this renders
// exactly the server page: no pencils and no draft box. It is an island (islands/profile-editor.island.tsx).
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import del from "../../icons/drawings/delete.generated.ts";
import edit from "../../icons/drawings/edit.generated.ts";
import show from "../../icons/drawings/show.generated.ts";
import buttonStyles from "../Button/Button.module.css";
import { Callout } from "../Callout/Callout.tsx";
import { IconDrawing } from "../Icon/Icon.tsx";
import linkStyles from "../Link/Link.module.css";
import styles from "./Profile.module.css";
import {
  FIELDS,
  type FieldSlot,
  isLabels,
  isRecord,
  type ProfileFieldName,
  type ProfileFieldsView,
  type ProfileLabels,
  ProfileView,
  strings,
} from "./ProfileView.tsx";

export type ProfileEditorProps = {
  handle: string;
  handleUnavailable: boolean;
  fields: ProfileFieldsView;
  labels: ProfileLabels;
};

export const isProfileEditorProps = (value: unknown): value is ProfileEditorProps =>
  isRecord(value) &&
  typeof value.handle === "string" &&
  typeof value.handleUnavailable === "boolean" &&
  strings(value.fields, FIELDS) &&
  isLabels(value.labels);

type History = { readonly list: readonly ProfileFieldsView[]; readonly at: number };
type Status =
  | { readonly kind: "idle" }
  | { readonly kind: "saving" }
  | { readonly kind: "saved" }
  | { readonly kind: "failed"; readonly text: string };

const same = (a: ProfileFieldsView, b: ProfileFieldsView) => FIELDS.every((field) => a[field] === b[field]);
const undoOf = (h: History): History => (h.at > 0 ? { ...h, at: h.at - 1 } : h);
const redoOf = (h: History): History => (h.at < h.list.length - 1 ? { ...h, at: h.at + 1 } : h);

/**
 * The kit Button's markup and classes, drawn here so the island bundles no icon map: Button imports Icon, which reads
 * every drawing (scripts/ui/styles-entry.test.ts island_bundle_has_no_icon_map).
 */
function ActionButton(props: {
  children: string;
  onClick: () => void;
  standalone?: boolean;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      className={props.standalone ? `${linkStyles.standalone} ${buttonStyles.standalone}` : buttonStyles.root}
      onClick={props.onClick}
      disabled={props.disabled}
      aria-busy={props.busy}
    >
      {props.standalone ? null : <span className={buttonStyles.fill} aria-hidden="true" />}
      {props.children}
    </button>
  );
}

function failure(status: number, failed: ProfileLabels["failed"]): string {
  if (status === 409) return failed.conflict;
  if (status === 400) return failed.invalid;
  if (status === 503) return failed.unavailable;
  return failed.other;
}

function FieldEditor(props: {
  name: ProfileFieldName;
  initial: string;
  labels: ProfileLabels;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const { labels } = props;
  const [value, setValue] = useState(props.initial);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const multiline = props.name === "readme";
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      props.onCancel();
    } else if (event.key === "Enter" && (multiline ? event.ctrlKey || event.metaKey : !event.shiftKey)) {
      event.preventDefault();
      props.onCommit(value);
    }
  };
  const label = labels.edit.replace("{field}", labels.fields[props.name]);
  return (
    <span className={multiline ? styles.editorBlock : styles.editor}>
      {multiline ? (
        <textarea
          ref={ref}
          className={styles.textarea}
          aria-label={label}
          value={value}
          rows={14}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
        />
      ) : (
        <input
          ref={ref}
          className={styles.input}
          aria-label={label}
          type={props.name === "website" ? "url" : "text"}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
        />
      )}
      <span className={styles.editorActions}>
        <ActionButton onClick={() => props.onCommit(value)}>{labels.done}</ActionButton>
        <ActionButton standalone onClick={props.onCancel}>
          {labels.cancel}
        </ActionButton>
      </span>
    </span>
  );
}

function DraftBox(props: {
  labels: ProfileLabels;
  status: Status;
  history: History;
  viewAs: boolean;
  onRevert: () => void;
  onHistory: (step: (h: History) => History) => void;
  onViewAs: () => void;
  onSave: () => void;
}) {
  const { labels, status, history } = props;
  const saving = status.kind === "saving";
  return (
    <section className={styles.draft} aria-label={labels.draft}>
      <Callout tone="note" title={labels.draft}>
        <p className={styles.draftBody}>{status.kind === "failed" ? status.text : labels.draftBody}</p>
        <div className={styles.draftActions}>
          <button
            type="button"
            className={styles.tool}
            aria-label={labels.revert}
            title={labels.revert}
            onClick={props.onRevert}
          >
            <IconDrawing paths={del} size={20} />
          </button>
          <button
            type="button"
            className={styles.tool}
            data-tip={`${labels.undo} (${labels.undoKeys})`}
            disabled={history.at === 0}
            onClick={() => props.onHistory(undoOf)}
          >
            {labels.undo}
          </button>
          <button
            type="button"
            className={styles.tool}
            data-tip={`${labels.redo} (${labels.redoKeys})`}
            disabled={history.at === history.list.length - 1}
            onClick={() => props.onHistory(redoOf)}
          >
            {labels.redo}
          </button>
          <button
            type="button"
            className={styles.tool}
            aria-label={labels.viewAs}
            title={labels.viewAs}
            aria-pressed={props.viewAs}
            onClick={props.onViewAs}
          >
            <IconDrawing paths={show} size={20} />
          </button>
          <span className={styles.grow} />
          <ActionButton onClick={props.onSave} disabled={saving} busy={saving}>
            {saving ? labels.saving : labels.publish}
          </ActionButton>
        </div>
      </Callout>
    </section>
  );
}

/** Undo and redo from the keyboard while no field is open. */
function useHistoryKeys(active: boolean, onHistory: (step: (h: History) => History) => void) {
  useEffect(() => {
    if (!active) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) onHistory(undoOf);
      else if ((key === "z" && event.shiftKey) || key === "y") onHistory(redoOf);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onHistory]);
}

/** Posts the profile to its one route; null when saved, else the message to show. A redirect elsewhere is followed. */
async function post(sent: ProfileFieldsView, failed: ProfileLabels["failed"]): Promise<string | null | "left"> {
  try {
    // The one route a profile is saved to (interfaces/http/routes/profile.ts), a literal so no prop can redirect it.
    const response = await fetch("/profile", {
      method: "POST",
      body: new URLSearchParams(sent),
      credentials: "same-origin",
    });
    // A dead grant is answered with a redirect to the sign-in pages; follow it there.
    if (response.redirected && new URL(response.url).pathname !== window.location.pathname) {
      window.location.assign(response.url);
      return "left";
    }
    return response.ok ? null : failure(response.status, failed);
  } catch {
    return failed.other;
  }
}

export function ProfileEditor({ handle, handleUnavailable, fields, labels }: ProfileEditorProps) {
  const [ready, setReady] = useState(false);
  const [published, setPublished] = useState(fields);
  const [history, setHistory] = useState<History>({ list: [fields], at: 0 });
  const [editing, setEditing] = useState<ProfileFieldName | null>(null);
  const [viewAs, setViewAs] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const current = history.list[history.at] ?? fields;
  const dirty = !same(current, published);

  useEffect(() => setReady(true), []);
  useHistoryKeys(ready && editing === null, setHistory);

  const commit = (name: ProfileFieldName, raw: string) => {
    const value = name === "readme" ? raw : raw.trim();
    setEditing(null);
    if (value === current[name]) return;
    setStatus({ kind: "idle" });
    setHistory((h) => ({ list: [...h.list.slice(0, h.at + 1), { ...current, [name]: value }], at: h.at + 1 }));
  };

  const revert = () => {
    setEditing(null);
    setHistory({ list: [published], at: 0 });
    setStatus({ kind: "idle" });
  };

  const save = async () => {
    setStatus({ kind: "saving" });
    // The name is required by the lexicon; an owner who never set one publishes the handle the page already shows.
    const sent = { ...current, displayName: current.displayName === "" ? handle : current.displayName };
    const failed = await post(sent, labels.failed);
    if (failed === "left") return;
    if (failed !== null) {
      setStatus({ kind: "failed", text: failed });
      return;
    }
    setPublished(sent);
    setHistory({ list: [sent], at: 0 });
    setStatus({ kind: "saved" });
  };

  const field: FieldSlot = (name, content) => {
    if (!ready || viewAs) return content;
    if (editing === name) {
      return (
        <FieldEditor
          name={name}
          initial={current[name]}
          labels={labels}
          onCommit={(value) => commit(name, value)}
          onCancel={() => setEditing(null)}
        />
      );
    }
    const label = labels.edit.replace("{field}", labels.fields[name]);
    return (
      // biome-ignore lint/a11y/noStaticElementInteractions: double-click is a mouse shortcut; the pencil button beside it is the keyboard and screen-reader way in.
      <span
        className={name === "readme" ? styles.editableBlock : styles.editable}
        onDoubleClick={() => setEditing(name)}
      >
        {content ?? <span className={styles.placeholder}>{labels.add[name]}</span>}
        <button
          type="button"
          className={styles.pencil}
          aria-label={label}
          title={label}
          onClick={() => setEditing(name)}
        >
          <IconDrawing paths={edit} size={16} />
        </button>
      </span>
    );
  };

  const showDraft = ready && (dirty || status.kind === "failed" || status.kind === "saving");
  return (
    <>
      {showDraft ? (
        <DraftBox
          labels={labels}
          status={status}
          history={history}
          viewAs={viewAs}
          onRevert={revert}
          onHistory={setHistory}
          onViewAs={() => setViewAs((on) => !on)}
          onSave={save}
        />
      ) : null}
      {status.kind === "saved" && !dirty ? (
        <p role="status" className={styles.saved}>
          {labels.saved}
        </p>
      ) : null}
      <ProfileView
        handle={handle}
        handleUnavailable={handleUnavailable}
        fields={current}
        labels={labels}
        field={field}
      />
    </>
  );
}
