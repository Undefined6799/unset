// Opens the owner's README editor in place on their profile page (ADR 0037 point 5; Alex 2026-10-23 23:09Z). The page
// renders the README inside a plain form that posts to POST /profile/readme (shared/ui Profile/ReadmeForm.tsx):
//   <form data-readme-editor> holding <textarea name="readme" data-readme-document> (the document as BlockNote JSON,
//   which the server wrote from the stored README), <div data-readme-editor-mount> (the README as it reads), the
//   hidden pencil <button data-readme-edit>, and the hidden Save and Cancel in <div data-readme-actions>.
// The editor mounts in that div and, on submit, its document is written back into the textarea. The server reads it
// as untrusted input (domains/profile parseReadme).
import { createRoot, type Root } from "react-dom/client";
import { BlockEditor } from "./BlockEditor.tsx";
import type { ReadmeEditor, ReadmePartialBlock } from "./schema.ts";

/** The starting document: a JSON array of blocks, or an empty one for anything else. */
export function initialDocument(text: string): ReadmePartialBlock[] {
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? (parsed as ReadmePartialBlock[]) : [];
  } catch {
    return [];
  }
}

/** The form's parts the editor needs; null on a page without the README form. */
function formParts(page: Document) {
  const form = page.querySelector("form[data-readme-editor]");
  if (!(form instanceof HTMLFormElement)) return null;
  const field = form.querySelector("textarea[data-readme-document]");
  const mount = form.querySelector("[data-readme-editor-mount]");
  const pencil = form.querySelector("button[data-readme-edit]");
  const actions = form.querySelector("[data-readme-actions]");
  const cancel = form.querySelector('button[name="cancel"]');
  const status = form.querySelector("[data-readme-unsaved]");
  if (
    !(field instanceof HTMLTextAreaElement) ||
    !(mount instanceof HTMLElement) ||
    !(pencil instanceof HTMLButtonElement) ||
    !(actions instanceof HTMLElement) ||
    !(cancel instanceof HTMLButtonElement) ||
    !(status instanceof HTMLElement)
  ) {
    return null;
  }
  return { form, field, mount, pencil, actions, cancel, status };
}

/**
 * Makes the owner's README editable in place: the pencil or a double-click swaps the README for the editor, Cancel
 * puts the README back, and Save posts the editor's document. Does nothing on a page without the README form.
 */
export function startReadmeEditor(page: Document): void {
  const parts = formParts(page);
  if (parts === null) return;
  const { form, field, mount, pencil, actions, cancel, status } = parts;
  const view = page.defaultView;
  const shown = [...mount.childNodes];
  let editor: ReadmeEditor | null = null;
  let root: Root | null = null;
  let dirty = false;
  let stopChanges: (() => void) | undefined;
  // Only attach while dirty: browsers choose the warning text, and may omit it on mobile app termination.
  // https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event
  const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
    event.preventDefault();
    event.returnValue = " ";
  };
  const setDirty = (changed: boolean) => {
    dirty = changed;
    status.hidden = !dirty;
    view?.removeEventListener("beforeunload", warnBeforeLeaving);
    if (dirty) view?.addEventListener("beforeunload", warnBeforeLeaving);
  };
  const open = () => {
    if (root !== null) return;
    pencil.hidden = true;
    actions.hidden = false;
    root = createRoot(mount);
    root.render(
      <BlockEditor
        initialContent={initialDocument(field.value)}
        label={field.getAttribute("aria-label") ?? ""}
        onReady={(ready) => {
          editor = ready;
          // Compare the normalized document, not the partial server JSON; undoing to it is clean again.
          // @blocknote/core 0.56.0 src/editor/BlockNoteEditor.ts:1426: onChange returns its unsubscribe function.
          const original = JSON.stringify(ready.document);
          stopChanges = ready.onChange(() => setDirty(JSON.stringify(ready.document) !== original));
          form.dataset.ready = "true";
          ready.focus();
        }}
      />,
    );
  };
  const close = () => {
    if (dirty && !view?.confirm(form.dataset.readmeDiscard)) return;
    stopChanges?.();
    stopChanges = undefined;
    setDirty(false);
    root?.unmount();
    root = null;
    editor = null;
    delete form.dataset.ready;
    mount.replaceChildren(...shown);
    actions.hidden = true;
    pencil.hidden = false;
    pencil.focus();
  };
  form.addEventListener("submit", (event) => {
    if (event.defaultPrevented) return;
    if (editor === null) {
      event.preventDefault();
      return;
    }
    field.value = JSON.stringify(editor.document);
    view?.removeEventListener("beforeunload", warnBeforeLeaving);
    // A later submit listener can still cancel the navigation; keep those changes protected.
    queueMicrotask(() => {
      if (event.defaultPrevented) setDirty(dirty);
    });
  });
  pencil.addEventListener("click", open);
  mount.addEventListener("dblclick", open);
  cancel.addEventListener("click", close);
  pencil.hidden = false;
}
