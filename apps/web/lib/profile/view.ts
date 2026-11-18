// A card as the owner's page shows it (ADR 0051; P1.20i, from apps/web/src/screens/profile/ProfileCards.tsx): the
// README read into blocks, a link row's text, and every address through safeHref, here too although the domain already
// dropped unsafe ones (two layers for the output every visitor will see). Runs on the server; the components only
// render what this returns.
import { safeHref } from "@unset/shared-safe-href";
import { CARD_TEXT } from "./messages.ts";
import type { CardContent, CardShown, CardView, CardWidth, ShownButton } from "./types.ts";
import { parseReadme } from "./parse.ts";

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

type Buttons = Extract<CardContent, { kind: "buttons" }>["buttons"];

function shownButtons(buttons: Buttons): ShownButton[] {
  const shown: ShownButton[] = [];
  for (const button of buttons) {
    if (button.kind === "email") {
      // Percent-encoded (RFC 6068 section 2): the address can only ever be the recipient, never add headers.
      const href = safeHref(`mailto:${encodeURIComponent(button.address)}`, ["mailto:"]);
      if (href !== null) shown.push({ href, label: CARD_TEXT.email });
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
          return [{ href, text: link.label === "" ? linkText(link.uri) : link.label, description: link.description }];
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

/** The page's cards, in page order, each with what it shows. */
export const cardViews = (
  cards: readonly { readonly key: string; readonly width: CardWidth; readonly content: CardContent }[],
): CardView[] => cards.map(({ key, width, content }) => ({ key, width, content, shown: shownOf(content) }));

/** The side column's website as a link, or null when unset or not http(s). */
export function websiteLink(website: string): { readonly href: string; readonly text: string } | null {
  const href = web(website);
  return href === null ? null : { href, text: website.replace(/^https?:\/\//, "") };
}
