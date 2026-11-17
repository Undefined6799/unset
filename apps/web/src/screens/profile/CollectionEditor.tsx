// The collection card editor (ADR 0051): title, layout and one row per entry (`items.N.title`, tag, description,
// uri) in the card dialog. Every stored row is shown, then blank rows up to the editor's limit (withBlankRows).
import { Input, RadioGroup, type SafeHref } from "@unset/shared-ui";
import { CardFormDialog, withBlankRows } from "./CardFormDialog.tsx";
import { COLLECTION_EDIT, LINKS_EDIT } from "./messages.ts";
import type { CardEntryView, CardView } from "./ProfileCards.tsx";

type CollectionContent = Extract<CardView["content"], { kind: "collection" }>;

const EMPTY: CollectionContent = { kind: "collection", title: "", layout: "carousel", items: [] };
const BLANK: CardEntryView = { title: "", tag: "", description: "", uri: "" };

function EntryRow({ index, entry }: { readonly index: number; readonly entry: CardEntryView }) {
  const name = (field: string) => `items.${index}.${field}`;
  return (
    <fieldset>
      <legend>{COLLECTION_EDIT.row(index + 1)}</legend>
      <Input label={COLLECTION_EDIT.entryTitle} name={name("title")} defaultValue={entry.title} />
      <Input label={COLLECTION_EDIT.tag} name={name("tag")} defaultValue={entry.tag} />
      <Input label={COLLECTION_EDIT.description} name={name("description")} defaultValue={entry.description} />
      <Input
        label={COLLECTION_EDIT.uri}
        name={name("uri")}
        defaultValue={entry.uri}
        inputMode="url"
        autoComplete="url"
      />
    </fieldset>
  );
}

type CollectionEditorProps = {
  readonly trigger: string;
  readonly title: string;
  readonly action: string;
  readonly label: string;
  /** The stored card, or null to add one. */
  readonly content: CollectionContent | null;
  readonly width: CardView["width"];
  /** The most entries the editor writes (domains/profile CARD_EDIT_LIMITS); a stored card may hold more. */
  readonly max: number;
  readonly ownPage: SafeHref;
};

export function CollectionEditor({ content, max, ...dialog }: CollectionEditorProps) {
  const card = content ?? EMPTY;
  return (
    <CardFormDialog kind="collection" {...dialog}>
      <Input label={COLLECTION_EDIT.title} name="title" defaultValue={card.title} />
      <RadioGroup
        label={LINKS_EDIT.layout}
        name="layout"
        defaultValue={card.layout}
        options={[
          { value: "carousel", label: LINKS_EDIT.carousel },
          { value: "grid", label: LINKS_EDIT.grid },
          { value: "list", label: LINKS_EDIT.list },
        ]}
      />
      <p>{COLLECTION_EDIT.hint(max)}</p>
      {withBlankRows(card.items, BLANK, max).map((entry, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a row is named by its index, so the index is its identity
        <EntryRow key={index} index={index} entry={entry} />
      ))}
    </CardFormDialog>
  );
}
