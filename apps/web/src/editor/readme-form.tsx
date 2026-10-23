// Mounts the owner's README editor in the page's README form (ADR 0037 point 5). The page renders a plain form that
// posts to POST /profile/readme:
//   <form data-readme-editor> holding <textarea name="readme" data-readme-document> (the document as BlockNote JSON,
//   which the server wrote from the stored README) and <div data-readme-editor-mount>.
// The editor mounts in that div and, on submit, its document is written back into the textarea, so the post is the
// same form field either way. The server reads it as untrusted input (domains/profile parseReadme).
import { createRoot } from "react-dom/client";
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

/** Mounts the editor in the page's README form; does nothing on a page without one. */
export function startReadmeEditor(page: Document): void {
  const form = page.querySelector("form[data-readme-editor]");
  const field = form?.querySelector("textarea[data-readme-document]");
  const mount = form?.querySelector("[data-readme-editor-mount]");
  if (
    !(form instanceof HTMLFormElement) ||
    !(field instanceof HTMLTextAreaElement) ||
    !(mount instanceof HTMLElement)
  ) {
    return;
  }
  let editor: ReadmeEditor | null = null;
  form.addEventListener("submit", (event) => {
    if (editor === null) {
      event.preventDefault();
      return;
    }
    field.value = JSON.stringify(editor.document);
  });
  const label = field.getAttribute("aria-label") ?? "";
  createRoot(mount).render(
    <BlockEditor
      initialContent={initialDocument(field.value)}
      label={label}
      onReady={(ready) => {
        editor = ready;
        form.dataset.ready = "true";
      }}
    />,
  );
}
