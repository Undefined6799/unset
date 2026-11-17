// The buttons card editor (ADR 0051): heading, text and one row per button (`buttons.N.kind`, address, preset, uri,
// label) in the card dialog. A row holds both an email and a link button's fields and its kind picks which are read,
// so the form needs no script; the domain reads only the fields of the chosen kind. A row whose addresses and label
// are empty is not saved (interfaces/http/card-form.ts), so clearing one removes it.
import { Input, RadioGroup, type SafeHref, Textarea } from "@unset/shared-ui";
import { CardFormDialog, withBlankRows } from "./CardFormDialog.tsx";
import { BUTTONS_EDIT, CARD_TEXT } from "./messages.ts";
import type { CardButtonView, CardView } from "./ProfileCards.tsx";

type ButtonsContent = Extract<CardView["content"], { kind: "buttons" }>;

const EMPTY: ButtonsContent = { kind: "buttons", heading: "", text: "", buttons: [] };
const BLANK: CardButtonView = { kind: "link", preset: "custom", uri: "", label: "" };
const PRESETS = ["bookCall", "hire", "subscribe", "custom"] as const;

function ButtonRow({ index, button }: { readonly index: number; readonly button: CardButtonView }) {
  const name = (field: string) => `buttons.${index}.${field}`;
  const link = button.kind === "link" ? button : null;
  return (
    <fieldset>
      <legend>{BUTTONS_EDIT.row(index + 1)}</legend>
      <RadioGroup
        label={BUTTONS_EDIT.kind}
        name={name("kind")}
        defaultValue={button.kind}
        options={[
          { value: "email", label: BUTTONS_EDIT.email },
          { value: "link", label: BUTTONS_EDIT.link },
        ]}
      />
      <Input
        label={BUTTONS_EDIT.address}
        name={name("address")}
        defaultValue={button.kind === "email" ? button.address : ""}
        type="email"
        autoComplete="email"
      />
      <RadioGroup
        label={BUTTONS_EDIT.preset}
        name={name("preset")}
        defaultValue={link?.preset ?? "custom"}
        options={PRESETS.map((preset) => ({ value: preset, label: CARD_TEXT[preset] }))}
      />
      <Input
        label={BUTTONS_EDIT.uri}
        name={name("uri")}
        defaultValue={link?.uri ?? ""}
        inputMode="url"
        autoComplete="url"
      />
      <Input label={BUTTONS_EDIT.label} name={name("label")} defaultValue={link?.label ?? ""} />
    </fieldset>
  );
}

type ButtonsEditorProps = {
  readonly trigger: string;
  readonly title: string;
  readonly action: string;
  readonly label: string;
  /** The stored card, or null to add one. */
  readonly content: ButtonsContent | null;
  readonly width: CardView["width"];
  /** The most buttons the editor writes (domains/profile CARD_EDIT_LIMITS). */
  readonly max: number;
  readonly ownPage: SafeHref;
};

export function ButtonsEditor({ content, max, ...dialog }: ButtonsEditorProps) {
  const card = content ?? EMPTY;
  return (
    <CardFormDialog kind="buttons" {...dialog}>
      <Input label={BUTTONS_EDIT.heading} name="heading" defaultValue={card.heading} required />
      <Textarea label={BUTTONS_EDIT.text} name="text" defaultValue={card.text} rows={3} />
      <p>{BUTTONS_EDIT.hint(max)}</p>
      {withBlankRows(card.buttons, BLANK, max).map((button, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a row is named by its index, so the index is its identity
        <ButtonRow key={index} index={index} button={button} />
      ))}
    </CardFormDialog>
  );
}
