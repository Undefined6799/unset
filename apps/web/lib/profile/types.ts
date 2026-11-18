// What the owner's page hands the profile components (P1.20i): each card as the profile domain reads it (the editor
// fills its fields from `content`), and beside it what the card shows, built on the server: the README's blocks and
// every address already through safeHref, so a component never decides whether a link is safe.

export type CardLayout = "list" | "carousel" | "grid";
export type CardWidth = "full" | "half";
export type LinkPreset = "bookCall" | "hire" | "subscribe" | "custom";

export type CardContent =
  | { readonly kind: "readme"; readonly text: string }
  | {
      readonly kind: "links";
      readonly title: string;
      readonly layout: CardLayout;
      readonly items: readonly { readonly uri: string; readonly label: string; readonly description: string }[];
    }
  | {
      readonly kind: "collection";
      readonly title: string;
      readonly layout: CardLayout;
      readonly items: readonly {
        readonly title: string;
        readonly tag: string;
        readonly description: string;
        readonly uri: string;
      }[];
    }
  | {
      readonly kind: "buttons";
      readonly heading: string;
      readonly text: string;
      readonly buttons: readonly (
        | { readonly kind: "email"; readonly address: string }
        | { readonly kind: "link"; readonly preset: LinkPreset; readonly uri: string; readonly label: string }
      )[];
    };

/** README inline text, as apps/web/lib/readme/parse.ts reads it; `href` is a safeHref result. */
export type Inline =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "strong"; readonly children: readonly Inline[] }
  | { readonly kind: "em"; readonly children: readonly Inline[] }
  | { readonly kind: "link"; readonly href: string; readonly children: readonly Inline[] };

export type Block =
  | { readonly kind: "heading"; readonly level: 1 | 2 | 3; readonly children: readonly Inline[] }
  | { readonly kind: "paragraph" | "quote"; readonly children: readonly Inline[] }
  | {
      readonly kind: "list";
      readonly ordered: boolean;
      readonly start?: number;
      readonly items: readonly (readonly Inline[])[];
    }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "rule" };

/** A link, entry or button as the card shows it; a row with no safe address is left out. */
export type ShownLink = { readonly href: string; readonly text: string; readonly description: string };
export type ShownEntry = {
  readonly href: string | null;
  readonly title: string;
  readonly tag: string;
  readonly description: string;
};
export type ShownButton = { readonly href: string; readonly label: string };

export type CardShown =
  | { readonly kind: "readme"; readonly blocks: readonly Block[] }
  | {
      readonly kind: "links";
      readonly title: string;
      readonly layout: CardLayout;
      readonly items: readonly ShownLink[];
    }
  | {
      readonly kind: "collection";
      readonly title: string;
      readonly layout: CardLayout;
      readonly items: readonly ShownEntry[];
    }
  | {
      readonly kind: "buttons";
      readonly heading: string;
      readonly text: string;
      readonly buttons: readonly ShownButton[];
    };

export type CardView = {
  readonly key: string;
  readonly width: CardWidth;
  readonly content: CardContent;
  readonly shown: CardShown;
};

/** How many rows the editors write per list (domains/profile CARD_EDIT_LIMITS). */
export type CardEditLimits = { readonly links: number; readonly collection: number; readonly buttons: number };

/**
 * The part of SvelteKit's SubmitFunction (kit 3.2.0 types/index.d.ts) a card editor uses: `cancel` stops a submit
 * before it is sent; after the action answers, `result` is its ActionResult and `update` does what `enhance` does by
 * default. apps/web imports nothing from the
 * framework (ADR 0056), so the page passes kit's `enhance` in as an Enhance.
 */
export type SubmitHandler = (input: {
  cancel: () => void;
}) => (outcome: {
  result: { type: string; data?: Record<string, unknown> | undefined };
  update: () => Promise<void>;
}) => Promise<void>;

/**
 * The page's form enhancement as a Svelte action, `use:enhance` or `use:enhance={handler}`; the default does nothing
 * (no script). Written out rather than as svelte/action's Action, which a .ts file here may not import (ADR 0056).
 */
export type Enhance = (form: HTMLFormElement, handler?: SubmitHandler) => { destroy?: () => void } | undefined;
