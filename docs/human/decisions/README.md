# Architecture decision records

One file per decision that is expensive to reverse: Context, Decision, Alternatives (at least
two), Consequences, Compliance (engineering rule DO-1). Number them in order and never rewrite
an accepted one; supersede it with a new record instead (DO-2). ADR 0001 is the exception agreed
in decision 35 (D8): it is an append-only log of decisions 1 to 34 and of every later decision's
one-paragraph entry; new decisions also get their own file.

| # | Decision | Status |
| --- | --- | --- |
| [0001](0001-phase-0-defaults.md) | Defaults taken to start Phase 0; append-only decisions log | Proposed (awaiting Alex); log entries accepted as dated |
| [0002](0002-engineering-rules.md) | Engineering rules from the reading list (decision 35) | Accepted 2026-10-04 |
| [0003](0003-chat-lookup-private-members.md) | Chat does not reveal private members by handle (decision 36) | Accepted 2026-10-04 |
| [0004](0004-no-false-sense-of-privacy.md) | No false sense of privacy: show what the network can see (decision 37) | Accepted 2026-10-04 |
| [0005](0005-atproto-spaces-destination.md) | Atproto Spaces is the destination for private data (decision 38) | Accepted 2026-10-04 |
| [0006](0006-private-likes-shown-to-target.md) | Private likes, comments and follows are shown to their target (decision 39) | Accepted 2026-10-04 |
| [0007](0007-bootstrap-reconciliation.md) | Bootstrap reconciliation: which Phase 0 step changes each bootstrap file | Proposed (awaiting Alex) |
| [0008](0008-ruleset-without-required-approvals.md) | Main-branch ruleset without required approvals (decision 40) | Accepted 2026-10-04; merge clause and SE-6 review clause superseded by 0019 |
| [0009](0009-no-branch-protection-on-free-private-repo.md) | No branch protection while the repository is private on the free plan (decision 41) | Superseded by 0017 |
| [0010](0010-opaque-chat-ids.md) | Opaque chat ids close the key-query membership leak (decision 42) | Accepted 2026-10-04 |
| [0011](0011-no-orchestrator-until-measured-need.md) | No orchestrator until a measured need beyond one host (rule AB-3) | Accepted 2026-10-04 |
| [0012](0012-licence.md) | AGPL-3.0-only for the product, MIT for `shared/` (decision 27) | Accepted 2026-10-03 |
| [0013](0013-identity-network-port.md) | Identity resolution behind a network port, DNS on c-ares | Proposed (awaiting Alex) |
| [0014](0014-node-postgres.md) | node-postgres as the Postgres driver | Proposed (awaiting Alex) |
| [0015](0015-web-framework-glue.md) | Web framework glue: Hono with server-rendered React and islands (P1.20 spike) | Superseded by 0054 |
| [0016](0016-design-source.md) | The unset.sh design sheet is the design source (P1.21) | Superseded by 0055 |
| [0017](0017-main-ruleset-applied.md) | Main ruleset applied; supersedes 0009 | Accepted 2026-10-06; merge sentence superseded by 0019 |
| [0018](0018-edge-rate-limit-plugin.md) | Edge rate limiting with caddy-ratelimit, in memory only (P1.28) | Accepted 2026-10-07 (P1.28, #409) |
| [0019](0019-verified-agent-merges.md) | Verified agent merges: a verifier session merges checked agent PRs (P0.15) | Accepted on merge (2026-10-12) |
| [0020](0020-permanent-choices.md) | Permanent choices: Matrix server name, Tailnet Lock custody, permission set NSID (P1.32) | Superseded by 0025 |
| [0021](0021-atproto-oauth-client.md) | @atproto/oauth-client-node as the OAuth client (P2.04) | Proposed (awaiting Alex) |
| [0022](0022-web-egress-and-shared-plc.md) | web gets its own egress network; we use the shared PLC (P2.05e) | Proposed (awaiting Alex) |
| [0023](0023-local-pds-publishes-to-shared-plc.md) | The local PDS publishes to the shared PLC, with a few fixed test accounts (P1.34t) | Proposed (awaiting Alex) |
| [0024](0024-atproto-api-agent.md) | @atproto/api Agent as the XRPC client over an OAuth session (P2.07) | Proposed (awaiting Alex) |
| [0025](0025-public-domains.md) | Public domains: app `unset.sh`, PDS `unset.ac`, handles `unset.im`, chat `unset.cc`; development `staging.unset.*` | Accepted by Alex 2026-10-19 |
| [0026](0026-local-email-gate-exception.md) | Local-only email-gate exception for `alice.unset.im` and `bob.unset.im` (mechanism 2) | Proposed (awaiting Alex) |
| [0027](0027-pds-frontend-distribution.md) | PDS frontend distribution replacement with unchanged backend and runtime configuration (P2.24a) | Accepted by Alex 2026-10-18; implementation pending |
| [0029](0029-media-domain.md) | Media domain `unset.site`; development `staging.unset.site` | Proposed (awaiting Alex) |
| [0030](0030-pangolin-checks-at-our-edge.md) | Staging behind Pangolin: method scope and last-hop trust move to our edge, cookie and logging clauses of 0025 restated | Accepted by Alex 2026-10-19 |
| [0031](0031-public-staging-pds.md) | Staging public through Pangolin, no login, no certificate at our edge; departs from 0025 and 0030 for dev only | Accepted 2026-10-20; Decision 2 and Decision 1's plain-http sentence superseded by 0032 |
| [0032](0032-self-signed-dev-edge.md) | Self-signed certificate at the dev edge behind Pangolin; supersedes 0031 Decision 2 for dev only | Accepted 2026-10-20 |
| [0033](0033-image-signing-keyless.md) | Image signing: keyless cosign with our exact workflow identity (P1.27s) | Accepted 2026-10-20 |
| [0034](0034-docs-only-auto-merge.md) | Docs-only pull requests auto-merge when CI is green (P0.07e) | Proposed (awaiting Alex) |
| [0035](0035-web-search-searxng.md) | Web search through our own SearXNG, queried by the server through net-guard (P3.14s) | Proposed (awaiting Alex) |
| [0036](0036-staging-builds-from-source.md) | Staging builds its images from the checkout under `--env dev --source`; production stays signed and pinned (P1.37y) | Accepted 2026-10-28 |
| [0037](0037-profile-module-and-page.md) | The profile is its own module, stored on the member's PDS, edited by its owner (P2.20) | Accepted 2026-10-28; Decision 2's strict-validator clause superseded by 0038; decisions 4, 5, 8 and the README half of 7 superseded by 0051 |
| [0038](0038-profile-save-keeps-unknown-fields.md) | A profile save keeps stored fields the lexicon does not define (P2.20f) | Accepted 2026-10-29 |
| [0039](0039-request-scopes-per-feature.md) | Sign-in asks only for the scopes a shipped feature uses (P1.31s) | Accepted 2026-11-16 |
| [0040](0040-index-repos-holding-a-profile.md) | Index any repo that holds our profile record, with caps and non-member privacy (P3.08d) | Accepted 2026-11-16 |
| [0041](0041-object-store.md) | One S3-compatible object store (SeaweedFS in our stacks) for app media and PDS blobs (P2.18s, P2.18p) | Accepted 2026-11-15 |
| [0042](0042-app-limits-behind-the-edge.md) | Behind the edge, the app's rate limits are site-wide ceilings; the edge is the only per-client limiter (P1.06s) | Accepted 2026-11-15 |
| [0043](0043-audit-actor-column.md) | The audit side row names its actor in a DID column, so erasure finds a person's rows as actor as well as subject (P1.15k) | Accepted 2026-11-15 |
| [0044](0044-trusted-paths-labelled-not-isolated.md) | A trusted-path change carries the `security-review` label and is reviewed at its exact head; the trusted-base split and its guards are retired; five template headings (P0.09c) | Accepted 2026-11-15 |
| [0045](0045-kit-enforces-the-session-gate.md) | The request kit enforces the session gate on routes that require one (P1.04g) | Accepted 2026-11-15 |
| [0046](0046-edge-checks-read-caddy-adapt.md) | The edge's checks read Caddy's own adapted config, not our reading of the Caddyfile (P1.39a to P1.39e) | Accepted |
| [0047](0047-lock-bump-auto-merge.md) | A lock bump the publish run opened merges itself once the `lock` check is required and green (P2.26n) | Accepted 2026-11-16 |
| [0050](0050-object-store-admin-through-its-shell.md) | The object store's buckets and clean-up run through its own shell; no S3 admin key; supersedes two clauses of 0041 (P2.18s) | Accepted 2026-11-16 |
| [0048](0048-session-issuer-origin.md) | The session row records the sign-in server's origin, so account pages stop unsealing the token set for a link (P2.03n) | Accepted 2026-11-15 |
| [0049](0049-sessions-end-with-their-token-set.md) | A browser session ends with its token set, enforced by a foreign key with ON DELETE CASCADE (P2.03t) | Accepted 2026-11-16 |
| [0051](0051-profile-cards-lexicon.md) | The profile is a minimal record plus one card record per card; supersedes parts of 0037 (P2.20m) | Accepted 2026-11-17 |
| [0052](0052-ingest-our-pds-with-atproto-sync.md) | Ingest our own PDS with `@atproto/sync`, not Tap, for the first indexer slice (P3.05s) | Accepted 2026-11-17; decision 3's queue clause superseded by 0053, decision 1's `Firehose` phrase by 0058 |
| [0053](0053-queue-members-for-the-index-at-onboarding-end.md) | Queue members for the index when their onboarding ends, in `idx`; supersedes one clause of 0052 (P3.02s) | Accepted 2026-11-17 |
| [0054](0054-web-process-on-sveltekit.md) | The web process runs on SvelteKit with Svelte 5 screens; Hono is removed; supersedes 0015 (P1.20a) | Accepted 2026-11-18 |
| [0055](0055-shadcn-svelte-and-one-theme-file.md) | shadcn-svelte components, themed by one file in the repo; supersedes 0016 (P1.20a) | Accepted 2026-11-18 |
| [0056](0056-web-boundary-by-file-kind.md) | In the web process the UI/server boundary is by file kind, checked; the request gate is server.ts plus the hook (P1.20a) | Accepted 2026-11-18 |
| [0057](0057-small-and-auditable-means-the-code.md) | "Small and auditable" means our own code; a package meeting a written bar needs no ADR unless it touches auth, crypto, egress or personal data; amends DO-1 (P0.09) | Accepted 2026-11-17 |
| [0058](0058-read-the-stream-without-the-firehose-class.md) | Read our PDS's stream with `@atproto/sync`'s parsers, not its `Firehose` class; supersedes one phrase of 0052 (P3.05s) | Accepted 2026-11-17 |
| [0059](0059-narrow-typed-lines-and-group-updates.md) | Alex's typed line only for security loosenings and ADRs; grouped Renovate updates; drafts run the cheap checks; merges tested on main's tip; amends 0019 (P0.07l) | Accepted 2026-11-18 |
| [0060](0060-pds-admin-issues-member-invites.md) | `pds-admin`, the one holder of the PDS admin password, issues member invites (P2.09) | Proposed (awaiting Alex) |
| [0062](0062-member-search-and-ai-choices.md) | Members choose whether search engines and AI search may show their public page; AI training is blocked site-wide (P3.12s) | Proposed (awaiting Alex) |
| [0063](0063-handle-records-written-on-claim.md) | Each member's handle record is written to DNS when they claim it, in zones at deSEC (unset.name and staging.unset.name); supersedes 0025's hand-added staging records (P3.08s) | Proposed (awaiting Alex) |
| [0064](0064-handles-move-to-unset-name.md) | Handles move from unset.im to unset.name, a DNSSEC-signed domain; supersedes 0025's handle rows | Proposed (awaiting Alex) |
| [0065](0065-resend-sends-account-mail-from-the-us.md) | Resend sends account mail for now, with its data in the United States; drops answer 21's Canada or EU hosting (P2.25) | Proposed (awaiting Alex) |
| [0066](0066-edge-app-burst-sixty.md) | The edge's `app_burst` zone allows 60 requests per 10 seconds per address; supersedes 0031's value 20 and two sizing statements of 0042 (P1.20r) | Accepted 2026-11-20 |
| [0067](0067-account-lifecycle-and-burned-names.md) | Deactivation, deletion after 30 days, takedown and moving away follow atproto's account model; no PLC tombstone by default; every hosted name is burned (P1.21e) | Accepted 2026-11-20 |
| [0068](0068-profile-card-surfaces.md) | Each profile card chooses Filled, Outlined or Plain through an optional surface field | Accepted 2026-11-20 |
| [0069](0069-split-client-and-build-file-zone.md) | The web client is split into content-hashed pieces, and the dev app edge counts them in their own zone, `app_files`; supersedes "no matcher" for `app_burst` in 0031 and 0066 (P1.21g) | Accepted 2026-11-20 |
| [0070](0070-shared-image-foundation.md) | One shared image foundation: images are blobs in the member's repository, each use carries its alt text; intake, processing in its own no-network process, an empty inspection port, storage and publish; uploads with nothing mounted only on a closed list of test origins (P2.17) | Accepted 2026-11-20 |
| [0071](0071-limits-for-thousands-of-members.md) | Limits sized for thousands of members; web marks its own PDS calls with a key so the edge gives them their own zones; app_signin counts only the login and join posts (P1.21j) | Accepted 2026-11-20 |
| [0072](0072-profile-page-layout.md) | The profile chooses its page layout, sidebar or compact, through an optional layout field (P1.21n) | Superseded by 0077 |
| [0073](0073-text-card-rich-editor.md) | The Text card is written in a Milkdown editor over the plain field, loaded on open; the CSP adds the one Trusted Types name `ProseMirrorClipboard` (P1.21u) | Accepted 2026-11-20 |
| [0074](0074-one-save-for-cards-edited-in-place.md) | Text cards are edited in place on the owner's page and saved together by one Save, all or none, through applyWrites on the repo head; drafts stay on the device (P1.21v) | Proposed (awaiting Alex) |
| [0075](0075-docs-site-on-the-staging-edge.md) | The docs site at docs.unset.sh is a third site on the staging edge, served as files from the checkout with its own CSP and zone (P1.21w) | Accepted 2026-11-20 |
| [0076](0076-image-uploads-up-to-64-mib.md) | Image uploads up to 64 MiB and 110 megapixels; web, net-guard and review caps, memory and the edge's read window rise with it (P2.19e) | Accepted 2026-11-20 |
| [0077](0077-one-profile-layout.md) | The profile page has one layout, the header above the cards; the unpublished layout field is removed (P1.21x); supersedes 0072 | Accepted 2026-11-21 |
| [0079](0079-notifications-in-core.md) | Notifications are a core inbox: one send call, one reason table, gone once opened and at 30 days, a sign-in entry only older browsers can clear, and the contract a module will get (P2.27) | Proposed (awaiting Alex) |
| [0088](0088-chat-page-served-by-the-door.md) | The chat page is a static Svelte build the door serves on `unset.cc`; it redeems the ticket itself, keeps the session in memory only, and renews by running the hop again (P6.06) | Accepted 2026-11-21 |
| [0089](0089-one-browser-runs-recovery-key-setup.md) | One browser at a time runs an account's recovery-key setup, under a 15-minute claim the door keeps; the key is shown and checked before the vault is written, as Element does (P6.08) | Accepted 2026-11-21 |
| [0090](0090-chat-count-keys-and-message-lookup.md) | The door issues a pushkey per browser entry and keeps one number each, answers Synapse and web on an internal port of its own, and resolves the Message link only for a signed-in browser to a member whose page shows (P6.12) | Accepted 2026-11-21 |
