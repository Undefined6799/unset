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

`+layout.ts` sets `csr` to false ([SvelteKit page options](https://svelte.dev/docs/kit/page-options#csr)). A page ships no client script unless its own `+page.ts` sets `csr` to true. The same load passes through an `?error=` code only when it is a catalog code.

The site shell is a skip link, a header with the wordmark and Sign in, the main region and a footer. A signed-in member sees no Sign in button. The footer lists Home, Sign in, and the legal links (terms, privacy, domains). When `prefs` is set it also holds the theme form. The welcome steps use this shell, signed in.

The core shell is a skip link, a two-row header, the main region and a footer. The first header row is the menu button and the wordmark, then the action buttons and the account control. The menu panel lists Saved, Your communities and Help, each marked coming soon. Create opens a panel whose one working row is Add a profile card. The second row is the destinations: Home is a link, and Community and Explore are marked coming soon. A member's account menu lists Your profile, Settings, the theme picker when `prefs` is set, and Sign out. A visitor's account control is a Sign in link. Home, the member's own page, the public profile, settings, the legal pages and the confirm-email page use this shell.

The bare shell is the main region alone, centred. The sign-in page uses it.

The site and core headers stick to the top of the page as it scrolls. Each has a fixed height, which [`apps/web/app.css`](../../../apps/web/app.css) names as `--site-header-height`. The page's `scroll-padding-top` uses it, so an anchor lands below the header, and a bar that sticks under the header uses `top: var(--site-header-height)`. [`tests/e2e/sticky-header.spec.ts`](../../../tests/e2e/sticky-header.spec.ts) holds the drawn height and the variable equal.

The theme form posts to `/prefs/theme`. Sign out posts to `/logout`. A changed privacy notice is a banner whose dismiss form posts to `/privacy-notice/seen`.

## UI pieces

Buttons, alerts and the other controls are the stock shadcn-svelte components in [`apps/web/lib/components/ui`](../../../apps/web/lib/components/ui). [`apps/web/app.css`](../../../apps/web/app.css) imports [`shared/ui/theme.css`](../../../shared/ui/theme.css), the one theme file ([ADR 0055](../decisions/0055-shadcn-svelte-and-one-theme-file.md)). Icons are drawn by [`apps/web/lib/components/icon`](../../../apps/web/lib/components/icon).

## Routing and gates

Each route folder has a `policy.ts`. [`interfaces/web/src/lib/server/route-table.ts`](../../../interfaces/web/src/lib/server/route-table.ts) gathers them at build time, and [`interfaces/web/src/hooks.server.ts`](../../../interfaces/web/src/hooks.server.ts) applies the row for the request. A route with no `policy.ts` is refused: the hook answers `internal.error` (500). A path that matches no route uses the `UNMATCHED` policy in `route-table.ts`. [`tests/integration/web/gate.test.ts`](../../../tests/integration/web/gate.test.ts) checks that every route folder has a policy.

## Menus, scrolling and a page with no script

Each header menu is a `popover="auto"` element, with a title and a Close button. It opens with no script, and closes on Close, a click outside or Escape ([HTML popover](https://html.spec.whatwg.org/multipage/popover.html)).

The page scrolls as one document. The header and main share a column with `min-h-svh`, and the footer follows that column, so the footer starts below the first screen.

Below the `sm` breakpoint the search field and the Create, Messages and Notifications buttons are hidden. A search button and a More actions button take their place and open the same panels. On a coarse pointer the icon controls use a larger target (`pointer-coarse:size-11`). The Notifications button carries the unread count, and so does More actions on a phone ([notifications](notifications.md)).

Links, forms and these popovers work with no script. The member's own page, settings, the welcome steps, confirm-email, the invite page and the signed-out page set `csr` to true and add the client on top. The theme picker then saves in place and leaves the menu open. The form still posts when that save does not come back as the usual redirect.
