# Reading a page

These are the rules an app follows to show someone's page. They come from the lexicons' own field descriptions,
gathered in one place. Following them is what makes a page look the same, and stay safe, in every app.

## What to fetch

1. **The profile.** `sh.unset.profile`, record key `self`, from the account's repository. If there is none,
   show nothing: the account does not use unset.sh, or has removed itself.
2. **The main page.** `sh.unset.page`, record key `self`. If there is none, show the profile's header with no
   cards, to everyone.
3. **Only the main page, for now.** An account may hold pages under other record keys. Show none of them until
   you know where they go; skip them without treating them as broken.

## Which cards show

1. **Only listed cards show.** Walk the page's `cards` in order. A card that exists in the repository but is not
   in the list is not shown on that page.
2. **Only the account's own cards count.** Accept an entry only if its `uri` is the address of an `sh.unset.card`
   record in the page's own repository, written with that account's DID:
   `at://<the account's DID>/sh.unset.card/<record key>`. Compare it as text. Never resolve a handle to decide.
   Skip any other entry: a handle-form address, another account, another kind of record.
3. **Skip what is missing.** An entry whose card no longer exists is skipped.
4. **Show a repeat once.** A card named more than once is shown once, at its first place.
5. **Hide what is empty or unknown.** A block with nothing to show, such as an empty list, is hidden. A card whose
   block type you do not know is hidden too. Neither is an error.

## Who sees the page

The page's `visibility` asks apps to limit who they show the page to.

| Value | Show the page to |
| --- | --- |
| absent, or `public` | Everyone |
| `signed-in` | People signed in to your app |
| `owner-only` | Only the account itself |
| any other value | Treat as `owner-only` |

Apply the same answer to the page's cards. The main page's choice is the account's: apply it also to the profile's
details shown with the page, and wherever you show the account outside the page, such as a directory or search.

This is a request to apps, **not access control**. The records stay public on the network, and an app that
ignores the field can still read them. Do not tell a person their page is private.

The profile's `listed` is separate: `true` asks directories to list the account. Absent or `false` means it is
not listed, though its pages are still reachable at their addresses.

## Unknown values

Fields such as `width`, `surface`, `layout`, `fit`, `preset` and `avatarShape` name known values but accept any
string, so new values can be added later. Each field's description says what an absent or unknown value means,
for example "absent or unknown means full". Follow that default and never reject the record.

## Showing content safely

Everything in a record was written by someone else. Before showing it:

- **Links.** Keep only `http` and `https` URLs. Ignore any other scheme.
- **Text.** The text block is Markdown. Never render raw HTML from it, and keep only `http` and `https` links.
  Show syntax you do not support as plain text.
- **Pictures.** Never hand a blob to a browser as it is. Check its real type and re-encode it first; the declared
  type may be wrong. Decide how to show a picture linked from Markdown yourself, for example as a plain link, or
  loaded through your own proxy so the picture's host never learns who is reading.
- **Email buttons.** Check that the address is a single plain address before building a `mailto:` link.
- **Link icons and site names.** Take them from your own list of known sites. Never fetch the linked site to find
  them.
- **Proportions.** `aspectRatio` may be approximate. Clamp extreme values.

## Fields you do not know

A record may carry fields your copy of the lexicon does not define, because the lexicons grow. Ignore them when
reading. If you edit and save a record, keep them, so you do not erase data a newer app wrote.

## Related

- [`sh.unset.profile`](lexicons/profile.md), [`sh.unset.page`](lexicons/page.md) and
  [`sh.unset.card`](lexicons/card.md)
- [Quick start](quick-start.md)
