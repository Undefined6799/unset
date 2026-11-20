// The words for a Save written only in part (ADR 0074): which of the member's cards were saved and which were not,
// each named as it reads on their page.
import type { CardContent, CardKey } from "@unset/domains-profile";
import type { CardEdit } from "./card-writes.server.ts";

/**
 * A Save written only in part, in the member's words: the cards saved and the cards not, each named by how it reads
 * on the page (its title, or a Text card's first line), so they can see which to save again.
 */
export function partialMessage(edits: readonly CardEdit[], saved: readonly CardKey[]): string {
  const names = (wanted: boolean) =>
    edits
      .filter((edit) => saved.includes(edit.key) === wanted)
      .map((edit) => `\u201c${cardName(edit.content)}\u201d`)
      .join(", ");
  return `Some of your cards were saved: ${names(true)}. Not saved yet: ${names(false)}. Save again to save the rest.`;
}

const CARD_NAME_CHARS = 40;

/**
 * How a card reads at a glance: a Text card's first line without its Markdown marks, a picture's caption, else its
 * title or heading.
 */
function cardName(content: CardContent): string {
  const raw =
    content.kind === "readme"
      ? (content.text.split("\n").find((line) => line.trim() !== "") ?? "").replace(/^[\s#>*+-]+/, "")
      : content.kind === "buttons"
        ? content.heading
        : content.kind === "image"
          ? content.caption
          : content.title;
  const name = raw.trim();
  if (name === "") return "Untitled card";
  return name.length > CARD_NAME_CHARS ? `${name.slice(0, CARD_NAME_CHARS).trimEnd()}\u2026` : name;
}
