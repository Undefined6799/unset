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
  until they opt in. Anything in the repo is also public on `/@handle` (no false privacy), and
  the publish step states where it appears and that it is hard to take back. Posts and follows
  use the same opt-in, with two switches, "Profile" and "Posts and follows", each private or
  public (provisional, Alex to review; plan §11 Q2b).
- **Account management (Alex, 2026-10-02):** a small separate account app on
  `account.unset.sh` (PDS stays on `0x40.space`), an OAuth client using public PDS APIs only (no patches, no PDS DB
  access). It owns email, handle, password reset, deactivate and delete; sign-in, consent and
  likely 2FA/devices/apps stay on the branded PDS. Mirrors Bluesky's split of sign-in host
  vs settings, without an entryway. Plan §5.3.
- **Q1 Domains (Alex, 2026-10-02):** app `unset.sh`, account app `account.unset.sh`, PDS
  `0x40.space`, handles `<user>.0x40.me`. Lexicons `sh.unset.*`.
  The PDS stays on its own registrable domain, per atproto guidance; a PDS or entryway under
  `unset.sh` was considered and rejected (plan §11 Q1).
- **API and MCP (Alex, 2026-10-02):** the core has a small public read API (published data only,
  no key, rate-limited) and service-auth signed-in endpoints; MCP is a later module.
- **Tooling:** Node 24, npm workspaces, TypeScript 6 strict, Biome, node:test.

- **Q2a Old accounts (provisional, Alex to revisit, 2026-10-02):** start fresh. Old accounts are
  retired on the old PDS before the new one takes `0x40.space`. Permanent once the first
  production account exists, so it must be revisited before then.

## Consequences
Nothing in Phase 0 depends on Q2a. Its review must happen before the first production account,
since old `*.0x40.me` handles would collide with new ones.
