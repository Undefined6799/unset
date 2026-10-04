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
| [0008](0008-ruleset-without-required-approvals.md) | Main-branch ruleset without required approvals (decision 40) | Accepted 2026-10-04 |
| [0009](0009-no-branch-protection-on-free-private-repo.md) | No branch protection while the repository is private on the free plan (decision 41) | Accepted 2026-10-04 |
