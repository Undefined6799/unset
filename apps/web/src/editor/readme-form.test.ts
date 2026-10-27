// @vitest-environment jsdom
// The real form and BlockNote editor: opening focuses the document, and only changed content needs protection.
import { ProfileView } from "@unset/shared-ui";
import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import { PROFILE } from "../screens/messages.ts";
import { initialDocument, startReadmeEditor } from "./readme-form.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no Range geometry. ProseMirror 1.42.6 dist/index.js:529 reads it when a focused edit scrolls the caret;
// these tests exercise content and form state, so zero geometry is sufficient (as for jsdom's element rectangles).
Range.prototype.getClientRects ??= () => Object.assign([], { item: () => null });
Range.prototype.getBoundingClientRect ??= () => new DOMRect();

afterEach(async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const cancel = document.querySelector<HTMLButtonElement>('button[name="cancel"]');
  if (cancel !== null) await act(async () => cancel.click());
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

async function openForm() {
  const markup = renderToStaticMarkup(
    createElement(ProfileView, {
      did: "did:plc:example",
      handle: "example.test",
      verified: true,
      handleUnavailable: false,
      fields: {
        displayName: "Example",
        headline: "",
        location: "",
        website: "",
        links: "",
        readme: [
          {
            $type: "sh.unset.profile#paragraph",
            content: [{ $type: "sh.unset.profile#textRun", text: "Hello" }],
          },
        ],
      },
      labels: PROFILE,
      readmeEditor: {
        document: '[{"id":"intro","type":"paragraph","content":"Hello"}]',
        labels: PROFILE.readmeForm,
      },
    }),
  );
  const page = new DOMParser().parseFromString(markup, "text/html");
  document.body.replaceChildren(...page.body.childNodes);
  startReadmeEditor(document);
  const form = document.querySelector<HTMLFormElement>("form[data-readme-editor]") as HTMLFormElement;
  const pencil = form.querySelector<HTMLButtonElement>("[data-readme-edit]") as HTMLButtonElement;
  await act(async () => pencil.click());
  const area = form.querySelector<HTMLElement>("[contenteditable=true]") as HTMLElement;
  // jsdom does not apply the production stylesheet's @layer rules; ProseMirror's DOM parser needs this one.
  area.style.whiteSpace = "pre-wrap";
  return {
    form,
    pencil,
    area,
    cancel: form.querySelector<HTMLButtonElement>('button[name="cancel"]') as HTMLButtonElement,
    field: form.querySelector<HTMLTextAreaElement>("[data-readme-document]") as HTMLTextAreaElement,
  };
}

/** A browser edit, observed by ProseMirror's real MutationObserver. */
async function replaceText(area: HTMLElement, text: string) {
  await act(async () => {
    const paragraph = area.querySelector("p");
    if (paragraph === null) throw new Error("Missing editable paragraph");
    paragraph.textContent = text;
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function leavingPage(): Event {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event;
}

test("initial_document_reads_a_block_array", () => {
  expect(initialDocument('[{"type":"paragraph","content":"Hi"}]')).toEqual([{ type: "paragraph", content: "Hi" }]);
});

test("initial_document_is_empty_for_anything_else", () => {
  expect(initialDocument("")).toEqual([]);
  expect(initialDocument("{not json")).toEqual([]);
  expect(initialDocument('{"type":"paragraph"}')).toEqual([]);
});

test("opening_focuses_the_document_without_marking_it_changed", async () => {
  const { form, area, cancel, pencil } = await openForm();
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  expect(document.activeElement).toBe(area);
  expect(leavingPage().defaultPrevented).toBe(false);
  await act(async () => cancel.click());
  expect(confirm).not.toHaveBeenCalled();
  expect(form.querySelector("[contenteditable=true]")).toBeNull();
  expect(document.activeElement).toBe(pencil);
});

test("declining_discard_keeps_changed_content_and_navigation_protection", async () => {
  const { form, area, cancel } = await openForm();
  await replaceText(area, "Changed introduction");
  expect(leavingPage().defaultPrevented).toBe(true);
  vi.spyOn(window, "confirm").mockReturnValue(false);
  await act(async () => cancel.click());
  expect(form.querySelector("[contenteditable=true]")?.textContent).toContain("Changed introduction");
  expect(leavingPage().defaultPrevented).toBe(true);
});

test("confirmed_discard_restores_the_readme_and_removes_navigation_protection", async () => {
  const { form, area, cancel, pencil } = await openForm();
  await replaceText(area, "Changed introduction");
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  await act(async () => cancel.click());
  expect(confirm).toHaveBeenCalledWith(PROFILE.readmeForm.discard);
  expect(form.querySelector("[contenteditable=true]")).toBeNull();
  expect(form.querySelector("[data-readme-editor-mount]")?.textContent).toBe("Hello");
  expect(leavingPage().defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(pencil);
});

test("restoring_original_content_does_not_need_discard_confirmation", async () => {
  const { area, cancel } = await openForm();
  await replaceText(area, "Changed introduction");
  await replaceText(area, "Hello");
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  expect(leavingPage().defaultPrevented).toBe(false);
  await act(async () => cancel.click());
  expect(confirm).not.toHaveBeenCalled();
});

test("save_serializes_changed_content_and_allows_its_own_navigation", async () => {
  const { form, area, field } = await openForm();
  await replaceText(area, "Changed introduction");
  const submit = new Event("submit", { bubbles: true, cancelable: true });
  form.dispatchEvent(submit);
  expect(submit.defaultPrevented).toBe(false);
  expect(JSON.parse(field.value)[0].content).toEqual([{ type: "text", text: "Changed introduction", styles: {} }]);
  expect(leavingPage().defaultPrevented).toBe(false);
});
