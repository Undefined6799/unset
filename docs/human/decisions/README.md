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
| [0015](0015-web-framework-glue.md) | Web framework glue: Hono with server-rendered React and islands (P1.20 spike) | Accepted (pending merge) |
| [0016](0016-design-source.md) | The unset.sh design sheet is the design source (P1.21) | Proposed |
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
