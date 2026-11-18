// Copied from apps/web/src/screens/profile/messages.ts for the Svelte page (P1.20i); that copy goes with P1.20k.
// The words a profile card shows that the member does not write (ADR 0051 decision 4: button text comes from the
// preset). English first (plan: English, then French).
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
} as const;

/** The single Add picker (the profile-card mockup). */
export const ADD_CARD = {
  trigger: "Add card",
  title: "Add a card",
  description: "Choose what the new card holds. You can change its width and order later.",
  readme: "README",
  readmeBlurb: "Your own text, with headings, lists, links, quotes and code.",
  links: "Links",
  linksBlurb: "Your sites and accounts elsewhere, as a list, grid or carousel.",
  collection: "Collection",
  collectionBlurb: "Projects, releases or anything else, each with a tag and a description.",
  buttons: "Contact",
  buttonsBlurb: (max: number) => `Up to ${max} buttons: email me, book a call, hire me, subscribe or your own.`,
} as const;

/** The avatar's editor (sh.unset.profile avatarShape). */
export const AVATAR_EDIT = {
  trigger: "Change profile picture",
  change: "Change",
  title: "Profile picture",
  description: "Uploading a picture comes later. For now you can choose the shape it is shown in.",
  shape: "Shape",
  round: "Round",
  roundedSquare: "Rounded square",
  save: "Save",
  cancel: "Cancel",
  refused: "Your profile could not be saved.",
} as const;

/** The side column's labels (the profile-card mockup, Alex 2026-11-17). */
export const PROFILE_SIDE = {
  place: "Place",
  web: "Web",
  did: "DID",
  edit: "Edit profile",
} as const;

/** The owner's card controls (ADR 0051). */
export const CARD_EDIT = {
  group: (name: string) => `${name} card`,
  edit: "Edit",
  editReadme: "Edit README",
  addReadme: "Add README",
  readme: "README",
  readmeHint: "Markdown: headings, lists, links, code and quotes.",
  save: "Save",
  add: "Add",
  cancel: "Cancel",
  up: "Move up",
  down: "Move down",
  remove: "Delete",
  removeTitle: "Delete this card?",
  removeBody: "It leaves your page and your sign-in server. This cannot be undone.",
  width: "Width",
  full: "Full width",
  half: "Half width",
  /** A refused save whose answer carried no catalog message. */
  refused: "That card could not be saved.",
  /** A refusal shown beside the field it blames, by its code; any other code shows the catalog message there. */
  fieldError: {
    "card.required": "Fill this in.",
    "card.url_invalid": "Use an http or https address, such as https://example.com.",
    "card.email_invalid": "That email address does not look right.",
    "card.too_long": "This is too long. Shorten it and save again.",
    "card.invalid": "This could not be read. Check it and save again.",
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
  uri: "Address",
  label: "Label",
  description: "Description",
  hint: (max: number) =>
    `Up to ${max} links. Leave a link's fields empty to remove it; save and edit again for more rows.`,
} as const;

export const COLLECTION_EDIT = {
  add: "Add collection",
  editTitle: "Edit collection",
  title: "Title",
  row: (n: number) => `Entry ${n}`,
  entryTitle: "Title",
  tag: "Tag",
  description: "Description",
  uri: "Address",
  hint: (max: number) =>
    `Up to ${max} entries. Leave an entry's fields empty to remove it; save and edit again for more rows.`,
} as const;

export const BUTTONS_EDIT = {
  add: "Add buttons",
  editTitle: "Edit buttons",
  heading: "Heading",
  text: "Text",
  row: (n: number) => `Button ${n}`,
  kind: "Opens",
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
  privacyNoticeTitle: "Privacy notice",
  privacyNotice: "The privacy notice has changed.",
  handleUnavailable: "We could not check your handle just now.",
  profileUnavailable: "We could not load your profile just now.",
  cardsIncomplete: "Some of your cards could not be loaded just now. Reload to try again.",
  editProfile: "Edit profile",
  setUpEyebrow: "Not set up yet",
  setUpTitle: "Set up your profile",
  setUpBody:
    "Your name, bio, picture and sections will be edited here. The editor is not ready yet, and your profile stays private until you publish it.",
} as const;
