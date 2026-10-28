---
title: Decisions
weight: 6
---

Accepted records stay as written. This page is the index in [`docs/human/decisions/README.md`](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/README.md). The files are not rendered on this site.

0013, 0022 and 0023 are still Proposed in the index. Citations of 0022 and 0023 say decided (0001 log), acceptance pending. The 0001 log records both on 2026-10-16. It has no 0013 entry; that file stays Proposed.

| # | Decision | Status |
| --- | --- | --- |
| [0001](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0001-phase-0-defaults.md) | Defaults taken to start Phase 0; append-only decisions log | Proposed (awaiting Alex); log entries accepted as dated |
| [0002](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0002-engineering-rules.md) | Engineering rules from the reading list (decision 35) | Accepted 2026-10-04 |
| [0003](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0003-chat-lookup-private-members.md) | Chat does not reveal private members by handle (decision 36) | Accepted 2026-10-04 |
| [0004](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0004-no-false-sense-of-privacy.md) | No false sense of privacy: show what the network can see (decision 37) | Accepted 2026-10-04 |
| [0005](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0005-atproto-spaces-destination.md) | Atproto Spaces is the destination for private data (decision 38) | Accepted 2026-10-04 |
| [0006](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0006-private-likes-shown-to-target.md) | Private likes, comments and follows are shown to their target (decision 39) | Accepted 2026-10-04 |
| [0007](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0007-bootstrap-reconciliation.md) | Bootstrap reconciliation: which Phase 0 step changes each bootstrap file | Proposed (awaiting Alex) |
| [0008](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0008-ruleset-without-required-approvals.md) | Main-branch ruleset without required approvals (decision 40) | Accepted 2026-10-04; merge clause and SE-6 review clause superseded by 0019 |
| [0009](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0009-no-branch-protection-on-free-private-repo.md) | No branch protection while the repository is private on the free plan (decision 41) | Superseded by 0017 |
| [0010](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0010-opaque-chat-ids.md) | Opaque chat ids close the key-query membership leak (decision 42) | Accepted 2026-10-04 |
| [0011](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0011-no-orchestrator-until-measured-need.md) | No orchestrator until a measured need beyond one host (rule AB-3) | Accepted 2026-10-04 |
| [0012](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0012-licence.md) | AGPL-3.0-only for the product, MIT for `shared/` (decision 27) | Accepted 2026-10-03 |
| [0013](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0013-identity-network-port.md) | Identity resolution behind a network port, DNS on c-ares | Proposed (awaiting Alex) |
| [0014](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0014-node-postgres.md) | node-postgres as the Postgres driver | Proposed (awaiting Alex) |
| [0015](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0015-web-framework-glue.md) | Web framework glue: Hono with server-rendered React and islands (P1.20 spike) | Accepted (pending merge) |
| [0016](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0016-design-source.md) | The unset.sh design sheet is the design source (P1.21) | Proposed |
| [0017](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0017-main-ruleset-applied.md) | Main ruleset applied; supersedes 0009 | Accepted 2026-10-06; merge sentence superseded by 0019 |
| [0018](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0018-edge-rate-limit-plugin.md) | Edge rate limiting with caddy-ratelimit, in memory only (P1.28) | Accepted 2026-10-07 (P1.28, #409) |
| [0019](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0019-verified-agent-merges.md) | Verified agent merges: a verifier session merges checked agent PRs (P0.15) | Accepted on merge (2026-10-12) |
| [0020](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0020-permanent-choices.md) | Permanent choices: Matrix server name, Tailnet Lock custody, permission set NSID (P1.32) | Superseded by 0025 |
| [0021](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0021-atproto-oauth-client.md) | @atproto/oauth-client-node as the OAuth client (P2.04) | Proposed (awaiting Alex) |
| [0022](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0022-web-egress-and-shared-plc.md) | web gets its own egress network; we use the shared PLC (P2.05e) | Proposed (awaiting Alex) |
| [0023](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0023-local-pds-publishes-to-shared-plc.md) | The local PDS publishes to the shared PLC, with a few fixed test accounts (P1.34t) | Proposed (awaiting Alex) |
| [0024](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0024-atproto-api-agent.md) | @atproto/api Agent as the XRPC client over an OAuth session (P2.07) | Proposed (awaiting Alex) |
| [0025](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0025-public-domains.md) | Public domains: app `unset.sh`, PDS `unset.ac`, handles `unset.im`, chat `unset.cc`; development `staging.unset.*` | Accepted by Alex 2026-10-19 |
| [0026](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0026-local-email-gate-exception.md) | Local-only email-gate exception for `alice.unset.im` and `bob.unset.im` (mechanism 2) | Proposed (awaiting Alex) |
| [0027](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0027-pds-frontend-distribution.md) | PDS frontend distribution replacement with unchanged backend and runtime configuration (P2.24a) | Accepted by Alex, 2026-10-18; implementation and release gates pending |
| [0029](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0029-media-domain.md) | Media domain `unset.site`; development `staging.unset.site` | Proposed (awaiting Alex) |
| [0030](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0030-pangolin-checks-at-our-edge.md) | Staging behind Pangolin: method scope and last-hop trust move to our edge, cookie and logging clauses of 0025 restated | Accepted by Alex 2026-10-19 |
| [0031](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0031-public-staging-pds.md) | Staging public through Pangolin, no login, no certificate at our edge; departs from 0025 and 0030 for dev only | Accepted 2026-10-20; Decision 2 and Decision 1's plain-http sentence superseded by 0032 |
| [0032](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0032-self-signed-dev-edge.md) | Self-signed certificate at the dev edge behind Pangolin; supersedes 0031 Decision 2 for dev only | Accepted 2026-10-20 |
| [0033](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0033-image-signing-keyless.md) | Image signing: keyless cosign with our exact workflow identity (P1.27s) | Accepted 2026-10-20 |
| [0034](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0034-docs-only-auto-merge.md) | Docs-only pull requests auto-merge when CI is green (P0.07e) | Proposed (awaiting Alex) |
| [0035](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0035-web-search-searxng.md) | Web search through our own SearXNG, queried by the server through net-guard (P3.14s) | Proposed (awaiting Alex) |
| [0036](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0036-staging-builds-from-source.md) | Staging builds its images from the checkout under `--env dev --source`; production stays signed and pinned (P1.37y) | Proposed (awaiting Alex) |
