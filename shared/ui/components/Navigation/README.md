# Navigation

Approved core-shell composition, 2026-10-17. Figma source:
https://www.figma.com/design/4hrOlzQ1d0lA8Acm4KyLVf?node-id=0-1
Uses the pinned sheet's Avatar, Icon, Menu surface and label typography; the imported sheet snapshot stays immutable.
The composition shares Header's navigation alignment and label styles. Current icons use a 24px by 2px border line
that remains visible in forced colors. The panel reuses Header's current-link underline. Native CSS nesting keeps
the scoped rules compact.

Desktop: 72px rail below a 64px header, with 16px vertical padding and gaps. A 40px account avatar occupies the first
48px target, followed by the primary destination. Remaining destinations sit at the bottom. Native `title` hover
labels replace custom tooltips. Every link retains an explicit `aria-label` for its accessible keyboard name;
native hover labels are supplemental and do not appear consistently on keyboard focus.
The optional `inline` mode keeps both bars in document flow for the kit showcase, so they cannot cover other samples.

Phone (up to 767px): Menu, primary destination, account avatar in equal thirds. The bar reserves 60px for controls
and at least 20px for the safe area. The page provides its own 56px header and bottom content clearance. The popup
sits 16px above the bar, inset 16px from each viewport edge, with 8px padding, a 44px header/Close target, 4px gap and
48px link rows. Rail and bar use surface-raised. Popup: ground, 1px line-strong, radius-xs, shadow-menu. Current destinations and an open phone menu have a 2px underline.

`NavigationProps` accepts branded SafeHref destinations and already-checked identity data. It does not read
cookies, resolve identity or fetch images. Omitted account name uses an anonymous Icon inside Avatar, never
fabricated initials. An account image must be a media-proxy URL, as required by Avatar.

The phone popup uses native `popover="auto"` and `popovertarget` buttons. The browser owns toggle, Close, Escape,
outside dismissal, focus restoration and the top layer; no island or script is needed. Items are ordinary links,
not ARIA menu widgets. Source: HTML Living Standard, 2026-10-16,
https://html.spec.whatwg.org/multipage/popover.html (read 2026-10-17).
