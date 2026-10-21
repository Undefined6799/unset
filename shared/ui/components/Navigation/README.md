# Navigation

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
48px link rows. Rail and bar use surface-raised. Popup: ground, 1px line-strong, radius-xs, shadow-menu. Phone current artwork lifts 16px (`space-4`) while its 48px target and focus outline stay stationary: a 24px glyph extends 4px above the dock, a 40px avatar 12px. There is no current/open-menu underline. Menu is current only when an item is current; primary/account retain `aria-current`. Opening the popup does not select a destination or lift another icon. The static displacement also applies with reduced motion and forced colors.

`NavigationProps` accepts branded SafeHref destinations and already-checked identity data. It does not read
cookies, resolve identity or fetch images. Omitted account name uses an anonymous Icon inside Avatar, never
fabricated initials. An account image must be a media-proxy URL, as required by Avatar.

Alex approved the phone revision above in the working browser preview on 2026-10-21, including removal of the
redundant popup Close control and a floating rectangle around the phone controls. His subsequent feedback widens
and thins the dock with matching side/bottom gaps and raises selected artwork above its top edge.
The popup keeps its title and ordinary links. `closeLabel` is optional/deprecated
for existing callers; it no longer renders a control. Desktop labels/current treatment and popup rows are unchanged.

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
