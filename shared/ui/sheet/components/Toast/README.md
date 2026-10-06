# Toast

A short status line that pops up at the bottom of the screen after something happens, `[ok] profile saved`, on a level 3 surface (`ground`, 1px `line-strong`, `shadow-menu`).

**Approved by Alex 2026-10-03** (no timer).

## Provide

- `tone`: `ok` (default), `err` or `info`; it picks the Tag word in front.
- `children`: one short line, lowercase, no full stop: "profile saved", "copied", "couldn't save, try again".
- `onClose` (optional): shows a ✕ button (24px target, hidden label "Dismiss").

## Use

- Bottom centre, `space-4` from the edges, at most 440px wide, above everything (`z-toast`, even over a Modal).
- One at a time: a new one replaces the old one.
- It never disappears on a timer, so nobody misses it: it stays until closed or until the next page.
- The page always has the empty region in it from the start, so screen readers announce what appears (`role="status"`, polite). An `err` toast is `role="alert"`.
- Works with no JavaScript: after a form post, the server prints the toast into the next page.
- Only for confirming what the person just did. Anything they must act on is a Callout on the page; anything that asks a question is a Modal.
