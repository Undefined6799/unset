# Core app shell

The app now uses the approved [core shell design](https://www.figma.com/design/4hrOlzQ1d0lA8Acm4KyLVf?node-id=64-3904)
on home, account and profile Settings. The homepage has no visible content. The logo sits above a 72px desktop
rail; on phones, a bottom bar contains Menu, Home and the account avatar. Menu opens Settings. Desktop labels
use native hover tooltips and accessible link names. The phone popup supports Close, outside click and Escape
without JavaScript.

`apps/web/src/shell/AppShell.tsx` chooses destinations and composes the layout. `shared/ui/components/Navigation/`
owns reusable navigation, using the existing Avatar, Icon, tokens and native browser popover controls. The existing
Header provides a compact brand-only mode. CSS stays in the components/screens cascade layers. No new dependency,
island, business rule or data source is introduced.

The HTTP routes pass display state through `PageSpec` and `ShellOptions`. `/me` receives an avatar initial only
from a verified handle. `/` stays public and cookie-independent, including for signed-in browsers; its account
control uses anonymous artwork. Account opens `/me`, and Settings opens `/settings/profile`, through their existing
session, onboarding and email gates. Sign-in continues through the existing app-initiated PDS OAuth flow.

Public `/<DID>` profiles and profile persistence are separate work. The existing identity page and Settings
placeholder remain connected; the shell does not present demo records or a save action without storage.

The local Navigation README is registered in the UI inventory as the extension approved on 2026-10-17. The pinned
sheet copy and generated tokens remain unchanged. Native interaction behavior follows the
[HTML Living Standard](https://html.spec.whatwg.org/multipage/popover.html), read 2026-10-17; rendering uses the
repository's React 19.3.0 and React DOM 19.3.0.
