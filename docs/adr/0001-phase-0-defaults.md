# 0001 — Defaults taken to start Phase 0

Status: proposed, awaiting confirmation from Alex. Date: 2026-10-02.

## Context
[`PLAN.md`](../PLAN.md) §11 lists twelve open questions. Alex asked to continue before
answering them. Phase 0 proceeds on the plan's recommended answers where a choice is
reversible; choices that become permanent once an account exists wait for Alex.

## Decision
Taken as defaults (reversible, can be changed by a later ADR):
- **Q3 Web stack:** Hono + server-rendered React + islands, built with Vite. Re-evaluated at
  the end of Phase 1 (switch to React Router v7 if the island helper exceeds ~150 lines).
- **Q4 Chat:** a module after the core (Phase 6), Matrix DMs first.
- **Q5 Public profile:** `/@handle` on the app origin.
- **Q6 Database (confirmed by Alex, 2026-10-02):** one Postgres with per-role separation; the
  appview merges into the app, and the indexer runs as its own process.
- **Q7 Drafts:** stored in the app database; only Publish writes to the repo.
- **Q8 Social in core:** posts, follows, timeline, likes, comments, directory.
- **Q9 Posts lexicon:** our own, with a Standard.site spike in Phase 4.
- **Q10 Hosting:** VPS for production, homelab for development.
- **Q11 Design:** keep the token pipeline, colour roles, Iconoir, mono identifiers; re-decide
  the look in Phase 1.
- **Q12 License:** AGPL-3.0-only (changeable until the repository is public).
- **Styling (decided by Alex, 2026-10-02):** no CSS framework. Design tokens as CSS custom
  properties plus one CSS Module per shared component. CI enforces it with a token-only
  Stylelint rule, a no-global-CSS guard and a total CSS size budget.
- **Indexer source (provisional, Alex to review, 2026-10-02):** the indexer's upstream is a
  setting. Start with our own PDS only; reach network data later by pointing Tap at a public
  relay with collection filters. No own relay or full-network index for now.
- **Q2b Federation (Alex, 2026-10-02):** yes, but per user and opt-in. Private to the network
  by default; each user can choose to be listed in other atproto apps. Because a federating PDS
  exposes every record in every repo, a user's content stays out of their repo (app database)
  until they opt in. Still open: whether the `/@handle` page is public by default, and whether
  posts and follows follow the same rule.
- **Tooling:** Node 24, npm workspaces, TypeScript 6 strict, Biome, node:test.

Not taken; permanent, waiting for Alex:
- **Q1 Domains** (app, handle and PDS domains; lexicon namespace `sh.unset.*` follows the
  app domain).
- **Q2a** start fresh vs migrate 0x40 accounts and data.

## Consequences
Nothing in Phase 0 depends on Q1, Q2a or Q2b. Phase 1 needs Q1 before the production PDS
and lexicon authority are created.
