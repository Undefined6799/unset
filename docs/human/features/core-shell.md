# Core app shell

The app uses the approved [core shell design](https://www.figma.com/design/4hrOlzQ1d0lA8Acm4KyLVf?node-id=135-806)
(Figma 135:806, 135:858, 135:935 and the theme picker 151:939, the frames named in
`shared/ui/components/Navigation/Navigation.tsx`) on home, the account page and Settings (profile and
account). The homepage's main region has no visible content: its only element is a visually hidden
Home heading. On desktop, `NavigationMenuButton` before the logo opens the left drawer. On phones (up
to 767px) the floating bar's menu button opens the same drawer; the bar also holds home and the account
avatar. The drawer's head is the mark linking home, with a Close button; its list is home, profile
and settings. The account and settings
pages also include this browser's sign-out and the theme picker. The public homepage includes neither:
it passes no account path and no preferences. The drawer is a native `popover="auto"`, so Close, a click
outside and Escape work without JavaScript. The floating bar hides while the drawer is open. Drawer rows
show their labels, and the phone bar uses accessible names.

On screen, the main region scrolls inside a fixed height: the viewport minus 64px, and on phones also
minus 116px and `max(20px, env(safe-area-inset-bottom))`. This keeps keyboard-focused controls visible
even in short or zoomed phone viewports; padding below a fixed bar alone does not provide that
guarantee. Print keeps normal document flow, because those height and overflow rules apply only inside
`@media screen`. To check it, open the account page at 390×320 and 320×400 and traverse the controls
with Tab and Shift+Tab: the privacy-notice link when the banner shows it, the sign-in server link when
the page shows it, and the account page's sign-out in the main region must remain clear of the header
and the floating bar. The skip link must focus the main region with its heading visible.

`apps/web/src/shell/AppShell.tsx` chooses destinations and composes the layout.
`shared/ui/components/Navigation/` owns reusable navigation, using the existing Avatar, Icon, Mark,
tokens and native browser popover controls. The existing Header provides a compact brand-only mode and,
on desktop, the menu button in its start slot. CSS stays in the components and screens cascade layers.
The drawer's theme picker is an island (`theme-picker`, `shared/ui/islands/theme-picker.island.tsx`),
mounted by `ThemePickerSlot` and hydrated on the account and settings pages, which leave islands on.
Home sets islands off and renders no picker. No new dependency, business rule or data source is
introduced.

The HTTP routes pass display state through `PageSpec` and `ShellOptions`. The account route passes the
shell an avatar name only when the handle is verified; otherwise that control uses anonymous artwork.
Settings passes the DID link and no name, and the public homepage passes neither, so both use anonymous
artwork. The account page's own avatar
uses `displayHandle`: the verified handle, or `handle.invalid`. `/` stays public and cookie-independent,
including for signed-in browsers; its account control uses anonymous artwork and links to `/did`, which
resolves the signed-in user's `/<DID>` URL. The account and settings pages link directly to that DID.
Legacy `/me` links also redirect there. The drawer's Settings link opens `/settings/profile`. The
session, onboarding and email gates apply to `/did`, `/me`, `/<DID>` and the settings pages. The public
homepage stays outside those gates. OAuth and onboarding return to `/did` by default. Sign-in continues
through the existing app-initiated PDS OAuth flow.

The current `/<DID>` page is an owner-only account summary: the route validates the DID, opens the existing app gate,
then checks ownership before resolving a handle or rendering any account details. A different DID returns 404.
The page and shortcuts are private and uncached; the page is also unindexed. Public profile content and profile
persistence are separate work. The Settings placeholder does not present a save action without storage.

The DID parameter route follows all explicit routes. The existing router still determines wrong-method responses:
an unmatched one-segment GET is now validated as a DID and returns 404 (including GET `/logout`); an unsupported
POST to a one-segment path returns 405. No shared router behavior or security mechanism is changed.

The local Navigation README is registered in the UI inventory as the extension approved on 2026-10-17. The pinned
sheet copy and generated tokens remain unchanged. Native interaction behavior follows the
[HTML Living Standard](https://html.spec.whatwg.org/multipage/popover.html) (`popover="auto"` light dismiss and
close requests; read 2026-10-26). Escape is a close request on desktop
([close requests](https://html.spec.whatwg.org/multipage/interaction.html#close-request), read 2026-10-26).
Rendering uses the repository's React 19.3.1 and React DOM 19.3.1 (`apps/web/package.json`,
`shared/ui/package.json`).
The bounded content area's `overflow: auto` follows [CSS Overflow Level 3](https://www.w3.org/TR/css-overflow-3/#overflow-properties)
(7 October 2025 working draft, read 2026-10-26): the main region is a scroll container when its content overflows.
