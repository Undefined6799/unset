# 0027 — Replace only the PDS frontend distribution

Status: Accepted by Alex, 2026-10-18; implementation and release gates pending.

## Context
Alex required that the PDS backend remain the same, then approved the
[PDS UI design](../../ai/plans/2026-10-18-pds-ui-design.md) and
[implementation plan](../../ai/plans/2026-10-18-pds-ui.md) with “sweet let's do it” on 2026-10-18.
The existing PLAN §5.3 and §9 and P2.24 allow only upstream branding settings and an unmodified official image.
Those settings cannot express the approved account/authentication layouts. This record replaces that blanket
image restriction with a precise frontend-artifact exception; it does not approve a backend fork.

The planning baseline is main `4e0334c953b51c8e09055f99b1544487b4066078`. The official base is
`ghcr.io/bluesky-social/pds:0.4.5037` at
`sha256:3a8feb3415e319dbcc13372293b7ef1fb05a318a6ff1d55968cf99ba6633c5d4`.
The design's source assessment identifies PDS 0.5.37, provider UI 0.10.5 and provider 0.23.1; implementation
must verify these against that image before selecting immutable source. Font delivery remains unproven.

## Decision
1. **Backend equality.** Derive from the exact official image and replace only the installed
   `@atproto/oauth-provider-ui/dist` directory, including its bundle manifest. Resolve and lock its absolute
   installed path from the pinned image before assembly; no parent-directory, package-wide or glob allowlist.
   Every file outside that directory must retain its contents, path, mode and symlink target. Runtime image
   configuration (the complete image Config, including entrypoint, command, working directory, user, environment,
   ports, volumes, healthcheck and stop signal) must equal the official base.
   No runtime dependency reinstall, entrypoint wrapper, provider asset-serving/CSP source change, backend
   build, postinstall rewrite or runtime patch script. Provenance belongs in attestations/external artifacts.
2. **Native behavior.** Build the paired upstream frontend from immutable source and its dependency lockfile,
   with input-hash-checked presentation patches only. Lock source/archive checksum, base digest and Unset
   revision together; drift fails. Preserve account, authorization, error and cookie-error entries, manifest
   format, hydration types and `/@atproto/oauth-provider/~assets/` URLs; replace assets/manifest atomically.
   Upstream routes, guards, hooks, validation, actions, locale behavior, APIs, authentication, cookies,
   sessions, account operations, storage and schema remain unchanged. Login/signup stay on `unset.ac`.
   No new account server, OAuth client, account API, session store, public route or broader app permissions.
3. **Build-only ownership.** `apps/pds/` owns presentation props/slots, layouts and CSS, with no server
   entrypoint or data/authentication logic. It imports only generic shared code and its declared UI runtime;
   no other app, domain, infrastructure, PDS SDK or app island bootstrap. The upstream frontend passes
   resolved links, translated labels, children and native callbacks; upstream-specific integration remains
   in frontend source patches under `deployment/pds/`. `shared/ui/` stays protocol- and router-independent,
   reusing the one token source, CSS Modules, licensed fonts and one compatible React instance. Generic
   component/prop additions and pinned Iconoir 7.12.1 device/app icons require registration through the
   existing design-sheet approval process before implementation; this is no blanket component approval.
4. **Test-only fixtures.** `tests/integration/pds-ui/` and `tests/e2e/pds/` may start a real pinned PDS with
   ephemeral PLC, mail capture and data, following the pinned upstream TestPlc/TestNetworkNoAppView and mail
   patterns. They run in isolation, block external egress, create no public PLC registrations, send no real
   mail and never alter the operated local/dev stack or accounts. This narrow test exception does not amend
   ADR 0022/0023's shared-PLC topology or ADR 0026's local email-gate scope. P2.24's hand-run dev-account
   checks with real SMTP and P5.12's production recheck remain mandatory.
5. **Font feasibility gate.** A separate reviewed edge slice may prove delivery of existing licensed fonts
   at a fixed same-origin static path through the existing Caddy edge, with only the corresponding `font-src`
   change to the existing HTML response CSP. It must preserve dynamic hashes/nonces and every unrelated
   directive, header, redirect and non-HTML response. A second CSP header does not relax the original.
   No remote fonts, wildcard, `unsafe-inline`, HTML body rewrite or provider asset-route bypass. Verify the
   repo-pinned Caddy 2.11.7 and the real PDS in a browser, including the effective font and negative cases.
   Failure returns the specific font limitation for a decision before styled rollout; neither silent fallback
   typography nor a backend patch is authorized. Any edge security loosening retains Alex's review/merge gate.
6. **Review and release.** Register dependency/budget/source-build/image/CI changes in the book before code.
   Check changes precede and stay separate from product changes; edge trusted-base changes stay separate
   from presentation work (SE-6). This docs PR changes no admission check. Later image admission requires
   backend/config equality, negative tamper fixtures, manifest/asset checks, real native flows and visual/
   accessibility evidence. Preserve P2.24's 12-row go/no-go record and all [ALEX]/[STOP] gates. ADR 0019
   continues to govern merges: authors never merge; this new ADR and deployment/production remain Alex's.

## Alternatives
- Official branding settings only: simplest supported build, but insufficient for the approved layouts.
- A separate account app or backend/provider fork: rejected; adds authentication ownership and violates
  the unchanged-backend requirement. Compiled JavaScript substitution is also excluded.

## Consequences
The frontend is maintained against each exact backend release, with source/build/CI evidence and full native
flow tests. An urgent backend security update may use the official UI while customization catches up. UI rollback
restores the official image for the same backend version, never a database downgrade; retain matching image and
edge/font digests. Approving the plan authorizes the recorded slices, not a partial UI or production deployment.
Unrelated decisions, including ADR 0005's Spaces destination, stand. No accepted ADR body is rewritten.

## Compliance
P2.24a records this contract; P2.24's allocated slices implement and prove it before release. Evidence must cover:
- a resolved exact output directory and immutable build inputs;
- equal backend tree/config, with deliberate provider-file, mode and symlink changes each rejected;
- all four entries, valid manifest hashes/references and real provider asset serving;
- font/CSP browser feasibility and failure cases without backend edits;
- isolated native signup/sign-in, recovery, 2FA, consent, account changes/revocation/deletion and app return;
- selected-account isolation, expired/rejected states, both themes, phone/desktop, keyboard and accessibility;
- manual dev SMTP evidence, Alex's screen acceptance, production recheck and same-version rollback rehearsal.

The [design's sources](../../ai/plans/2026-10-18-pds-ui-design.md#sources) identify the upstream source and
browser-test references to re-check at implementation. No source-version or font-feasibility claim is accepted
as implementation evidence here.
