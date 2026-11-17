// The dialog every card editor opens (ADR 0051): a Modal holding one plain form that posts a card's kind and width with
// its fields to POST /cards or /cards/<key>, as Settings › Profile posts POST /profile (ADR 0037 point 7). The browser
// follows the 303 itself; no script of ours runs. List editors add rows of indexed fields (`items.2.uri`), which
// interfaces/http/card-form.ts reads back into a list.
import { Button, Modal, type SafeHref } from "@unset/shared-ui";
import { type ReactNode, useId } from "react";
import { Cancel } from "./Cancel.tsx";
import type { CardView } from "./ProfileCards.tsx";

/** Blank rows a list editor offers to add more. */
const BLANK_ROWS = 3;

/**
 * The stored rows, then blank ones while `max` allows. Every stored row is kept, so a save never drops one, even from a
 * card past the editor's limit; a row left blank is not saved, so clearing one removes it.
 */
export function withBlankRows<T>(items: readonly T[], blank: T, max: number): readonly T[] {
  const count = Math.max(0, Math.min(BLANK_ROWS, max - items.length));
  return [...items, ...Array.from({ length: count }, () => blank)];
}

export type CardFormDialogProps = {
  readonly trigger: string;
  readonly title: string;
  readonly action: string;
  /** The submit button's verb: Add or Save. */
  readonly label: string;
  readonly kind: CardView["content"]["kind"];
  readonly width: CardView["width"];
  readonly ownPage: SafeHref;
  readonly children: ReactNode;
};

export function CardFormDialog({ trigger, title, action, label, kind, width, ownPage, children }: CardFormDialogProps) {
  const form = useId();
  return (
    <Modal
      trigger={trigger}
      fallbackHref={ownPage}
      title={title}
      actions={
        <>
          <Cancel />
          <Button type="submit" form={form}>
            {label}
          </Button>
        </>
      }
    >
      <form id={form} method="post" action={action}>
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="width" value={width} />
        {children}
      </form>
    </Modal>
  );
}
