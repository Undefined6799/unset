// Modal (P1.24k): the sheet's Modal (components/Modal/README.md, index.d.ts) as built, no-JS form. Differences from the
// sheet's d.ts: no `open`/`onClose`/`dismissable` (the island opens a native <dialog>, whose platform behaviour
// replaces them); `trigger` and the required `fallbackHref` added (book P1.24a). The trigger is the modal island
// (ModalTrigger.test.tsx); `modal_dialog_focus_return` in a real browser runs in P1.26's harness.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type SafeHref, safeHref } from "../../safe-href.ts";
import { Button } from "../Button/Button.tsx";
import styles from "./Modal.module.css";
import { Modal } from "./Modal.tsx";

const fallback = safeHref("/drafts/1/delete", ["path"]) as SafeHref;

describe("Modal", () => {
  it("modal_fallback_link_no_js", () => {
    const html = renderToStaticMarkup(
      <Modal trigger="Delete draft" fallbackHref={fallback} title="Delete this draft?" tone="danger" actions={<b />}>
        It is removed for good.
      </Modal>,
    );
    const id = /aria-labelledby="([^"]+)"/.exec(html)?.[1] ?? "";
    const dialogId = /<dialog id="([^"]+)"/.exec(html)?.[1] ?? "";
    expect(id).not.toBe("");
    expect(dialogId).not.toBe(id);
    expect(html).toBe(
      renderToStaticMarkup(
        <Button as="a" href={fallback}>
          Delete draft
        </Button>,
      ) +
        `<dialog id="${dialogId}" class="${styles.root}" role="alertdialog" aria-labelledby="${id}">` +
        `<h2 id="${id}" class="${styles.title}">Delete this draft?</h2>` +
        `<div class="${styles.body}">It is removed for good.</div><div class="${styles.actions}"><b></b></div></dialog>`,
    );
    expect(html).not.toMatch(/<dialog[^>]*\sopen/);
  });

  it("modal_requires_fallback_href", () => {
    // @ts-expect-error: a modal with no fallbackHref is a type error, and the trigger's props check refuses it.
    expect(() => renderToStaticMarkup(<Modal trigger="Open" title="x" />)).toThrow("islands.props_invalid");
    expect(renderToStaticMarkup(<Modal trigger="Open" fallbackHref={fallback} title="x" />)).not.toContain("role=");
  });
});
