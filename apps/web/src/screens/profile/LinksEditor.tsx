// The links card editor (ADR 0051): title, layout and one row per link (`items.N.uri`, label, description) in the
// card dialog. Every stored row is shown, then blank rows up to the editor's limit (withBlankRows).
import { Input, RadioGroup, type SafeHref } from "@unset/shared-ui";
import { CardFormDialog, withBlankRows } from "./CardFormDialog.tsx";
import { LINKS_EDIT } from "./messages.ts";
import type { CardLinkView, CardView } from "./ProfileCards.tsx";

type LinksContent = Extract<CardView["content"], { kind: "links" }>;

const EMPTY: LinksContent = { kind: "links", title: "", layout: "list", items: [] };
const BLANK: CardLinkView = { uri: "", label: "", description: "" };

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

export function LinksEditor({ content, max, ...dialog }: LinksEditorProps) {
  const card = content ?? EMPTY;
  return (
    <CardFormDialog kind="links" {...dialog}>
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
      {withBlankRows(card.items, BLANK, max).map((link, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a row is named by its index, so the index is its identity
        <LinkRow key={index} index={index} link={link} />
      ))}
    </CardFormDialog>
  );
}
