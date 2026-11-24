// Copied from apps/web/src/screens/profile/messages.ts for the Svelte page (P1.20i); that copy went with P1.20k.
// The words a profile card shows that the member does not write (ADR 0051 decision 4: button text comes from the
// preset). English first (plan: English, then French).
import type { CardContent } from "./types.ts";

export const CARD_TEXT = {
  email: "Email me",
  bookCall: "Book a call",
  hire: "Hire me",
  subscribe: "Subscribe",
  custom: "Open link",
  /** The buttons card's eyebrow (the mockup's Contact card). */
  contact: "Contact",
  links: (n: number) => (n === 1 ? "1 link" : `${n} links`),
  entries: (n: number) => (n === 1 ? "1 entry" : `${n} entries`),
  scrollForMore: "scroll for more",
  scrollSideways: "scroll sideways for more",
  /** The name of a carousel's scrolling area, which the keyboard reaches. */
  carousel: (title: string) => `${title || "Entries"}, scrolls sideways`,
  /** A carousel's buttons, which scroll it by one tile. */
  previous: (title: string) => `Previous in ${title || "Entries"}`,
  next: (title: string) => `Next in ${title || "Entries"}`,
  /** A code block's button, drawn only with script; the name says what it copies, the button shows "Copy". */
  copy: "Copy",
  copyCode: "Copy code",
} as const;

/** The single Add picker (the profile-card mockup). */
export const ADD_CARD = {
  trigger: "Add card",
  title: "Add a card",
  description: "Choose what the new card holds. You can change its width and order later.",
  readme: "Text",
  readmeBlurb: "Your own words, written in Markdown: headings, lists, links, quotes and code.",
  links: "Links",
  linksBlurb: "Your sites and accounts elsewhere, as a list, grid or carousel.",
  collection: "Collection",
  collectionBlurb: "Projects, releases or anything else, each with a tag and a description.",
  buttons: "Contact",
  buttonsBlurb: (max: number) => `Up to ${max} buttons: email me, book a call, hire me, subscribe or your own.`,
} as const;

/** The avatar's editor (sh.unset.profile avatarShape). */
export const AVATAR_EDIT = {
  trigger: "Change picture shape",
  change: "Shape",
  title: "Picture shape",
  description: "Uploading a picture comes later. For now you can choose the shape it is shown in.",
  shape: "Shape",
  round: "Round",
  roundedSquare: "Rounded square",
  save: "Save",
  cancel: "Cancel",
  refused: "Your profile could not be saved.",
} as const;

/** The profile header and its About panel (ADR 0072, ADR 0077). */
export const PROFILE_HEADER = {
  edit: "Edit profile",
  viewPublic: "View as public",
  /** The avatar's name: it opens the details, so it says so. */
  open: (name: string) => `About ${name}`,
  title: "About",
  close: "Close details",
  handle: "Handle",
  place: "Place",
  web: "Web",
  did: "DID",
} as const;

/** The owner's card controls (ADR 0051). */
export const CARD_EDIT = {
  group: (name: string) => `${name} card`,
  edit: "Edit",
  editReadme: "Edit text",
  addReadme: "Add text",
  readme: "Text",
  readmeHint: "Markdown: headings, lists, links, code and quotes.",
  write: "Write",
  preview: "Preview",
  previewEmpty: "Nothing to preview yet.",
  save: "Save",
  add: "Add",
  cancel: "Cancel",
  up: "Move up",
  /** The three-dot menu on each card, named for the card. */
  more: (name: string) => `More for ${name} card`,
  down: "Move down",
  remove: "Delete",
  removing: "Deleting…",
  /** Names the card, so a page of similar cards says which one goes (staging audit 2026-11-19). */
  removeTitle: (name: string) => `Delete ${name} card?`,
  removeBody: "It leaves your page and your sign-in server. This cannot be undone.",
  width: "Width",
  surface: "Surface",
  /** The card menu's name for Surface (Alex 2026-11-20: "Style"). */
  style: "Style",
  /** Swaps a Text card's editor on the owner's page for its plain Markdown field (ADR 0074 item 4). */
  showMarkdown: "Show Markdown",
  filled: "Filled",
  outlined: "Outlined",
  plain: "Plain",
  full: "Full width",
  half: "Half width",
  /** A refused save whose answer carried no catalog message. */
  refused: "That card could not be saved.",
  // A write the member's grant does not cover: the editor keeps what was typed while they allow access in a new tab.
  allowAccess: "Allow access",
  newTab: " (opens in a new tab)",
  /** A refused delete whose answer carried no catalog message. */
  removeRefused: "That card could not be deleted.",
  /** A refusal shown beside the field it blames, by its code; any other code shows the catalog message there. */
  fieldError: {
    "card.required": "Fill this in.",
    "card.url_invalid": "Use a public http or https address, such as https://example.com.",
    "card.email_invalid": "That email address does not look right.",
    "card.too_long": "This is too long. Shorten it and save again.",
    "card.invalid": "This could not be read. Remove any hidden characters, check it and save again.",
  } as Readonly<Record<string, string>>,
} as const;

export const LINKS_EDIT = {
  add: "Add links",
  editTitle: "Edit links",
  title: "Title",
  layout: "Layout",
  list: "List",
  grid: "Grid",
  carousel: "Carousel",
  row: (n: number) => `Link ${n}`,
  addRow: "Add link",
  uri: "Address",
  label: "Label",
  description: "Description",
  hint: (max: number) => `Up to ${max} links. Leave a link's fields empty to remove it.`,
} as const;

export const COLLECTION_EDIT = {
  add: "Add collection",
  editTitle: "Edit collection",
  title: "Title",
  row: (n: number) => `Entry ${n}`,
  addRow: "Add entry",
  entryTitle: "Title",
  tag: "Tag",
  description: "Description",
  uri: "Address",
  hint: (max: number) => `Up to ${max} entries. Leave an entry's fields empty to remove it.`,
} as const;

// The buttons card is the Contact card everywhere the member reads its name (staging audit 2026-11-19).
export const BUTTONS_EDIT = {
  add: "Add contact",
  editTitle: "Edit contact",
  heading: "Heading",
  text: "Text",
  row: (n: number) => `Button ${n}`,
  addRow: "Add button",
  kind: "Button opens",
  email: "Email",
  link: "Web address",
  address: "Email address",
  preset: "Button text",
  uri: "Web address",
  label: "Your own text",
  hint: (max: number) =>
    `Up to ${max} buttons. An email button needs the email address; a link button needs the web address, and "${CARD_TEXT.custom}" uses your own text. Leave a button's email address, web address and own text empty to remove it.`,
} as const;

/** The owner's page around the cards (from apps/web/src/screens/Me.tsx and its message files). */
export const OWN_PAGE = {
  /** The tab's title when the page has no name to show (no display name, and a handle that did not verify). */
  title: "Your page",
  handleUnavailable: "We could not check your handle just now.",
  profileUnavailable: "We could not load your profile just now.",
  cardsIncomplete: "Some of your cards could not be loaded just now. Reload to try again.",
  cardsOverflow: "You have more cards than your page can show. Delete one to bring a hidden card back.",
  editProfile: "Edit profile",
  setUpEyebrow: "Not set up yet",
  setUpTitle: "Set up your profile",
  setUpBody: "Add your name, a headline, a place and a website with Edit profile. Then add cards to your page.",
} as const;

/** The name a card goes by in its controls and its delete confirm: its own title, else its kind's name. */
export function cardName(content: CardContent): string {
  switch (content.kind) {
    case "readme":
      return CARD_EDIT.readme;
    case "links":
      return content.title || ADD_CARD.links;
    case "collection":
      return content.title || ADD_CARD.collection;
    case "buttons":
      return content.heading || ADD_CARD.buttons;
  }
}

/** The Text card's formatting bar (P1.21u), shown above the rich editor once it has loaded. */
export const TEXT_EDITOR = {
  toolbar: "Formatting",
  strong: "Bold",
  emphasis: "Italic",
  code: "Code",
  heading: "Heading",
  paragraph: "Normal text",
  heading1: "Heading 1",
  heading2: "Heading 2",
  heading3: "Heading 3",
  bullets: "List",
  numbers: "Numbered list",
  quote: "Quote",
  codeBlock: "Code block",
  undo: "Undo",
  redo: "Redo",
} as const;

/** A Text card edited where it stands on the owner's page (ADR 0074 item 4). */
export const TEXT_IN_PLACE = {
  label: (name: string) => `Text of the ${name} card`,
  failed: "The editor could not load. Reload the page to edit here.",
} as const;

/** The in-place editor's side handle, block menu and floating bar (P1.21v slice 3), named as Crepe 7.23.0 names them. */
export const TEXT_MENUS = {
  add: "Add a block below",
  drag: "Drag to move, or press to change this block",
  blocks: "Blocks",
  /** The tabs above the block menu, one for each group. */
  tabs: "Block groups",
  groups: { text: "Text", list: "List", advanced: "Advanced" },
  bar: "Format the selected words",
  items: {
    text: "Text",
    heading1: "Heading 1",
    heading2: "Heading 2",
    heading3: "Heading 3",
    heading4: "Heading 4",
    heading5: "Heading 5",
    heading6: "Heading 6",
    quote: "Quote",
    divider: "Divider",
    bullets: "Bullet list",
    numbers: "Ordered list",
    tasks: "Task list",
    codeBlock: "Code",
    table: "Table",
  },
  format: { strong: "Bold", emphasis: "Italic", strike: "Strikethrough", code: "Inline code", link: "Link" },
  /** What an empty line with the caret says. */
  hint: "Type / to choose a block, Shift+Enter for a new one",
  /** The handles above a table's column and beside its row, and their menus (target-look decision 7). */
  table: {
    column: "Column options",
    row: "Row options",
    columnActions: {
      addLeft: "Add column left",
      addRight: "Add column right",
      alignLeft: "Align left",
      alignCenter: "Align centre",
      alignRight: "Align right",
      delete: "Delete column",
    },
    rowActions: { addAbove: "Add row above", addBelow: "Add row below", delete: "Delete row" },
  },
  link: {
    editor: "Link for the selected words",
    address: "Link address",
    placeholder: "Paste a link…",
    apply: "Apply link",
    refused: "Use an address that starts with https:// or http://",
    preview: "Link",
    copy: "Copy link",
    edit: "Edit link",
    remove: "Remove link",
  },
} as const;

/** The bar that holds the owner's unsaved changes (ADR 0074 item 4), and the drafts offered back when the page opens. */
export const UNSAVED_BAR = {
  label: "Unsaved changes",
  count: (cards: number) => (cards === 1 ? "1 card has unsaved changes." : `${cards} cards have unsaved changes.`),
  save: "Save",
  saving: "Saving…",
  discard: "Discard",
  saved: "Saved.",
  /** The Save did not reach the server, or its answer could not be read. */
  failed: "Your changes could not be saved just now. Check your connection and save again.",
  /** Bigger than the page's form can send at once. */
  tooLarge: "These changes are too large to save at once. Save fewer cards at a time.",
  drafts: (cards: number) =>
    cards === 1
      ? "This device kept unsaved words for 1 card from an earlier visit."
      : `This device kept unsaved words for ${cards} cards from an earlier visit.`,
  draftsLabel: "Unsaved words from an earlier visit",
  restore: "Bring them back",
  dropDrafts: "Throw them away",
} as const;

/** The small page anyone but the owner sees when a page is not shown to them (ADR 0078; Alex, 2026-11-20 19:46Z). */
export const LIMITED_PAGE = {
  signedIn: "This member shows their page to signed-in members only.",
  ownerOnly: "This member has chosen to keep their page private.",
  signIn: "Sign in",
  signUp: "Sign up",
} as const;

/** Above the whole page when it is not public, so the viewer knows who else sees it (ADR 0078). */
/** Above the member's own public page, seen by the member (own-public-view.svelte). */
export const OWN_PUBLIC_VIEW = {
  title: "This is how others see your page.",
  edit: "Edit your page",
} as const;

export const PAGE_AUDIENCE = {
  signedIn: "Only signed-in members see this page.",
  ownerOnly: "Only you see this page.",
} as const;
