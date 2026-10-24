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
  if (
    !(field instanceof HTMLTextAreaElement) ||
    !(mount instanceof HTMLElement) ||
    !(pencil instanceof HTMLButtonElement) ||
    !(actions instanceof HTMLElement) ||
    !(cancel instanceof HTMLButtonElement)
  ) {
    return null;
  }
  return { form, field, mount, pencil, actions, cancel };
}

/** How close in time (ms) and place (CSS px) two taps must be to count as a double tap. */
const DOUBLE_TAP = { ms: 350, px: 24 };

/**
 * A double tap on a touch screen (Alex 2026-10-24 03:41Z: "same kind of behavior as the computer with the pencil and
 * double tap"). Not every mobile browser sends dblclick for two taps, so the taps are counted here; a mouse
 * keeps its dblclick.
 */
function doubleTap(then: () => void): (event: PointerEvent) => void {
  let last = { at: Number.NEGATIVE_INFINITY, x: 0, y: 0 };
  return (event) => {
    if (event.pointerType === "mouse") return;
    const near = Math.hypot(event.clientX - last.x, event.clientY - last.y) <= DOUBLE_TAP.px;
    if (near && event.timeStamp - last.at <= DOUBLE_TAP.ms) {
      last = { at: Number.NEGATIVE_INFINITY, x: 0, y: 0 };
      then();
      return;
    }
    last = { at: event.timeStamp, x: event.clientX, y: event.clientY };
  };
}

/**
 * Makes the owner's README editable in place: the pencil or a double-click swaps the README for the editor, Cancel
 * puts the README back, and Save posts the editor's document. Does nothing on a page without the README form.
 */
export function startReadmeEditor(page: Document): void {
  const parts = formParts(page);
  if (parts === null) return;
  const { form, field, mount, pencil, actions, cancel } = parts;
  const shown = [...mount.childNodes];
  let editor: ReadmeEditor | null = null;
  let root: Root | null = null;
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
          form.dataset.ready = "true";
        }}
      />,
    );
  };
  const close = () => {
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
    if (editor === null) {
      event.preventDefault();
      return;
    }
    field.value = JSON.stringify(editor.document);
  });
  pencil.addEventListener("click", open);
  mount.addEventListener("dblclick", open);
  mount.addEventListener("pointerup", doubleTap(open));
  cancel.addEventListener("click", close);
  pencil.hidden = false;
}
