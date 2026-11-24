# Core app shell

Every page is drawn by the SvelteKit root layout. A page's load returns `shell`, a `ShellData` value from [`interfaces/web/src/lib/shell.ts`](../../../interfaces/web/src/lib/shell.ts). A page that returns none gets the site shell. An error page gets the core shell. A signed-in member who is still in onboarding, or whose account row could not be read, gets the site shell on that error page instead.

The layout files are [`interfaces/web/src/routes/+layout.svelte`](../../../interfaces/web/src/routes/+layout.svelte), [`+layout.server.ts`](../../../interfaces/web/src/routes/+layout.server.ts) and [`+layout.ts`](../../../interfaces/web/src/routes/+layout.ts). The server load does not open a session. It reports what the request gate already decided (whether a member is signed in, that member's account path and name, the privacy-notice banner and the Sign in link) and reads the theme cookie for the theme form.

## What a page tells the shell

`ShellData` is display state.

- `kind` is `site`, `core` or `bare`.
- `active` is `home`, `account` or `settings`, the current destination.
- `account` is the profile path and, when the name is known, the name in the account menu. The button's letter is `accountLetter`: the first character of that name, with a leading `@` removed, in upper case. An empty name is `?`. With no name the button is the profile icon.
- `prefs` is the theme (`dark`, `light` or `system`) and the path the theme form returns to.
- `signedIn` hides Sign in on the site shell.
- `hiddenHeading` is a heading only assistive technology reads. Home sets it to "Home".
- `noindex` adds a robots meta element. The page sets the `X-Robots-Tag` header itself. With `SEARCH_LISTING` off ([public indexing](public-indexing.md)), the root layout adds the element to every page and `server.ts` sends the header on every response.
- `wide` makes the main region full width, for the member page and the public profile.

## The three shells

`+layout.ts` sets `csr` to true ([SvelteKit page options](https://svelte.dev/docs/kit/page-options#csr)), so every page SvelteKit draws runs the client, the error page included ([ADR 0116](../decisions/0116-every-page-runs-our-script-the-error-page-included.md)). Every page still says in its own `+page.ts` whether it runs the client; the layout's value decides the error page alone, for an address no route matches and for a load that failed. A page that does not run it says `csr = false` there and `client: false` in its `policy.ts`, which keeps the script policy off its page; `gate.test.ts` names every such page with its reason and fails when the two disagree. Today those are three routes nobody reads: `/login/continue`, the hop to the sign-in server, which must not wait for a script file, and two form targets with no screen (`/prefs/theme`, `/privacy-notice/seen`). Home, the legal pages and the invite request run the client since book P1.22g, and the sign-in, join and welcome pages since book P1.22l. `tests/integration/web/every-answer.test.ts` names every route and pins the script policy of every answer by value, so a route nobody named fails. The gate's refusal page and SvelteKit's last-resort `error.html` are not pages SvelteKit draws and carry no script. The error page's start-up script holds nothing from the request: the Sign in link's and the theme form's way back are worked out from the page's own address (`src/lib/return-paths.ts`) and checked by the server when they are used. The same load passes through an `?error=` code only when it is a catalog code.

The site shell is a skip link, a header with the wordmark and Sign in, the main region and a footer. A signed-in member sees no Sign in button. The footer lists Home, Sign in, and the legal links (terms, privacy, domains). When `prefs` is set it also holds the theme form. The welcome steps use this shell, signed in.

The core shell is a skip link, a two-row header, the main region and a footer. The first header row is the menu button and the wordmark, then the action buttons and the account control. The menu panel lists Saved, Your communities and Help, each marked coming soon. Create opens a panel whose one working row is Add a profile card. The second row is the destinations: Home is a link, and Community and Explore are marked coming soon. The bell is the one control the client takes over ([ADR 0116](../decisions/0116-every-page-runs-our-script-the-error-page-included.md) points 8 and 9): the server draws it as a plain link to `/notifications`, in the header and in More actions, and once the client has started it is the button of a panel the client draws, on every page the client runs on, the error page included. With no script, or before the client is ready, a press follows the link. A member's account menu lists Your profile, Settings, the theme picker when `prefs` is set, and Sign out. A visitor's account control is a Sign in link. Home, the member's own page, the public profile, settings, the legal pages and the confirm-email page use this shell.

The bare shell is the main region alone, centred. The sign-in page uses it.

The site and core headers stick to the top of the page as it scrolls. Each has a fixed height, which [`apps/web/app.css`](../../../apps/web/app.css) names as `--site-header-height`. The page's `scroll-padding-top` uses it, so an anchor lands below the header, and a bar that sticks under the header uses `top: var(--site-header-height)`. [`tests/e2e/sticky-header.spec.ts`](../../../tests/e2e/sticky-header.spec.ts) holds the drawn height and the variable equal.

The theme form posts to `/prefs/theme`. Sign out posts to `/logout`. A changed privacy notice is a banner whose dismiss form posts to `/privacy-notice/seen`.

## UI pieces

Buttons, alerts and the other controls are the stock shadcn-svelte components in [`apps/web/lib/components/ui`](../../../apps/web/lib/components/ui). [`apps/web/app.css`](../../../apps/web/app.css) imports [`shared/ui/theme.css`](../../../shared/ui/theme.css), the one theme file ([ADR 0055](../decisions/0055-shadcn-svelte-and-one-theme-file.md)). Icons are drawn by [`apps/web/lib/components/icon`](../../../apps/web/lib/components/icon).

## Routing and gates

Each route folder has a `policy.ts`. [`interfaces/web/src/lib/server/route-table.ts`](../../../interfaces/web/src/lib/server/route-table.ts) gathers them at build time, and [`interfaces/web/src/hooks.server.ts`](../../../interfaces/web/src/hooks.server.ts) applies the row for the request. A route with no `policy.ts` is refused: the hook answers `internal.error` (500). A path that matches no route uses the `UNMATCHED` policy in `route-table.ts`. [`tests/integration/web/gate.test.ts`](../../../tests/integration/web/gate.test.ts) checks that every route folder has a policy.

## Menus, scrolling and a page with no script

Each header menu is a `popover="auto"` element, with a title and a Close button. It opens with no script, and closes on Close, a click outside or Escape ([HTML popover](https://html.spec.whatwg.org/multipage/popover.html)).

With script, a header menu becomes the stock component once the client has started ([ADR 0116](../decisions/0116-every-page-runs-our-script-the-error-page-included.md) points 8 and 9; step P1.22m). The account menu is the first: the stock Dropdown Menu ([`apps/web/lib/components/shell/account-menu.svelte`](../../../apps/web/lib/components/shell/account-menu.svelte)), with arrow keys, Home and End, a letter to jump to a row, Escape, and focus back on its button. Its rows do what the native menu's do: two links, the theme choices, and Sign out, which posts the same form. The three-line menu and the Create menu are the second ([`header-menu.svelte`](../../../apps/web/lib/components/shell/header-menu.svelte)): a row whose feature is coming is a disabled menu item that says so and the keys skip it, and a row that runs today is a link. The panels are the third ([`header-panel.svelte`](../../../apps/web/lib/components/shell/header-panel.svelte)): Messages, the bell's panel and Search on a phone are the stock Popover, a dialog named by its title that holds focus while it is open, with the title row and Close button the native panel has. The bell is the server's link to its page until the stock panel is ready, and then its button; opening the panel posts the same mark the page's visit does. On a phone Create, Messages and the bell are rows of More actions, which is still a native popover, so those three native panels stay for it. Three things hold for every control moved this way:

- The layout loads the stock menus after the client starts, in one file ([`shell/index.ts`](../../../apps/web/lib/components/shell/index.ts)), on every page with this header, for a visitor too. So no page's first load carries the library's menu code. Until the file is in, and if it never arrives, the native popover stays and works.
- A press the native menu took is not lost. A menu opened before the client has started is not closed when it starts. A menu found open stays open as the stock one, and focus on its button stays on the button; focus on the bell's link is on the bell's button.
- The row under the pointer or the keys is drawn with the muted colour, because the theme's accent colour is the menu's own surface.

The page scrolls as one document. The header and main share a column with `min-h-svh`, and the footer follows that column, so the footer starts below the first screen.

Below the `sm` breakpoint the search field and the Create, Messages and Notifications buttons are hidden. A search button and a More actions button take their place and open the same panels. On a coarse pointer the icon controls use a larger target (`pointer-coarse:size-11`). The Notifications button carries the unread count, and so does More actions on a phone ([notifications](notifications.md)).

The page without script is the floor, not the ceiling ([ADR 0114](../decisions/0114-script-on-every-page-with-a-plain-fallback.md) points 5 and 6). The server draws every page whole, and it stays usable when the browser runs no script or a script file does not arrive: everything can be read, and everything a person can do there can be done through a plain link or form. The fallback may be plainer than the scripted page, and no feature is thinned to match it. Where a stock control needs script, use it and give the page a plain fallback; a feature that cannot work without script says so on the page.

Links, forms and these popovers work with no script. Every page a person reads sets `csr` to true and adds the client on top, and so does the error page, through the root layout. The theme picker then saves in place and leaves the menu open. A link the client follows in place keeps the document, so the layout then gives it the theme a full load of the new page would have: the system's on a page every visitor shares, the saved choice on a page with the theme form. The form still posts when that save does not come back as the usual redirect.
