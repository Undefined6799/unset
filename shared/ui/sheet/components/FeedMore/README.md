# FeedMore

The bottom of an endless feed. Older posts load by themselves as you scroll near it, like Instagram and Facebook (Alex chose endless scroll for feeds, 2026-10-04).

Approved by Alex 2026-10-04.

## Provide

- `older`: the server's cursor link to the next batch.
- `state`: `idle` (the link), `loading`, `end` or `error`; the feed script sets it.
- `onRetry` (optional), and `loadingText`, `endText`, `errorText` to change the words.

## States

- `idle`: an `OLDER POSTS` link with the `down` Icon. With no script this is a normal link to the next page, so the feed still works; with the script, it loads the next batch in place when it comes within about one screen of view.
- `loading`: the text Spinner, "loading older posts".
- `end`: `[end] you're all caught up`.
- `error`: `[err] couldn't load more` and a `try again` link. It never retries in a loop on its own.

## Use

- Feeds only (home, profile posts, tag feeds). Admin lists keep numbered Pagination.
- The feed uses the ARIA `feed` role: each post is an `article` with `aria-posinset` and `aria-setsize="-1"` (the total is unknown), and the feed is `aria-busy` while a batch loads, so screen readers announce posts as they arrive.
- Each batch's cursor goes in the address (`history.replaceState`), so Back returns to the same place in the feed.
- No footer under an endless feed: its links move into the menu on feed pages, so nothing is out of reach.
- Keyboard: Tab moves through posts in order; loading never steals focus.
- Batches stay inside the plan's limits: one request per batch, no prefetching beyond the next one.
