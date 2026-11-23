// What the owner's page hands the profile components (P1.20i): each card as the profile domain reads it (the editor
// fills its fields from `content`), and beside it what the card shows, built on the server: the README's blocks and
// every address already through safeHref, so a component never decides whether a link is safe.

export type CardLayout = "list" | "carousel" | "grid";
/** How the avatar is cropped (sh.unset.profile avatarShape). */
export type AvatarShape = "round" | "roundedSquare";
export type CardSurface = "filled" | "outlined" | "plain";
/** Who sees the member's page (ADR 0078), as domains/profile reads it. */
export type PageVisibility = "public" | "signedIn" | "ownerOnly";
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
  | { readonly kind: "break" }
  | { readonly kind: "strong"; readonly children: readonly Inline[] }
  | { readonly kind: "em"; readonly children: readonly Inline[] }
  | { readonly kind: "del"; readonly children: readonly Inline[] }
  | { readonly kind: "link"; readonly href: string; readonly children: readonly Inline[] };

export type Block =
  | { readonly kind: "heading"; readonly level: 1 | 2 | 3; readonly children: readonly Inline[] }
  | { readonly kind: "paragraph"; readonly children: readonly Inline[] }
  | { readonly kind: "quote"; readonly paragraphs: readonly (readonly Inline[])[] }
  | ListBlock
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "rule" }
  | {
      readonly kind: "table";
      readonly align: readonly ("left" | "center" | "right" | null)[];
      readonly head: readonly (readonly Inline[])[];
      readonly rows: readonly (readonly (readonly Inline[])[])[];
    };

export type ListBlock = {
  readonly kind: "list";
  readonly ordered: boolean;
  readonly start?: number;
  readonly items: readonly {
    readonly text: readonly Inline[];
    readonly lists: readonly ListBlock[];
    readonly task?: "open" | "done";
  }[];
};

/** A link, entry or button as the card shows it; a row with no safe address is left out. */
/** `site` is the address's host when the member gave the link a label of their own, else "" (the text is the host). */
export type ShownLink = {
  readonly href: string;
  readonly text: string;
  readonly description: string;
  readonly site: string;
};
export type ShownEntry = {
  readonly href: string | null;
  readonly title: string;
  readonly tag: string;
  readonly description: string;
};
/** `address` is an email button's address, shown under the buttons for a visitor with no mail app. */
export type ShownButton = { readonly href: string; readonly label: string; readonly address?: string };

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

/** A card as a page that edits nothing draws it: what it shows, never the record's fields behind it (rule SE-3). */
export type ShownCard = {
  readonly key: string;
  readonly width: CardWidth;
  readonly surface: CardSurface;
  readonly shown: CardShown;
};

/** A card on the owner's page: what it shows, and `content`, the record's fields its editor fills from. */
export type CardView = ShownCard & {
  /** The record CID the card was read at: what an edit of it names (ADR 0074). */
  readonly version?: string;
  readonly content: CardContent;
};

/**
 * How many rows the editors write per list (domains/profile CARD_EDIT_LIMITS), and `text`, the README's maxlength:
 * the editor's limit in UTF-8 bytes (domains/profile TEXT_EDIT_BYTES). maxlength counts UTF-16 code units,
 * never more than a text's UTF-8 bytes, so it never stops a README the editor accepts, and it keeps a no-script save
 * far under the form's body cap (staging walkthrough 2026-11-18 round two: 2.2 MiB pasted, the text lost).
 */
export type CardEditLimits = {
  readonly links: number;
  readonly collection: number;
  readonly buttons: number;
  readonly text: number;
  /** The card form's body cap in bytes (interfaces/web policy.ts): the one Save checks it before sending (ADR 0074). */
  readonly formBytes: number;
};

/**
 * The part of SvelteKit's SubmitFunction (kit 3.2.0 types/index.d.ts) a card editor uses: `cancel` stops a submit
 * before it is sent; after the action answers, `result` is its ActionResult and `update` does what `enhance` does by
 * default. Still written out until the card editors move to kit's own types beside their route (P1.20s did the
 * settings profile form); the page passes kit's `enhance` in as an Enhance.
 */
export type SubmitHandler = (input: {
  cancel: () => void;
}) => (outcome: {
  result: { type: string; data?: Record<string, unknown> | undefined };
  update: () => Promise<void>;
}) => Promise<void>;

/** Which editor the page was opened with in place (no script; lib/profile/panel.ts), as its load read the query. */
export type CardPanelRequest =
  | { readonly kind: "edit" | "remove"; readonly key: string }
  | { readonly kind: "add"; readonly card: CardContent["kind"] | null }
  | { readonly kind: "avatar" };

/** A refused write as the page's action answers it: the catalog code and words, and the form field to blame. */
export type Refusal = { readonly code: string; readonly message: string; readonly field?: string };

/**
 * An editor drawn in place on the page (no script; the page opened with `?edit=`, `?add=` or `?remove=`): where it
 * sits, the link back, the query its form keeps, and, after a refused save, the refusal and what was typed.
 */
export type CardPanelState = {
  readonly anchor: string;
  readonly cancel: string;
  readonly stay: string;
  readonly refusal?: Refusal;
  readonly values?: Readonly<Record<string, string>>;
};

/**
 * The page's form enhancement as a Svelte action, `use:enhance` or `use:enhance={handler}`; the default does nothing
 * (no script). apps/web may import svelte and kit types: ADR 0056 decision 3 and the `sveltekit-web-only` rule keep
 * the framework out of domains, infrastructure and shared only.
 */
export type Enhance = (form: HTMLFormElement, handler?: SubmitHandler) => { destroy?: () => void } | undefined;
