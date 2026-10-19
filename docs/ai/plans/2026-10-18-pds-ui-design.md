# PDS UI design

Status: Accepted by Alex, 2026-10-18 (“sweet let's do it”), after requiring the backend remain the same.
Implementation proceeds through the book's P2.24 subdivisions and [ADR 0027](../../human/decisions/0027-pds-frontend-distribution.md).
Production deployment and the existing manual gates remain separate.

## Goal and governing boundary

Make the native account and authentication pages on `unset.ac` match the approved Unset designs while keeping the
PDS backend unchanged. Reuse Unset tokens and generic components. Login and signup remain on the PDS; the app is
`unset.sh`, handles use `member.unset.im`, and future chat is `unset.cc`.

The governing constraint is: **the backend remains the same**. Provider asset-serving or CSP source changes are
excluded, including for custom fonts.

- Keep the official PDS backend, OAuth provider, runtime dependencies, entrypoint and image configuration unchanged.
- Keep upstream APIs, authentication, sessions, account operations, database schema and storage unchanged.
- Replace only the built `@atproto/oauth-provider-ui/dist` directory, including its bundle manifest.
- Keep upstream frontend routing, guards, hydration, data hooks, validation and action handlers; customize presentation.
- No new account server, OAuth client, session store, password flow, API adapter or deployed service.
- New generic UI components or extensions belong in `shared/ui`; PDS-specific composition stays outside it.

This is a frontend customization, not an independent replacement account application. The frontend remains paired
with the exact backend version it was built and tested against.

## Chosen approach and alternatives

**Recommended:** build the upstream frontend from pinned source with a small reviewed presentation change set,
then copy its output into the exact official image. Compare the resulting filesystem against the official image;
only the frontend distribution directory may differ. This accommodates the designed navigation and layouts and
provides an enforceable backend boundary.

Official branding settings alone remain the simplest supported alternative, but cannot express the sidebar,
phone menu, typography and complete page layouts. A separate account application or a broader backend fork adds
authentication ownership and is outside the user's requirement. Compiled JavaScript substitution scripts are not
the chosen build mechanism.

## Design source and screen coverage

Use the existing [Figma file](https://www.figma.com/design/4hrOlzQ1d0lA8Acm4KyLVf), page `17:402`,
“PDS · Account screens.” Use the pinned `shared/ui` sheet for token values and approved generic components.
Figma establishes composition and interaction; its sample data is not a protocol contract.

| Screen family | Figma reference | Native behavior retained |
| --- | --- | --- |
| Account home | Desktop `49:1616`, phone `49:1681` | Selected account summary and navigation |
| Account settings | Desktop `49:1748`, phone `49:1831` | Email, password, handle, email 2FA and account status |
| Devices | Desktop `49:1912`, phone `49:1978` | Search, current-device indication and session revocation |
| Connected apps | Desktop `49:2032`, phone `49:2089` | Grant details, permissions and revocation |
| About the account | Desktop `49:2137`, phone `49:2197` | Upstream account information |
| Phone menus | `76:4009`, menu component `75:3395` | Menu / Settings / Avatar; remaining destinations in popup |
| Sign in and signup | `64:4769`, `64:4812`, `64:4851` | Native fields, username availability, invite and captcha policy |
| Authentication states | Board `53:1174` | Welcome, chooser, reauthentication, email 2FA, recovery, reset, consent |
| Account dialogs | Board `53:1584` | Verification, email/handle/password changes, 2FA, deactivate/reactivate/delete |
| Supporting states | Boards `57:1644`, `64:2351` | Empty/loading/error/pending/completed and session-action failures |
| Responsive review | `67:3645`; dark phone frames `75:3436`–`75:3685` | Both themes, keyboard and responsive behavior |
| App-to-PDS handoff | `83:4467` | Existing OAuth redirect and return flow; regression coverage only |

Do not add mockup-only backend capabilities or new public routes. Map every design to an actual upstream route,
dialog or conditional state. Captcha remains conditional on upstream configuration. Consent lists come from the
real request. Error/cookie-error entries remain present even though they are less visible in the happy path.
Where a mockup omits a required field or warning, preserve it and compose it with existing design components.

### Navigation

The logo remains above the content and navigation. On desktop, use the shared icon rail with the account avatar
first; provide labels on hover and keyboard focus. On phones, use Menu / Settings gear / Avatar, without visible
labels beneath those controls. Keep accessible names and current-page indication.

The avatar opens the selected account's native home, `/account/u/$accountId`. The gear opens its native
`/account/u/$accountId/manage`. Devices, Apps and About map to the existing sibling routes. Resolve destinations
through upstream routing rather than interpolating unvalidated account identifiers. The logo returns to native
PDS account home; the existing footer can retain its link to `unset.sh`.

Account switching, sign-out and locale selection must remain reachable after moving the avatar out of the
existing account dropdown. Use a PDS-owned composition of existing actions; do not introduce a second account
store. Phone menus close on selection, Escape and outside dismissal, with correct focus restoration. Keep browser
back/forward and direct route reloads working.

The PDS is account management. Public profile editing remains an app Settings responsibility and is not added to
PDS account settings in this work.

## Ownership and dependency boundaries

| Location proposed at implementation | Responsibility |
| --- | --- |
| `shared/ui/` | Tokens, icons, fonts, generic components and reusable accessibility behavior |
| `apps/pds/` | Build-only account/auth layouts and styles; consumes shared UI and presentation props/slots |
| `deployment/pds/` | Upstream source lock, frontend-only source patches, build assembly and derived-image recipe |
| `deployment/edge/` | Existing proxy; optional separately reviewed static font delivery and narrowly scoped CSP configuration |
| `tests/integration/pds-ui/`, `tests/e2e/pds/` | Artifact compatibility, real PDS browser flows and visual/accessibility checks |
| `docs/human/runbooks/pds-ui.md` | Version updates, verification and rollback |

`apps/pds` has no server entrypoint. It does not import `apps/web`, domains, infrastructure or a PDS SDK. The upstream
frontend supplies children, links, labels and callbacks to the presentation package. Shared components must not
import upstream routing or authentication libraries. Keep upstream-specific integration in the reviewed source
patches. No folders above are created until their implementation slice needs them.

Use the existing `Navigation`, brand-only `Header`, `Avatar`, `Icon`, `Input` and suitable buttons. Extend public
exports only for actual consumers. Devices and Apps need approved pinned Iconoir 7.12.1 additions. Make the header
accessible label configurable. Add only the native interaction props actually required by upstream controls.
Retain upstream dialog, form and notification behavior until any shared replacement has demonstrated equivalent
focus, validation, pending and error handling. Do not import the app island bootstrap into the PDS.

Build with one compatible React instance. Consume the existing token source, CSS Modules, font files and licences;
do not maintain a second hand-copied token file. Preserve Lingui and its locale chooser. Scope the style bridge
because the provider currently serves all manifest styles for every entry, including error pages.

## Fonts and the backend boundary

The pinned provider blocks font fetches on its own asset route and does not allow fonts in its CSP. Changing those
backend files is excluded. Exact custom-font rendering is therefore an early feasibility gate, not a settled fact.

The candidate solution is to serve the existing licensed fonts through a fixed same-origin static path at the
existing Caddy edge, and narrowly extend the existing HTML response policy with an appropriate `font-src` rule.
This is a deployment/security configuration change, **not** a backend source change, and needs its own review.
Adding a second CSP header does not relax the original policy. Preserve dynamic hashes/nonces, all unrelated
directives, headers, redirects and non-HTML responses. No remote fonts, wildcard permission, `unsafe-inline`, HTML
body rewriting, or provider asset-route bypass is permitted.

Prove the candidate against the pinned Caddy and real PDS before promising exact typography. If that cannot pass,
bring back the specific font limitation for a decision. Do not silently accept fallback typography or change the
backend to make the mockup pass.

## Build contract

Planning baseline: Unset main `4e0334c953b51c8e09055f99b1544487b4066078`, which includes the core shell.
The locked PDS image is `ghcr.io/bluesky-social/pds:0.4.5037` at
`sha256:3a8feb3415e319dbcc13372293b7ef1fb05a318a6ff1d55968cf99ba6633c5d4`.
The source assessment used `@atproto/pds@0.5.37`, UI `0.10.5`, provider `0.23.1`.

At implementation, verify those package versions against the pinned image and resolve the source tag to an
immutable commit/archive checksum. Lock that source, its dependency lockfile, the official image digest and the
Unset source revision together. Apply checked-in frontend source patches only after verifying input hashes;
fail on drift. Install build dependencies in the builder only. No postinstall rewrites or runtime patch scripts.

Preserve the `account`, `authorization`, `error` and `cookie-error` entries, the bundle-manifest format and
`/@atproto/oauth-provider/~assets/` URL contract. Replace assets and manifest atomically. Do not change hydration
types, native route semantics, cookie attributes, authentication requests or OAuth permissions.

The image comparison covers file contents, paths, permissions and symlink targets outside the exact UI output
directory, and separately checks unchanged runtime configuration. Build provenance belongs in image attestations
or external artifacts rather than arbitrary extra runtime files. An unexpected backend delta blocks release.

## Verification and operation

Run isolated tests against the real pinned PDS and ephemeral state. Reuse the pinned upstream TestPlc,
TestNetworkNoAppView and OAuth test patterns; intercept mail delivery in tests only. Do not create identities at
public `plc.directory`, send real mail or modify the operated development stack for automated tests.

Cover signup, sign-in, reauthentication, email 2FA, recovery, consent accept/deny and return to the app; then account
switching, email/handle/password changes, device/app revocation, deactivate/reactivate and final delete. Exercise
wrong/expired codes, expired sessions and rejected operations. State changes must occur through native controls
and backend operations. Keep upstream safeguards even when the design presents an action differently.

Review desktop and phone renders in both themes, including long handles/translations, 320px width, short phone
viewports, zoom, keyboard focus, reduced motion and forced colors. Use the actual Figma screens as visual targets.
Static fixture previews are useful for appearance but never substitute for real flow tests. Keep P2.24's separate
manual dev-account checks with real SMTP and the production recheck; isolated tests do not replace these gates.

Each backend upgrade rebuilds and verifies the frontend against that exact release. UI trouble must not delay an
urgent backend security update: retaining the official UI for the new release is an operational fallback. A UI
rollback restores the official image for the **same backend version**; it is not permission to downgrade a PDS
database across versions. Retain the relevant image and edge-asset/configuration digests together.

## Repository decision and implementation gates

[ADR 0027](../../human/decisions/0027-pds-frontend-distribution.md) records the approved narrow frontend-artifact
exception to PLAN §5.3/§9 and P2.24, with the stronger unchanged-backend invariant. The decision log, book and
architecture record build-only `apps/pds`, its dependency rules and isolated test fixtures. Existing image/Compose
checks remain unchanged until their allocated implementation steps; this approval does not admit a candidate image.
Unrelated accepted decisions, including the Spaces destination, remain in force.

Keep trusted build/check/edge changes in separate PRs from product UI changes, following SE-6 and the step book.
ADR 0019 still governs author/verifier merges and Alex's reserved gates. Font feasibility and native-flow evidence
remain prerequisites for rollout.

## Sources

- [Pinned upstream source](https://github.com/bluesky-social/atproto/tree/%40atproto/pds%400.5.37), especially `packages/oauth/oauth-provider-ui/src/components/layouts/`, `account-page.tsx`, `routes/account/u/$accountId/`, `vite.config.js`, and provider `src/router/assets/` and `src/lib/write-html.ts`.
- [Pinned OAuth browser tests](https://github.com/bluesky-social/atproto/blob/%40atproto/pds%400.5.37/packages/pds/tests/oauth.test.ts) and [ephemeral network fixture](https://github.com/bluesky-social/atproto/blob/%40atproto/pds%400.5.37/packages/dev-env/src/network-no-appview.ts).
- [Official PDS customization](https://atproto.com/blog/pds-customization-and-metrics).
- [Caddy response header configuration](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#headers); implementation must verify the repo-pinned Caddy 2.11.7 behavior in a browser.
- Local authority: `CLAUDE.md`, `docs/ai/PLAN.md`, `docs/ai/book/phase-2.md`, `docs/human/engineering/architecture-and-development-guideline.md`, `docs/human/features/core-shell.md`, and `deployment/images/bases.lock.json`.
