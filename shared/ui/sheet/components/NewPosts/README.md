# NewPosts

A status bar that slides in under the header when newer posts are waiting: `[info] 3 new posts` on the left, `SHOW ↑` on the right, written like a terminal line (Alex chose the status bar over a pill, 2026-10-04). Part of the endless feed (Alex chose endless scroll for feeds, 2026-10-04).

Approved by Alex 2026-10-04.

## Provide

- `count`: how many are waiting; the text reads "1 new post" or "3 new posts", "99+ new posts" above 99.
- `href`: the feed's own address, so with no script SHOW simply reloads the feed at the top.
- `onClick` (optional): the feed script scrolls to the top.
- `hidden`: set by the feed script while the person scrolls up.

## Behaviour (Alex, 2026-10-04)

- New posts never push the feed down on their own: what you are reading stays put.
- The bar shows while you read further down. As soon as you scroll up, it slides away.
- When you reach the top of the feed, the feed reloads in place and the new posts appear at the top. No tap needed.
- SHOW does the same in one step: it scrolls to the top and loads them.
- At the top already, new posts simply load; the bar never appears there.

## Use

- Sits just outside the `feed` element (the feed holds only posts). Full width, sticky right under the header (`z-sticky`), on `surface-raised` with a 1px `line-strong` rule underneath, like the Toast's level 3 edge. At least 44px tall; SHOW is a 40px target.
- `[info]` is the Tag in `link`; the rest is `ink` in `mono` 14px; SHOW is the `label` style with the `up` Icon.
- Slides up 160ms when it hides; no slide with reduced motion.
- Screen readers hear "3 new posts" once through the feed's polite live region, not on every count change, and again "3 new posts loaded" when they appear at the top. Focus never moves on its own.
