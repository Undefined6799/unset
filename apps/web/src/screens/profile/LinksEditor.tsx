// The links card editor (ADR 0051): a Modal holding one plain form, posted to POST /cards or /cards/<key> as the
// README editor is. Each link is a row of indexed fields (`items.2.uri`), which interfaces/http/card-form.ts reads
// back into a list. Every stored row is shown, so a save never drops one, then blank rows up to the editor's limit;
// a row left blank is not saved, so clearing a row removes it. No script of ours runs; values are React props.
import { Button, Input, Modal, RadioGroup, type SafeHref } from "@unset/shared-ui";
import { useId } from "react";
import { Cancel } from "./Cancel.tsx";
import { LINKS_EDIT } from "./messages.ts";
import type { CardLinkView, CardView } from "./ProfileCards.tsx";

type LinksContent = Extract<CardView["content"], { kind: "links" }>;

/** Blank rows a form offers to add more links. */
const BLANK_ROWS = 3;

const EMPTY: LinksContent = { kind: "links", title: "", layout: "list", items: [] };
const BLANK: CardLinkView = { uri: "", label: "", description: "" };

/** The stored rows, then blank ones while the editor's limit allows. */
function rowsFor(items: readonly CardLinkView[], max: number): readonly CardLinkView[] {
  const blank = Math.max(0, Math.min(BLANK_ROWS, max - items.length));
  return [...items, ...Array.from({ length: blank }, () => BLANK)];
}

function LinkRow({ index, link }: { readonly index: number; readonly link: CardLinkView }) {
  const name = (field: string) => `items.${index}.${field}`;
  return (
    <fieldset>
      <legend>{LINKS_EDIT.row(index + 1)}</legend>
      <Input label={LINKS_EDIT.uri} name={name("uri")} defaultValue={link.uri} inputMode="url" autoComplete="url" />
      <Input label={LINKS_EDIT.label} name={name("label")} defaultValue={link.label} />
      <Input label={LINKS_EDIT.description} name={name("description")} defaultValue={link.description} />
    </fieldset>
  );
}

type LinksEditorProps = {
  readonly trigger: string;
  readonly title: string;
  readonly action: string;
  readonly label: string;
  /** The stored card, or null to add one. */
  readonly content: LinksContent | null;
  readonly width: CardView["width"];
  /** The most links the editor writes (domains/profile CARD_EDIT_LIMITS); a stored card may hold more. */
  readonly max: number;
  readonly ownPage: SafeHref;
};

export function LinksEditor({ trigger, title, action, label, content, width, max, ownPage }: LinksEditorProps) {
  const form = useId();
  const card = content ?? EMPTY;
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
        <input type="hidden" name="kind" value="links" />
        <input type="hidden" name="width" value={width} />
        <Input label={LINKS_EDIT.title} name="title" defaultValue={card.title} />
        <RadioGroup
          label={LINKS_EDIT.layout}
          name="layout"
          defaultValue={card.layout}
          options={[
            { value: "list", label: LINKS_EDIT.list },
            { value: "grid", label: LINKS_EDIT.grid },
            { value: "carousel", label: LINKS_EDIT.carousel },
          ]}
        />
        <p>{LINKS_EDIT.hint(max)}</p>
        {rowsFor(card.items, max).map((link, index) => (
          // The index is the row's field name, so it is also its identity here.
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are named by their index
          <LinkRow key={index} index={index} link={link} />
        ))}
      </form>
    </Modal>
  );
}
