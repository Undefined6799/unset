# Profile

**Status: drawn in Figma and shown to Alex 2026-10-23 (file 4hrOlzQ1d0lA8Acm4KyLVf, page Profile: v3 layout, v4
in-place editing, v5 draft box); not yet on the design sheet. Staging preview only until Alex approves it on the
sheet.**

A member's profile page and its owner editing. `ProfileView` draws the layout: a 296px left column (avatar, name,
handle, headline, place, website) beside the member's README, one column below 768px. The sheet's 296px avatar is
pending, so the kit's largest Avatar (128) stands in. The owner page passes `readmeEditor` to draw `ReadmeForm`;
the app's separate editor chunk opens it in place.

## Owner editing

- Hovering the README shows a 32px pencil (Iconoir `edit`); on touch screens (`hover: none`) it is always shown. The
  pencil or a double-click on the README opens the editor and focuses its text. Below 768px, the pencil becomes a
  visible 44px control above the README, inside the page rather than in the missing column gap.
- The side column follows Alex's mock (2026-10-23 04:04Z): the avatar fills the column, then name, `@handle` with a
  `[ VERIFIED ]` Tag, headline and a DescriptionList of Location, Website and the short DID. Handle, tag and DID
  are never editable. Below them the member's own links (up to 12), each with the Iconoir `external` icon until
  site icons are on the sheet. The side column is edited in Settings › Profile; the page edits only the README.
- Save changes and Cancel use the existing Button styles in a sticky row above the open editor. An unsaved status
  appears only when the normalized document differs from the one opened; restoring that content clears it.
- Cancel closes an unchanged editor immediately. With changes, it asks for confirmation first; accepting restores
  the displayed README and returns focus to the pencil. Declining keeps the editor and its content open.
- Save serializes the document into the form and makes the existing native `POST /profile/readme`. It writes to
  the profile through the current server route; there is no autosave or durable draft in this flow.
- A browser `beforeunload` warning protects changed content from ordinary navigation, reload or tab close; the
  deliberate Save submission proceeds without it. Browsers choose the warning text and may omit the event when a
  mobile app is terminated. This is not crash recovery or recovery after a failed form navigation.
- With no script, the pencil and editing actions stay hidden and the README remains readable.

## Provide

- `handle`, `handleUnavailable`, `fields` (display name, headline, place, website, links, README: already checked by
  `domains/profile`), and `labels`: the page's copy.
- Optional `readmeEditor`: the stored editor document and localized editing, discard and unsaved-status labels.
