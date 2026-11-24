// A card as the owner's page shows it (ADR 0051; P1.20i, from apps/web/src/screens/profile/ProfileCards.tsx): the
// README read into blocks, a link row's text, and every address through safeHref, here too although the domain already
// dropped unsafe ones (two layers for the output every visitor will see). Runs on the server; the components only
// render what this returns.
import { safeHref } from "@unset/shared-safe-href";
import { type CodeColourBudget, type CodeColourLimits, codeColourBudget, colourCode } from "../editor/code-colours.ts";
import { CARD_TEXT } from "./messages.ts";
import type { Block as ParsedBlock } from "./parse.ts";
import { placeSides } from "./place-sides.ts";
import type {
  Block,
  CardContent,
  CardShown,
  CardSurface,
  CardView,
  CardWidth,
  ShownButton,
  ShownCard,
  TableEdge,
} from "./types.ts";

/**
 * Reads a Text card's Markdown into blocks. The page's server passes one that stops a slow parse and keeps what it
 * read (interfaces/web text-reader.ts), its tables named for placing looks (place-sides.ts nameTables); parse.ts
 * parseReadme is the parse itself, and a reader that names no table draws no look. What it gives may be shared and
 * frozen, so nothing here changes a block: colouring builds new ones.
 */
export type TextReader = (text: string) => readonly ParsedBlock[];

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

/**
 * README blocks as a card shows them: code in colours where its language is known and the page's colouring budget
 * allows, else plain; the language itself is dropped. A table carries the edges placed on it (`edges`, from
 * place-sides.ts) and never the lines it was written on or their names, which only place looks. Every code block and
 * table is a new object and no block is changed.
 */
export const colourBlocks = (
  blocks: readonly ParsedBlock[],
  budget: CodeColourBudget,
  edges: ReadonlyMap<ParsedBlock, readonly TableEdge[]> = new Map(),
): Promise<Block[]> =>
  Promise.all(
    blocks.map(async (block): Promise<Block> => {
      if (block.kind === "table") {
        const { align, head, rows } = block;
        const placed = edges.get(block);
        return placed === undefined
          ? { kind: "table", align, head, rows }
          : { kind: "table", align, head, rows, edges: placed };
      }
      if (block.kind !== "code") return block;
      const coloured = await colourCode(block.text, block.language, budget);
      return "runs" in coloured ? { kind: "code", runs: coloured.runs } : { kind: "code", text: block.text };
    }),
  );

async function shownOf(content: CardContent, readText: TextReader, budget: CodeColourBudget): Promise<CardShown> {
  switch (content.kind) {
    case "readme": {
      const parsed = readText(content.text);
      const blocks = await colourBlocks(parsed, budget, placeSides(parsed, content.tableSides));
      return content.tableLines === undefined
        ? { kind: "readme", blocks }
        : { kind: "readme", blocks, tableLines: content.tableLines };
    }
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

/**
 * The page's cards, in page order, each with what it shows; on the owner's page, with the version each was read at.
 * `readText` reads every Text card of the page, in page order and before anything is awaited, so one reader can
 * hold them all to one budget. `codeColours` (interfaces/web limits.ts) bounds the colouring of the whole page's
 * code: one budget for all cards.
 */
export const cardViews = (
  cards: readonly {
    readonly key: string;
    readonly width: CardWidth;
    readonly surface?: CardSurface;
    readonly content: CardContent;
  }[],
  readText: TextReader,
  codeColours: CodeColourLimits,
  versions?: ReadonlyMap<string, string>,
): Promise<CardView[]> => {
  const budget = codeColourBudget(codeColours);
  return Promise.all(
    cards.map(async ({ key, width, surface = "filled", content }) => {
      const version = versions?.get(key);
      const shown = { key, width, surface, content, shown: await shownOf(content, readText, budget) };
      return version === undefined ? shown : { ...shown, version };
    }),
  );
};

/**
 * The cards for a page that edits nothing (the public profile): what each shows, without `content`, which only the
 * owner's editors read. A visitor's browser is sent what their page draws and no more (rule SE-3; book P1.22h).
 */
export const shownCards = (cards: readonly CardView[]): ShownCard[] =>
  cards.map(({ key, width, surface, shown }) => ({ key, width, surface, shown }));

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
export function contactAction(cards: readonly ShownCard[]): { readonly href: string; readonly label: string } | null {
  const contact = cards.find((card) => card.shown.kind === "buttons")?.shown;
  const first = contact?.kind === "buttons" ? contact.buttons[0] : undefined;
  return first === undefined ? null : { href: first.href, label: first.label };
}
