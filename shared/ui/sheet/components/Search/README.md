# Search

Approved by Alex 2026-10-21 ("perfect"; earlier: "a mix between A C D", "good with the / key", "find more on unset", Enter searches unset and Ctrl/Cmd+Enter searches the web). One bar for people, posts and the web.

- **At rest:** filled with `surface-raised`, no edge, 4px corners (`radius-sm`), 40px tall like Input. The `search` Icon on the left, the placeholder "search people, posts and the web" in `ink-muted`, and a `/` Kbd on the right.
- **Hover:** a 1px `line-strong` edge appears.
- **Focus** (click, or press `/` anywhere outside a text field): the edge plus the 2px `focus` outline offset 2px. The `/` hint hides while focused, and on touch screens.
- **Typing:** a `close` Icon button clears the text, and the results open 4px below as a level-3 menu (`ground`, 1px `line-strong`, `radius-sm`, `shadow-menu`, `z-menu`):
  1. **On unset:** profiles and tags, each with a `mono` 12px `ink-muted` kind on the right, then the row "→ more on unset" with a `↵` key on the right.
  2. **Web:** a few results from our SearXNG (page title, domain on the right).
  3. The closing row "↗ search the web for "…"" with `ctrl` `↵` keys on the right (`⌘` `↵` on a Mac).
  The hovered or keyboard-active row fills `line`.

## Provide

- `value` + `onChange(query)` or `defaultValue`; `groups` (each `{ label, items, more? }`; `more.search: true` makes it the Enter row); `onPick(row)`; `onSearch(query)` for Enter; `onSearchWeb(query)` for Ctrl/Cmd+Enter.
- `shortcut={false}` to turn the `/` key off (only one Search per page should own it).

## Use

- One per page, in the Header or at the top of a search page.
- Keyboard: Enter searches unset for the text; Ctrl+Enter (⌘+Enter on a Mac) searches the web. ↓ / ↑ move through the rows, and Enter then opens the arrowed row instead. Esc closes the list, a second Esc clears the text. Nothing is highlighted until you arrow down, so a plain Enter always means "search unset".
- Web results are fetched by our server through `net-guard`, never by the browser, so a person's searches never go to a search engine from their device. Web links open through `safeHref`.
- Built as a WAI-ARIA combobox: the input keeps focus and announces the active row.
