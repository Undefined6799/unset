# Navigation

**P2.13e (Alex, 2026-10-23; Figma 135:806, 135:858, 135:935, 151:939) supersedes the rail and popup below.**
One left drawer replaces the desktop rail and the phone popup. It is a native `popover="auto"` `<nav>` with the
caller's `menuId`, 320px wide (at most the viewport less 48px), full height from the left edge over the `scrim`,
ground background, a 1px `line-strong` right edge, `radius-sm` on its right corners and `shadow-1`. Its head is the
mark linking home with a 48px close button (`popovertargetaction="hide"`, `closeLabel`) on the same line; then the
destinations as 48px rows with icon and visible label in the order primary, account (24px avatar), items, the current
one boxed in `line-strong` with `aria-current="page"`; then the caller's `actions` under a `line` (the app puts this
browser's sign-out form there); then the caller's `extra` centered at the very bottom under a `line` (the theme
picker). No Legal links: they stay in the footers. On desktop `NavigationMenuButton` (48px, menu icon) sits before
the mark in the brand header (`Header`'s `start`) and toggles the drawer. On phones (up to 767px) that button is
hidden and the floating bar keeps menu, home and account in equal thirds: inset 16px from the sides and
`max(20px, safe area)` from the bottom, 1px `line-strong` edge, `radius-sm`, `shadow-1`, no underline. Its menu
button toggles the same drawer, and the bar is hidden while the drawer is open (`.drawer:popover-open ~ .phone`),
back when it closes. It is also hidden while a page control docked at the bottom marks itself
`data-covers-navigation` (the README editor's bar while editing; Alex 2026-10-27, direction A). `itemsPlacement`, the hover labels and the rail's current line are removed with the rail.

Approved core-shell composition, 2026-10-17. Figma source:
https://www.figma.com/design/4hrOlzQ1d0lA8Acm4KyLVf?node-id=0-1
Uses the pinned sheet's Avatar, Icon, Menu surface and label typography; the imported sheet snapshot stays immutable.
The composition shares Header's navigation alignment and label styles. Desktop current icons use a 24px by 2px border line
that remains visible in forced colors. The panel reuses Header's current-link underline. Native CSS nesting keeps
the scoped rules compact.

Desktop: 72px rail below a 64px header, with 16px vertical padding and gaps. A 40px account avatar occupies the first
48px target, followed by the primary destination. Remaining destinations default to the bottom; `itemsPlacement="start"` keeps their 16px stack after the primary.
Every link retains an explicit `aria-label`. After hydration, the approved ink/on-ink label appears on hover or
keyboard focus at left60/top4, with mono12/16, 0.72 tracking, px16/py12 and radius2. The hover bridge keeps the
label visible while moving onto it; Escape dismisses it until blur or leaving the rail. Unhydrated/no-JS output
retains the existing native `title` tooltip and meaningful focus name; React event/effect handlers do not run there.
The optional `inline` mode keeps both bars in document flow for the kit showcase, so they cannot cover other samples.

Phone (up to 767px): Menu, primary destination, account avatar in equal thirds of a 48px-tall floating dock.
Its left, right and bottom gaps match (`max(20px, env(safe-area-inset-bottom))`); it has no padding,
with radius-xs, line outline and shadow-menu.
The page provides its own 56px header and bottom content clearance. The popup
sits 16px above the bar, inset 16px from each viewport edge, with 8px padding, a 44px title header, 4px gap and
48px link rows. Rail and bar use surface-raised. Popup: ground, 1px line-strong, radius-xs, shadow-menu. Phone current artwork lifts 2px while its 48px target and focus outline stay stationary: a 28px glyph sits 2px inside the dock's top edge, a 40px avatar extends 4px above it. Phone Menu/primary icons are 28px; anonymous profile artwork is 24px inside the existing 40px avatar. Desktop icon sizes remain unchanged. A `shadow-hard` copy of selected artwork with a subtle 1px blur stays at its resting position, 2px below the raised artwork. There is no current/open-menu underline. Menu is current only when an item is current; primary/account retain `aria-current`. Opening the popup does not select a destination or lift another icon. The static displacement also applies with reduced motion and forced colors.

`NavigationProps` accepts branded SafeHref destinations and already-checked identity data. It does not read
cookies, resolve identity or fetch images. Omitted account name uses an anonymous Icon inside Avatar, never
fabricated initials. An account image must be a media-proxy URL, as required by Avatar.

Alex approved the phone revision above in the working browser preview on 2026-10-21, including removal of the
redundant popup Close control and a floating rectangle around the phone controls. His subsequent feedback widens
and thins the dock with matching side/bottom gaps and raises selected artwork above its top edge.
The popup keeps its title and ordinary links. `closeLabel` is optional/deprecated
for existing callers; it no longer renders a control. Desktop labels/current treatment and popup rows are unchanged.

Alex's subsequent 2026-10-21 feedback enlarges phone icons and adds the fixed icon-shaped shadow in the same
colour as the design sheet's hard button shadow. The sheet's displayed `project/tokens.json` was captured from
https://claude.ai/artifact/78Sh5q9HGz74d5AQyMbQVt on that date and synced exactly, with its token hash recorded
in `sheet/source.json`. Dark `shadow-hard` is Onyx, darker than the updated page; Light aliases `line-strong`.
The source's new radius token is registered without changing existing component corners.
His latest feedback sets the selected artwork's lift and matching shadow offset to 2px and adds a 1px shadow blur,
explicitly overriding the sheet's hard-shadow default for selected phone artwork only.

The phone popup uses native `popover="auto"` and its `popovertarget` toggle. The browser owns toggle, Escape,
outside dismissal, focus restoration and the top layer; no island or script is needed. Items are ordinary links,
not ARIA menu widgets. Source: HTML Living Standard, 2026-10-16,
https://html.spec.whatwg.org/multipage/popover.html (read 2026-10-17).

`renderLink` receives `NavigationAnchorProps`: validated SafeHref, className, children, aria-label, optional
aria-current/title/ref. It must return one real anchor forwarding all supplied attributes and children. It applies
to every account, primary and item placement. The default remains ordinary anchors. `navigationKey` is an explicit
caller-confirmed committed-selection signal, including same-target selection and history traversal; only a changed
key hides an open native popover. Mount/unchanged keys preserve focus and open state. A prevented click is not a
navigation result. Caller owns routing and focus on new content; native hidePopover preserves its normal focus rules.

The exact P2.24f sources/APIs are recorded in `approved-extensions.json`, pinned from the existing inventory rows.
`@unset/shared-ui/presentation` exports only Navigation, Button, Input, Icon, Avatar and safeHref plus needed types;
`@unset/shared-ui/brand-header` exports the pure existing brand composition. Neither entry imports full Header or
an island runtime. HTML source read: https://html.spec.whatwg.org/multipage/popover.html, 2026-10-20 Standard,
checked 2026-10-21; actual native interaction/focus evidence is in the P2.24f task report.
