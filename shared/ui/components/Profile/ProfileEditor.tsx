// The owner's profile editing (Alex 2026-10-23; Figma 4hrOlzQ1d0lA8Acm4KyLVf, page Profile, v4 frames 177:1147.. and
// v5 frames 179:1173..). The page is the editor: hovering a field shows a pencil (always shown on touch screens), and
// the pencil or a double-click edits the field in place. What is typed goes on a draft at once, with no Save in the
// field (Alex 03:58Z); Enter, Ctrl/⌘+Enter in the README, or leaving the field closes it, and Esc puts it back. Once
// there is a draft, a draft box above the profile offers revert, undo and redo (Ctrl/⌘+Z, Ctrl/⌘+Shift+Z or Ctrl+Y),
// view as a visitor, and Save, which posts the plain form to POST /profile; the server writes the record to the member's PDS. Before hydration, and with no script, this renders
// exactly the server page: no pencils and no draft box. It is an island (islands/profile-editor.island.tsx).
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import add from "../../icons/drawings/add.generated.ts";
import close from "../../icons/drawings/close.generated.ts";
import del from "../../icons/drawings/delete.generated.ts";
import edit from "../../icons/drawings/edit.generated.ts";
import show from "../../icons/drawings/show.generated.ts";
import { classNames } from "../../src/class-names.ts";
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
  LinkItem,
  type ProfileFieldName,
  type ProfileFieldsView,
  type ProfileLabels,
  ProfileView,
  strings,
} from "./ProfileView.tsx";

export type ProfileEditorProps = {
  did: string;
  handle: string;
  verified: boolean;
  handleUnavailable: boolean;
  fields: ProfileFieldsView;
  labels: ProfileLabels;
};

export const isProfileEditorProps = (value: unknown): value is ProfileEditorProps =>
  isRecord(value) &&
  typeof value.did === "string" &&
  typeof value.handle === "string" &&
  typeof value.verified === "boolean" &&
  typeof value.handleUnavailable === "boolean" &&
  strings(value.fields, FIELDS) &&
  isLabels(value.labels);

/** The lexicon's links bound (shared/lexicons LIMITS.profile.linksMax); the server checks it again. */
const LINKS_MAX = 12;

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
  className?: string | undefined;
}) {
  return (
    <button
      type="button"
      className={
        props.standalone
          ? classNames(linkStyles.standalone, buttonStyles.standalone)
          : classNames(buttonStyles.root, props.className)
      }
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

/** Copies the profile's address; the button says Copied, or Copy failed when the clipboard is missing or refused. */
function CopyLink({ did, labels }: { did: string; labels: ProfileLabels }) {
  const [state, setState] = useState<"copy" | "copied" | "failed">("copy");
  useEffect(() => {
    if (state === "copy") return;
    const timer = setTimeout(() => setState("copy"), 1400);
    return () => clearTimeout(timer);
  }, [state]);
  const copy = () => {
    // The Clipboard API is missing outside a secure context; that fails like a refusal.
    const link = new URL(`/${did}`, window.location.origin).href;
    (navigator.clipboard?.writeText(link) ?? Promise.reject()).then(
      () => setState("copied"),
      () => setState("failed"),
    );
  };
  const text = { copy: labels.copyLink, copied: labels.copied, failed: labels.copyFailed }[state];
  return (
    <ActionButton className={styles.copy} onClick={copy}>
      {text}
    </ActionButton>
  );
}

function FieldEditor(props: {
  name: ProfileFieldName;
  value: string;
  labels: ProfileLabels;
  onInput: (value: string) => void;
  onClose: () => void;
  onRestore: () => void;
}) {
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), []);
  // Enter or Esc unmounts the field, and a browser may then report it blurred: only the first way out counts.
  const left = useRef(false);
  const leave = (how: () => void) => {
    if (left.current) return;
    left.current = true;
    how();
  };
  const multiline = props.name === "readme";
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      leave(props.onRestore);
    } else if (event.key === "Enter" && (multiline ? event.ctrlKey || event.metaKey : !event.shiftKey)) {
      event.preventDefault();
      leave(props.onClose);
    }
  };
  const shared = {
    ref,
    "aria-label": props.labels.edit.replace("{field}", props.labels.fields[props.name]),
    value: props.value,
    onKeyDown,
    onBlur: () => leave(props.onClose),
  };
  return (
    <span className={multiline ? styles.editorBlock : styles.editor}>
      {multiline ? (
        <textarea
          {...shared}
          className={styles.textarea}
          rows={14}
          onChange={(event) => props.onInput(event.target.value)}
        />
      ) : (
        <input
          {...shared}
          className={styles.input}
          type={props.name === "website" ? "url" : "text"}
          onChange={(event) => props.onInput(event.target.value)}
        />
      )}
    </span>
  );
}

/** What a member typed as a link, as the URL the server accepts: "github.com/you" gains https://; null when unusable. */
export function linkFrom(typed: string): string | null {
  const text = typed.trim();
  if (text === "") return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  if (!/^https?:\/\//i.test(withScheme)) return null;
  try {
    const url = new URL(withScheme);
    return url.hostname.includes(".") && url.username === "" && url.password === "" ? withScheme : null;
  } catch {
    return null;
  }
}

/** The owner's links: each with a remove button, and "+" to add one (Alex 04:06Z). Every change is a draft step. */
function LinksEditor(props: { links: string; labels: ProfileLabels; onChange: (links: string) => void }) {
  const { labels } = props;
  const links = props.links === "" ? [] : props.links.split("\n");
  const [adding, setAdding] = useState(false);
  const [typed, setTyped] = useState("");
  const [invalid, setInvalid] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (adding) ref.current?.focus();
  }, [adding]);
  const stop = () => {
    setAdding(false);
    setTyped("");
    setInvalid(false);
  };
  const addTyped = () => {
    if (typed.trim() === "") return stop();
    const link = linkFrom(typed);
    if (link === null) return setInvalid(true);
    if (!links.includes(link)) props.onChange([...links, link].join("\n"));
    stop();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      stop();
    } else if (event.key === "Enter") {
      event.preventDefault();
      addTyped();
    }
  };
  return (
    <div className={styles.linksEditor}>
      {links.length === 0 ? null : (
        <ul className={styles.links}>
          {links.map((link) => (
            <li key={link}>
              <LinkItem uri={link} />
              <button
                type="button"
                className={styles.tool}
                aria-label={labels.removeLink.replace("{link}", link)}
                title={labels.removeLink.replace("{link}", link)}
                onClick={() => props.onChange(links.filter((other) => other !== link).join("\n"))}
              >
                <IconDrawing paths={close} size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <span className={styles.editor}>
          <input
            ref={ref}
            className={styles.input}
            type="url"
            aria-label={labels.add.links}
            aria-invalid={invalid}
            placeholder="github.com/you"
            value={typed}
            onChange={(event) => {
              setTyped(event.target.value);
              setInvalid(false);
            }}
            onKeyDown={onKeyDown}
            onBlur={addTyped}
          />
          {invalid ? <span role="alert">{labels.invalidLink}</span> : null}
        </span>
      ) : links.length < LINKS_MAX ? (
        <button
          type="button"
          className={styles.tool}
          aria-label={labels.add.links}
          title={labels.add.links}
          onClick={() => setAdding(true)}
        >
          <IconDrawing paths={add} size={20} />
        </button>
      ) : null}
    </div>
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

export function ProfileEditor({ did, handle, verified, handleUnavailable, fields, labels }: ProfileEditorProps) {
  const [ready, setReady] = useState(false);
  const [published, setPublished] = useState(fields);
  const [history, setHistory] = useState<History>({ list: [fields], at: 0 });
  // The open field and the history step it opened on: what is typed replaces the one step after it, so a field edit
  // is one undo step however many keys it took, and Esc goes back to it.
  const [editing, setEditing] = useState<{ readonly name: ProfileFieldName; readonly from: number } | null>(null);
  const [viewAs, setViewAs] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const current = history.list[history.at] ?? fields;
  const dirty = !same(current, published);

  useEffect(() => setReady(true), []);
  useHistoryKeys(ready && editing === null, setHistory);

  const open = (name: ProfileFieldName) => setEditing({ name, from: history.at });

  /** Puts `value` on the draft as the one step after `from`; no step when the field is back where it started. */
  const write = (name: ProfileFieldName, from: number, value: string) => {
    setStatus({ kind: "idle" });
    setHistory((h) => {
      const kept = h.list.slice(0, from + 1);
      const base = kept[from] ?? fields;
      return value === base[name]
        ? { list: kept, at: from }
        : { list: [...kept, { ...base, [name]: value }], at: from + 1 };
    });
  };

  const close = () => {
    if (editing === null) return;
    const { name, from } = editing;
    setEditing(null);
    if (name !== "readme") write(name, from, current[name].trim());
  };

  const restore = () => {
    if (editing === null) return;
    setEditing(null);
    setHistory((h) => ({ list: h.list.slice(0, editing.from + 1), at: editing.from }));
  };

  const revert = () => {
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
    if (name === "links") {
      return (
        <LinksEditor links={current.links} labels={labels} onChange={(links) => write("links", history.at, links)} />
      );
    }
    if (editing?.name === name) {
      const { from } = editing;
      return (
        <FieldEditor
          name={name}
          value={current[name]}
          labels={labels}
          onInput={(value) => write(name, from, value)}
          onClose={close}
          onRestore={restore}
        />
      );
    }
    const label = labels.edit.replace("{field}", labels.fields[name]);
    return (
      // biome-ignore lint/a11y/noStaticElementInteractions: double-click is a mouse shortcut; the pencil button beside it is the keyboard and screen-reader way in.
      <span className={name === "readme" ? styles.editableBlock : styles.editable} onDoubleClick={() => open(name)}>
        {content ?? <span className={styles.placeholder}>{labels.add[name]}</span>}
        <button type="button" className={styles.pencil} aria-label={label} title={label} onClick={() => open(name)}>
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
        did={did}
        handle={handle}
        verified={verified}
        handleUnavailable={handleUnavailable}
        fields={current}
        labels={labels}
        field={field}
        copyLink={ready ? <CopyLink did={did} labels={labels} /> : null}
      />
    </>
  );
}
