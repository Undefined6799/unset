// A card as the owner's page shows it (ADR 0051; P1.20i, from apps/web/src/screens/profile/ProfileCards.tsx): the
// README read into blocks, a link row's text, and every address through safeHref, here too although the domain already
// dropped unsafe ones (two layers for the output every visitor will see). Runs on the server; the components only
// render what this returns.
import { safeHref } from "@unset/shared-safe-href";
import { CARD_TEXT } from "./messages.ts";
import { parseReadme } from "./parse.ts";
import type { CardContent, CardShown, CardSurface, CardView, CardWidth, ShownButton } from "./types.ts";

const web = (uri: string): string | null => (uri === "" ? null : safeHref(uri, ["http:", "https:"]));

/** How an address reads when the member gave it no label: host without www, then the path, no query or hash. */
export function linkText(uri: string): string {
  try {
    const url = new URL(uri);
    const path = url.pathname.replace(/\/+$/, "");
    return `${url.hostname.replace(/^www\./, "")}${path}`;
  } catch {
    return uri;
  }
}

/** The address's host without www, or "" when it does not parse. */
export function linkHost(uri: string): string {
  try {
    return new URL(uri).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

type Buttons = Extract<CardContent, { kind: "buttons" }>["buttons"];

function shownButtons(buttons: Buttons): ShownButton[] {
  const shown: ShownButton[] = [];
  for (const button of buttons) {
    if (button.kind === "email") {
      // Percent-encoded (RFC 6068 section 2): the address can only ever be the recipient, never add headers.
      const href = safeHref(`mailto:${encodeURIComponent(button.address)}`, ["mailto:"]);
      if (href !== null) shown.push({ href, label: CARD_TEXT.email, address: button.address });
      continue;
    }
    const href = web(button.uri);
    const label = button.preset === "custom" ? button.label || CARD_TEXT.custom : CARD_TEXT[button.preset];
    if (href !== null) shown.push({ href, label });
  }
  return shown;
}

function shownOf(content: CardContent): CardShown {
  switch (content.kind) {
    case "readme":
      return { kind: "readme", blocks: parseReadme(content.text) };
    case "links":
      return {
        kind: "links",
        title: content.title,
        layout: content.layout,
        items: content.items.flatMap((link) => {
          const href = web(link.uri);
          if (href === null) return [];
          const labelled = link.label !== "";
          return [
            {
              href,
              text: labelled ? link.label : linkText(link.uri),
              description: link.description,
              site: labelled ? linkHost(link.uri) : "",
            },
          ];
        }),
      };
    case "collection":
      return {
        kind: "collection",
        title: content.title,
        layout: content.layout,
        items: content.items.map((entry) => ({
          href: web(entry.uri),
          title: entry.title,
          tag: entry.tag,
          description: entry.description,
        })),
      };
    case "buttons":
      return { kind: "buttons", heading: content.heading, text: content.text, buttons: shownButtons(content.buttons) };
  }
}

/** The page's cards, in page order, each with what it shows; on the owner's page, with the version each was read at. */
export const cardViews = (
  cards: readonly {
    readonly key: string;
    readonly width: CardWidth;
    readonly surface?: CardSurface;
    readonly content: CardContent;
  }[],
  versions?: ReadonlyMap<string, string>,
): CardView[] =>
  cards.map(({ key, width, surface = "filled", content }) => {
    const version = versions?.get(key);
    const shown = { key, width, surface, content, shown: shownOf(content) };
    return version === undefined ? shown : { ...shown, version };
  });

/** The profile's website as a link, or null when unset or not http(s). */
export function websiteLink(website: string): { readonly href: string; readonly text: string } | null {
  const href = web(website);
  return href === null ? null : { href, text: website.replace(/^https?:\/\//, "") };
}

/**
 * The page's published contact action for the header's About panel (P1.21o): the first button of the first
 * Contact card, as that card shows it, or null. The profile record holds no contact field (ADR 0051), and an account's
 * own email is never read here.
 */
export function contactAction(cards: readonly CardView[]): { readonly href: string; readonly label: string } | null {
  const contact = cards.find((card) => card.shown.kind === "buttons")?.shown;
  const first = contact?.kind === "buttons" ? contact.buttons[0] : undefined;
  return first === undefined ? null : { href: first.href, label: first.label };
}
