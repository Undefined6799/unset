# Profile

**Status: drawn in Figma and shown to Alex 2026-10-23 (file 4hrOlzQ1d0lA8Acm4KyLVf, page Profile: v3 layout, v4
in-place editing, v5 draft box); not yet on the design sheet. Staging preview only until Alex approves it on the
sheet.**

A member's profile page and its owner editing. `ProfileView` draws the layout: a 296px left column (avatar, name,
handle, headline, place, website) beside the member's README, one column below 768px. The sheet's 296px avatar is
pending, so the kit's largest Avatar (128) stands in. `ProfileEditorSlot` places the same layout as the
`profile-editor` island on the owner's page.

## Owner editing (island)

- Hovering a field shows a 32px pencil (Iconoir `edit`); on touch screens (`hover: none`) it is always shown. The
  pencil, or a double-click on the field, edits it in place. What is typed goes on the draft at once; the field has
  no Save (Alex 2026-10-23). Enter (Ctrl/⌘+Enter in the README) or leaving the field closes it; Esc puts the field
  back as it was. One field edit is one undo step.
- The side column follows Alex's mock (2026-10-23 04:04Z): the avatar fills the column, then name, `@handle` with a
  `[ VERIFIED ]` Tag, headline, a full-width Copy link button (island only) and a DescriptionList of Location,
  Website and the short DID. Handle, tag and DID are never editable. Below them the member's own links (up to 12),
  each with the Iconoir `external` icon until site icons are on the sheet; the owner removes one with ×
  (`close`) and adds one with + (`add`), typed as `github.com/you`.
- Every change goes on a draft. Once there is one, a draft box (a note Callout with `shadow-1`) sits above the profile
  so the profile still looks like the published page. Its tools line up under "Draft": Revert (Iconoir `delete`),
  Undo and Redo (text until the Iconoir undo and redo icons are on the sheet; the shortcut shows after a 2s hover),
  View as a visitor (Iconoir `show`, pressed while on, hides the pencils) and Save.
- Save posts the plain form to `POST /profile` (a literal, never a prop). A failure keeps the draft and says why.
- With no script, and before hydration, it is exactly `ProfileView`: no pencils, no draft box.

## Provide

- `handle`, `handleUnavailable`, `fields` (display name, headline, place, website, README: already checked by
  `domains/profile`), and `labels`: the page's copy, so it travels as island props.
