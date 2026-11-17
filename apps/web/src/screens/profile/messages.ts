// The words a profile card shows that the member does not write (ADR 0051 decision 4: button text comes from the
// preset). English first (plan: English, then French).
export const CARD_TEXT = {
  email: "Email me",
  bookCall: "Book a call",
  hire: "Hire me",
  subscribe: "Subscribe",
  custom: "Open link",
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
  noScript: "Adding, editing or deleting a card needs JavaScript. Moving one does not.",
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
