// The owner's controls under each card (ADR 0051; mockup "Design profile card modules"): move up and down, delete
// behind a confirm, and for a README an editor in a Modal. Up and down replace the drag in the mockup, so every move
// is a labelled button the keyboard reaches. Each control is a plain form that posts to a card route
// (interfaces/http/routes/cards.ts) and follows its 303 back here, as Settings › Profile posts POST /profile; no
// island of ours runs. Every value is a React prop or child (escaped), never raw HTML. Moves work with no script;
// the edit and delete forms sit in the Modal's <dialog>, which opens once script runs.
import { Button, Modal, type SafeHref, Textarea } from "@unset/shared-ui";
import { useId } from "react";
import { CARD_EDIT } from "./messages.ts";
import styles from "./ProfileCards.module.css";
import type { CardView } from "./ProfileCards.tsx";

/** Closes the dialog it sits in, with no script of ours (HTML Living Standard, form method="dialog"). */
const Cancel = () => (
  <form method="dialog">
    <Button type="submit" variant="standalone">
      {CARD_EDIT.cancel}
    </Button>
  </form>
);

/** The name a card's controls are grouped under, for assistive tech. */
function cardName(content: CardView["content"]): string {
  switch (content.kind) {
    case "readme":
      return CARD_EDIT.readme;
    case "links":
      return content.title || "Links";
    case "collection":
      return content.title || "Collection";
    case "buttons":
      return content.heading;
  }
}

type ReadmeFormProps = {
  readonly trigger: string;
  readonly title: string;
  readonly action: string;
  readonly label: string;
  readonly text: string;
  readonly width: CardView["width"];
  readonly ownPage: SafeHref;
};

/** A README's text in a Modal: the same form adds a new README (POST /cards) or saves one (POST /cards/<key>). */
export function ReadmeEditor({ trigger, title, action, label, text, width, ownPage }: ReadmeFormProps) {
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
        <input type="hidden" name="kind" value="readme" />
        <input type="hidden" name="width" value={width} />
        <Textarea
          label={CARD_EDIT.readme}
          hint={CARD_EDIT.readmeHint}
          name="text"
          defaultValue={text}
          rows={12}
          required
        />
      </form>
    </Modal>
  );
}

/** A move: the whole new order, with the cards at `from` and `to` swapped. */
function Move({ keys, from, to, label }: { keys: readonly string[]; from: number; to: number; label: string }) {
  const order = [...keys];
  [order[from], order[to]] = [order[to] as string, order[from] as string];
  return (
    <form method="post" action="/card-order">
      {order.map((key) => (
        <input key={key} type="hidden" name="order" value={key} />
      ))}
      <Button type="submit" variant="standalone">
        {label}
      </Button>
    </form>
  );
}

export function CardControls({
  cards,
  index,
  ownPage,
}: {
  readonly cards: readonly CardView[];
  readonly index: number;
  readonly ownPage: SafeHref;
}) {
  const card = cards[index];
  if (card === undefined) return null;
  const keys = cards.map((c) => c.key);
  const path = `/cards/${encodeURIComponent(card.key)}`;
  return (
    <fieldset className={styles.controls}>
      <legend className="visually-hidden">{CARD_EDIT.group(cardName(card.content))}</legend>
      {card.content.kind === "readme" ? (
        <ReadmeEditor
          trigger={CARD_EDIT.edit}
          title={CARD_EDIT.editReadme}
          action={path}
          label={CARD_EDIT.save}
          text={card.content.text}
          width={card.width}
          ownPage={ownPage}
        />
      ) : null}
      {index > 0 ? <Move keys={keys} from={index} to={index - 1} label={CARD_EDIT.up} /> : null}
      {index < cards.length - 1 ? <Move keys={keys} from={index} to={index + 1} label={CARD_EDIT.down} /> : null}
      <Modal
        trigger={CARD_EDIT.remove}
        fallbackHref={ownPage}
        title={CARD_EDIT.removeTitle}
        tone="danger"
        actions={
          <>
            <Cancel />
            <form method="post" action={`${path}/delete`}>
              <Button type="submit">{CARD_EDIT.remove}</Button>
            </form>
          </>
        }
      >
        {CARD_EDIT.removeBody}
      </Modal>
    </fieldset>
  );
}
