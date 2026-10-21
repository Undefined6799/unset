# Core app shell

The app now uses the approved [core shell design](https://www.figma.com/design/4hrOlzQ1d0lA8Acm4KyLVf?node-id=64-3904)
on home, account and profile Settings. The homepage has no visible content. The logo sits above a 72px desktop
rail; on phones, a bottom bar contains Menu, Home and the account avatar. Menu opens Settings. Desktop labels
use native hover tooltips and accessible link names. The phone popup supports Close, outside click and Escape
without JavaScript.

On screen, the main region scrolls inside the space between the header and navigation. This keeps keyboard-focused
controls visible even in short or zoomed phone viewports; padding below a fixed bar alone does not provide that
guarantee. Print keeps normal document flow. To check it, open the account page at 390×320 and 320×400 and traverse
the controls with Tab and Shift+Tab: the privacy-notice link when the banner shows it, the sign-in server link when
the page shows it, and the one sign-out button must remain clear of the header and bottom bar. The skip link must
focus the main region with its heading visible.

`apps/web/src/shell/AppShell.tsx` chooses destinations and composes the layout. `shared/ui/components/Navigation/`
owns reusable navigation, using the existing Avatar, Icon, tokens and native browser popover controls. The existing
Header provides a compact brand-only mode. CSS stays in the components/screens cascade layers. No new dependency,
island, business rule or data source is introduced.

The HTTP routes pass display state through `PageSpec` and `ShellOptions`. `/<DID>` receives an avatar initial only
from a verified handle. `/` stays public and cookie-independent, including for signed-in browsers; its account
control uses anonymous artwork and links to `/did`, which resolves the signed-in user's `/<DID>` URL. Pages with a
verified session link directly to that DID. Legacy `/me` links also redirect there. Settings opens `/settings/profile`.
The existing session, onboarding and email gates apply to all these destinations. OAuth and onboarding return to
`/did` by default. Sign-in continues through the existing app-initiated PDS OAuth flow.

The current `/<DID>` page is an owner-only account summary: the route validates the DID, opens the existing app gate,
then checks ownership before resolving a handle or rendering any account details. A different DID returns 404.
The page and shortcuts are private and uncached; the page is also unindexed. Public profile content and profile
persistence are separate work. The Settings placeholder does not present a save action without storage.

The DID parameter route follows all explicit routes. The existing router still determines wrong-method responses:
an unmatched one-segment GET is now validated as a DID and returns 404 (including GET `/logout`); an unsupported
POST to a one-segment path returns 405. No shared router behavior or security mechanism is changed.

The local Navigation README is registered in the UI inventory as the extension approved on 2026-10-17. The pinned
sheet copy and generated tokens remain unchanged. Native interaction behavior follows the
[HTML Living Standard](https://html.spec.whatwg.org/multipage/popover.html), read 2026-10-17; rendering uses the
repository's React 19.3.0 and React DOM 19.3.0.
The bounded content area's overflow follows [CSS Overflow Level 3](https://www.w3.org/TR/css-overflow-3/#overflow-properties)
(7 October 2025 working draft), with keyboard behavior checked in the production browser render.
