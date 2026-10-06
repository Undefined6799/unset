# Modal

Level 4: a dialog on `ground` with a 1px `ink` border, over the `scrim`. No shadow: the tinted backdrop is what lifts it.

## Provide

- `open` and `onClose()`; `title`; `children` (one or two sentences, or a small form); `actions` (a standalone Link to cancel, then one Button to confirm).
- `tone: "danger"` for irreversible actions (announced as an alert dialog); `dismissable={false}` to stop a backdrop click from closing it.

## Use

- One modal at a time, max 440px wide, `space-6` padding.
- Title says the question ("Wipe nas-01?"); the body says the consequence; the confirm button repeats the verb ("Wipe node").
- Focus moves into the modal when it opens, Tab stays inside, Esc closes it, and focus returns to what opened it.
- It renders at the top of the page (a portal on `document.body`), so no parent can clip it, and the page behind stops scrolling while it's open.
