# Icon

One icon from a closed list of 36, drawn with Iconoir's regular set (1.5 stroke, in the text colour), hidden from screen readers with its meaning given as hidden text beside it.

**Approved by Alex 2026-10-03** (Iconoir chosen for all icons for consistency; the list of 36 approved at 18:02Z).

## Source

Iconoir 7.12.1, MIT licence (© 2021 Luca Burgio). The 36 drawings are copied into the kit as data at that pinned version; no icon package is installed and no icon is fetched from anywhere. Adding an icon means adding it here first, with approval.

## The list

| Name | Iconoir icon | Means |
| --- | --- | --- |
| `next` | `arrow-right` | go on, open, the end of a Button or standalone Link |
| `back` | `arrow-left` | go back, previous |
| `up` | `arrow-up` | move up |
| `down` | `arrow-down` | move down |
| `external` | `open-new-window` | leaves unset.sh for another site |
| `open` | `nav-arrow-down` | opens a menu or list |
| `collapse` | `nav-arrow-up` | closes an open menu or section |
| `close` | `xmark` | close, dismiss, remove from a list |
| `add` | `plus` | add or create |
| `remove` | `minus` | take one away |
| `done` | `check` | done, selected, copied |
| `warning` | `warning-triangle` | needs care (always beside a word; neutral colour) |
| `info` | `info-circle` | more about this |
| `more` | `more-horiz` | more actions |
| `menu` | `menu` | the site menu |
| `home` | `home` | home |
| `profile` | `user` | your profile |
| `search` | `search` | search |
| `notifications` | `bell` | notifications |
| `settings` | `settings` | settings |
| `like` | `heart` | like |
| `comment` | `chat-bubble` | comment |
| `repost` | `repeat` | repost |
| `share` | `share-android` | share |
| `reply` | `reply` | reply |
| `edit` | `edit-pencil` | edit |
| `copy` | `copy` | copy |
| `delete` | `trash` | delete |
| `upload` | `upload` | upload a file |
| `download` | `download` | download a file |
| `play` | `play` | play |
| `pause` | `pause` | pause |
| `show` | `eye` | show |
| `hide` | `eye-closed` | hide |
| `private` | `lock` | private, only you |
| `signout` | `log-out` | sign out |

## Provide

- `name`: one of the names above.
- `size`: 20 (default), 16 inside small text (pagination, toast close), or 24 on its own in a bar.
- `label` (optional): what the icon means, read by screen readers ("Like"). Leave it out only when a visible word beside it already says it.

## Use

- Always in the text colour around it (`currentColor`); never filled, never a second colour. Liked, selected and active states change the colour of the icon and its count together, and pair with a word or a count, so state is never colour alone.
- An icon-only control is a 40×40px target with the 20px icon centred, and always has a `label`.
- The icon is always `aria-hidden`; meaning goes in hidden text, never `role="img"`.
- Status words stay bracketed text (`[ok]`, `[err]`), and checkboxes, radios, the on/off switch, progress and the spinner stay drawn as text: those are controls, not icons.
- Never emoji.
