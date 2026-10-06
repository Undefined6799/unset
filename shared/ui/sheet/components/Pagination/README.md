# Pagination

Links to move between pages of a long list: `← prev  1 … 4 5 6 … 12  next →` in the `label` style, the current page in `ink` with the Tabs' 2px `ink` underline; or just `← newer` / `older →` for cursor lists like followers and search.

Approved by Alex 2026-10-04, for lists that aren't feeds.

## Provide

- Numbered: `page`, `pages`, `hrefFor(n)` (default `?page=n`).
- Cursor (no total known): `newer` and/or `older` hrefs, the server's cursors, for lists like followers and search results. Feeds don't use Pagination: they scroll endlessly with NewPosts and FeedMore (Alex, 2026-10-04).
- `label` (optional): the nav's accessible name, default "Pages".

## Use

- Plain links in a `<nav>`, so it works with no JavaScript and every page has its own address.
- Shows the first page, the last, and one on each side of the current one; gaps print …
- Each link is at least 40×40px. The current page carries `aria-current="page"`.
- At an end, prev or next stays in place but greys to `line-strong` and is not a link, so the row doesn't jump.
- When the space is 440px or narrower, the numbers fold to `5 / 12` between prev and next.
- Arrows are hidden from screen readers; the words say it.
