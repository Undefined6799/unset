# 0001 — Defaults taken to start Phase 0

Status: proposed, awaiting confirmation from Alex. Date: 2026-10-02.

## Context
[`PLAN.md`](../PLAN.md) §11 lists twelve open questions. Alex asked to continue before
answering them. Phase 0 proceeds on the plan's recommended answers where a choice is
reversible; choices that become permanent once an account exists wait for Alex.

## Decision
Taken as defaults (reversible, can be changed by a later ADR):
- **Q3 Web stack (confirmed by Alex, 2026-10-02):** Hono + server-rendered React + islands, built with Vite. Re-evaluated at
  the end of Phase 1 (switch to React Router v7 if the island helper exceeds ~150 lines).
- **Q4 Chat (Alex, 2026-10-02):** a core feature, not a module; built in Phase 6 on
  `chat.unset.sh`, Matrix DMs first. Beside the core but connected; Matrix confirmed; every
  user can message every other user, with message requests, block and report; the chat account
  is seeded at signup (account only, no tokens or keys made for the user), and signing in to
  chat with recovery-key setup is a step of signup, done by the user (plan §5.6).
- **Ozone (Alex, 2026-10-02):** we run Ozone as our labeler and report intake (Phase 5).
  Its moderator screens are Tailscale-only; it never holds PDS admin power, so takedowns stay in
  the admin panel via `pds-admin`. Bluesky posts in our feeds get Bluesky's labels and ours.
  Ozone's moderation tools (reports, queue, labels) replace the panel's reports queue (Alex),
  provided its login meets Tailscale-only plus a hardware key; otherwise back to Alex.
- **Launch gate (Alex, 2026-10-02):** no launch, invite-only included, until the whole core
  (Phases 1-6, chat included) is done with no known bugs (plan, after Phase 6).
- **Q5 Public profile:** `/@handle` on the app origin.
- **Q6 Database (confirmed by Alex, 2026-10-02):** one Postgres with per-role separation; the
  appview merges into the app, and the indexer runs as its own process.
- **Q7 Drafts:** stored in the app database; only Publish writes to the repo.
- **Q8 Social in core (confirmed by Alex, 2026-10-02):** posts, follows, timeline, likes, comments, directory.
- **Q9 Posts (Alex, 2026-10-02):** the main post is a short video (60 s max, high quality) in
  our own lexicon, with our own transcoding pipeline; users may also write Bluesky posts.
  Feeds get compressed renditions. Public posts are reviewed automatically (hash matching plus
  a classifier, uncertain cases to a person) before they are written to the repo; users are told
  so; every post keeps a report button. The review (Alex, 2026-10-02): hash matching on our own
  servers first (matches never leave them; report plus 21-day locked hold); then the Claude API
  reviews ~10 downscaled frames, the caption and a locally made transcript; unsure goes to a
  person. Anthropic is named as a processor for public posts only. Start on Sonnet and measure.
  Apply for PhotoDNA and a hash list before launch.
  Fingerprint check on every photo and video the app processes, private ones included
  (Alex, 2026-10-02); local only. Chat media (end-to-end encrypted) is open, review item 9.
- **Feeds (Alex, 2026-10-02):** atproto feeds as user-chosen, reorderable tabs in the core
  (plan §5.8).
- **Q10 Hosting (confirmed by Alex, 2026-10-02):** VPS for production, homelab for development.
- **Q11 Design (Alex, 2026-10-02):** all UI follows the unset.sh design sheet (Design System
  artifact "unset.sh"); its tokens feed the CSS Modules. New components only when registered
  on the sheet with Alex's approval; Iconoir may be integrated the same way.
- **Q12 License:** AGPL-3.0-only for now; Alex reviews it seriously before launch.
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
- **Admin panel (Alex, 2026-10-02):** fold in the admin panel design: separate `admin`
  process on `admin.int.unset.sh` over Tailscale, hardware keys, per-action signatures verified
  by `pds-admin`, signed roster, 7-day delete holds, hash-chained audit, minimal logging
  (plan §5.7, §6).
- **Spaces (Alex, 2026-10-02):** wanted for followers-only and private posts; nothing built
  until it matures. Re-check at Phase 4.
- **Tooling:** Node 24, npm workspaces, TypeScript 6 strict, Biome, node:test.

- **Q2a Old accounts (provisional, Alex to revisit, 2026-10-02):** start fresh. Old accounts are
  retired on the old PDS before the new one takes `0x40.space`. Permanent once the first
  production account exists, so it must be revisited before then.

## Consequences
Nothing in Phase 0 depends on Q2a. Its review must happen before the first production account,
since old `*.0x40.me` handles would collide with new ones.
