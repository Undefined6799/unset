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
  noScript: "Adding, editing or deleting a card needs JavaScript. Moving one does not.",
} as const;
