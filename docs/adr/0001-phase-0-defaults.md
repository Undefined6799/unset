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
- **Q6 Database:** Postgres with per-role separation.
- **Q7 Drafts:** stored in the app database; only Publish writes to the repo.
- **Q8 Social in core:** posts, follows, timeline, likes, comments, directory.
- **Q9 Posts lexicon:** our own, with a Standard.site spike in Phase 4.
- **Q10 Hosting:** VPS for production, homelab for development.
- **Q11 Design:** keep the token pipeline, colour roles, Iconoir, mono identifiers; re-decide
  the look in Phase 1.
- **Q12 License:** AGPL-3.0-only (changeable until the repository is public).
- **Tooling:** Node 24, npm workspaces, TypeScript 6 strict, Biome, node:test.

Not taken; permanent, waiting for Alex:
- **Q1 Domains** (app, handle and PDS domains; lexicon namespace `sh.unset.*` follows the
  app domain).
- **Q2a** start fresh vs migrate 0x40 accounts and data.
- **Q2b** whether the PDS federates to the Bluesky relay.

## Consequences
Nothing in Phase 0 depends on Q1, Q2a or Q2b. Phase 1 needs Q1 before the production PDS
and lexicon authority are created.
