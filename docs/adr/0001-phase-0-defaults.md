# 0001 — Defaults taken to start Phase 0

Status: proposed, awaiting confirmation from Alex; amended the same evening with Alex's 19 review decisions (see the dated block below). Date: 2026-10-02.

## Context
[`PLAN.md`](../PLAN.md) §11 lists twelve open questions. Alex asked to continue before
answering them. Phase 0 proceeds on the plan's recommended answers where a choice is
reversible; choices that become permanent once an account exists wait for Alex.

## Decision
Taken as defaults (reversible, can be changed by a later ADR):
- **Q3 Web stack (confirmed by Alex, 2026-10-02):** Hono + server-rendered React + islands, built with Vite. Re-evaluated at
  the end of Phase 1: framework glue budgeted at 400–900 lines, exit at ~600; the fallback is
  React Router 8 (v7 is superseded), with one Astro spike day (review, 2026-10-02; plan §5.1).
- **Q4 Chat (Alex, 2026-10-02):** a core feature, not a module; built in Phase 6 on
  `chat.unset.sh`, Matrix DMs first. Beside the core but connected; Matrix confirmed; every
  user can message every other user, with message requests, block and report; the chat account
  is seeded at signup (account only, no tokens or keys made for the user), and signing in to
  chat with recovery-key setup is a step of signup, done by the user (plan §5.6).
  Amended (Alex, 2026-10-02, evening, decisions 11–13): seeding runs in an isolated `chat-admin`
  service, never in `web`; the client ships `OnlySignedDevicesIsolationMode` from day one; a
  message request is the invite only, with no text until accepted (the earlier "messages sent
  meanwhile become readable later" is impossible in Matrix E2EE and is withdrawn); branded
  Element Web, configured not forked, is the launch fallback if the native client is late.
  Matrix `server_name` is fixed in Phase 1 (review).
- **Ozone (Alex, 2026-10-02):** we run Ozone as our labeler and report intake (Phase 5).
  Its moderator screens are Tailscale-only; it never holds PDS admin power, so takedowns stay in
  the admin panel via `pds-admin`. Bluesky posts in our feeds get Bluesky's labels and ours.
  Superseded in part (Alex, 2026-10-02, evening, decision 6): Ozone does **labels and
  post-publication reports only**. The "unsure" review queue for drafts lives in `admin`
  (~300–400 lines) with a written carve-out to the "no private data" rule for drafts submitted
  for publication, because Ozone's subjects are published records or DIDs and it renders our
  lexicon as raw JSON. Its login is atproto OAuth, so no hardware key is possible there; the
  Tailscale layer is the gate (review).
- **Launch gate (Alex, 2026-10-02):** no launch, invite-only included, until the whole core
  (Phases 1-6, chat included) is done. Restated (Alex, 2026-10-02, evening, decision 2):
  "no known bugs" becomes **no severity-1 or severity-2 bug open**, every test executed and
  passing, restore drill re-run after Phase 6, security tests and a final security review, with
  an estimated month count beside it (plan §8). A **closed test track** of at most 10 known
  people on the dev PDS with disposable accounts, "not a launch", runs from the end of Phase 2
  (decision 1).
- **Q5 Public profile:** `/@handle` on the app origin.
- **Q6 Database (confirmed by Alex, 2026-10-02):** one Postgres with per-role separation; the
  appview merges into the app, and the indexer runs as its own process.
- **Q7 Drafts:** stored in the app database; only Publish writes to the repo.
- **Q8 Social in core (confirmed by Alex, 2026-10-02):** posts, follows, timeline, likes, comments, directory.
- **Q9 Posts (Alex, 2026-10-02):** the main post is a short video (60 s max, high quality) in
  our own lexicon, with our own transcoding pipeline; users may also write Bluesky posts.
  Feeds get compressed renditions. Public posts are reviewed automatically (hash matching plus
  a classifier, uncertain cases to a person) before they are written to the repo; users are told
  so; every post keeps a report button. The review (Alex, 2026-10-02): fingerprint matching
  first; then the Claude API reviews ~10 downscaled frames, the caption and a locally made
  transcript; unsure goes to a person. Anthropic is named as a processor for submitted posts
  only. Start on Sonnet and measure.
  Amended (Alex, 2026-10-02, evening, decisions 4, 7, 8, 9, 18, 19; review): the repo blob is a
  re-encoded, stripped 1080p master, never the original; fingerprints (PDQ, TMK+PDQF) are
  computed locally and checked against C3P's Arachnid Shield, so hashes leave and media never
  does (this replaces "PhotoDNA on our servers", which cannot be built); a local nudity gate
  runs before Claude and nudity never leaves; the hold is **365 days** under C-16 (law since
  2026-06-18), with the uploader's address and time captured only at the moment of a match,
  sealed and destroyed with the hold, plus one Canadian lawyer hour; "also post to Bluesky" is
  an opt-in tick per post, default off; every video carries an author-editable caption track
  from the review transcript; a 2 GB per-account quota and a daily upload cap from day one, Alex
  funding hosting at first; first-publish consent is an explicit checkbox; appeals are decided
  by a person.
  Fingerprint check on every photo and video the app processes, private ones included
  (Alex, 2026-10-02). Chat media (end-to-end encrypted):
  no device scanning; reports with structured evidence (decrypted bytes plus the event's `file`
  block, fingerprint-checked), and no photos or videos from people you don't follow, enforced
  in our client, which the terms say protects our client only (Alex; review).
- **Feeds (Alex, 2026-10-02):** atproto feeds as user-chosen, reorderable tabs in the core
  (plan §5.8).
- **Q10 Hosting (confirmed by Alex, 2026-10-02):** VPS for production, homelab for development.
  Provider decided later, by Phase 5 (Alex, 2026-10-02, evening, decision 14), with the price
  comparison (OVH Canada ~CAD 12–17/mo vs 1984 Iceland ~€35–70/mo) on the review list; the
  backup provider waits with it (R2 has no Object Lock).
- **Q11 Design (Alex, 2026-10-02):** all UI follows the unset.sh design sheet (Design System
  artifact "unset.sh"); its tokens feed the CSS Modules. New components only when registered
  on the sheet with Alex's approval; Iconoir may be integrated the same way.
- **Q12 License:** AGPL-3.0-only for now; Alex reviews it seriously before launch.
- **Styling (decided by Alex, 2026-10-02):** no CSS framework. Design tokens as CSS custom
  properties plus one CSS Module per shared component. CI enforces it with token-only CSS lint
  rules (Biome 2.5; Stylelint optional), a no-global-CSS guard and a total CSS size budget.
- **Indexer source (resolved, Alex, 2026-10-02, evening, decision 5):** any atproto account may
  sign in from day one, so Tap follows the public relay with collection filters from Phase 3
  (~200–300 GB/day inbound, budgeted in the hosting choice). The earlier "upstream as a setting,
  own PDS first" wording is superseded. No own relay or full-network index.
- **Q2b Federation (Alex, 2026-10-02):** yes, but per user and opt-in. Private to the network
  by default; each user can choose to be listed in other atproto apps. Because a federating PDS
  exposes every record in every repo, a user's content stays out of their repo (app database)
  until they opt in. Anything in the repo is also public on `/@handle` (no false privacy), and
  the publish step states where it appears and that it is hard to take back. Posts and follows
  use the same opt-in, with two switches, "Profile" and "Posts and follows", each private or
  public (provisional, Alex to review; plan §11 Q2b).
- **Account management (Alex, 2026-10-02; superseded the same evening, decision 3):** the
  morning decision was a small separate account app on `account.<pds domain>`. The review showed
  the PDS refuses OAuth credentials for email change, deletion and reactivation by design, so
  the app is **dropped**: every account action, handle change and deactivate included, happens
  on the PDS's own branded `/account` page, deep-linked from the app. No `account.<pds domain>`
  host. Plan §5.3.
- **Q1 Domains (Alex, 2026-10-02):** app `unset.sh`, PDS `unset.ac` in production (`0x40.space`
  for development; the name is permanent once accounts exist, so it is registered before the
  production PDS), handles `<user>.0x40.me`. Lexicons `sh.unset.*`. Amended (evening): no account
  host; the media proxy on a cookie-less throwaway domain, not same-site with the PDS; the dev
  PDS mints `.0x40.space` handles, never `.0x40.me`; `PDS_RATE_LIMIT_BYPASS_IPS` for the app
  (review). The PDS stays on its own registrable domain, per atproto guidance; a PDS or entryway
  under `unset.sh` was considered and rejected (plan §11 Q1).
- **API and MCP (Alex, 2026-10-02):** the core has a small public read API (published data only,
  no key, rate-limited) and service-auth signed-in endpoints; MCP is a later module.
- **Admin panel (Alex, 2026-10-02):** fold in the admin panel design: separate `admin`
  process on `admin.int.unset.sh` over Tailscale, hardware keys, per-action signatures verified
  by `pds-admin`, signed roster, 7-day delete holds, hash-chained audit, minimal logging
  (plan §5.7, §6). Confirmed as a **web panel from the start** (Alex, 2026-10-02, evening,
  decision 15; the review's CLI-only v1 was declined): enrolment with attestation on desktop
  Chrome or Firefox only, phones assert only, `pds-admin` verifies assertions only (~80 lines of
  `node:crypto`) with `@simplewebauthn/server` in `admin`; the CI line ceiling becomes a
  3,000-line warning. The draft review queue and Matrix report intake live here (decision 6).
- **Spaces (Alex, 2026-10-02):** wanted for followers-only and private posts; nothing built
  until it matures. Re-check at Phase 4.
- **Tooling (Alex, 2026-10-02, evening, decision 16):** Node 26 and TypeScript 7 strict from
  Phase 1 (the morning default of Node 24 and TypeScript 6 is superseded: TS 6 is the last
  JS-based release and Node 24 enters maintenance 2026-10-20), npm workspaces, Biome (CSS lint
  included), **Vitest only** (node:test dropped so there is one runner), Playwright with axe-core,
  Lighthouse CI, Semgrep.
- **Compliance and measurement (Alex, 2026-10-02, evening, decisions 10, 17, 19):** no EU, UK or
  Australian invitees until a representative and age assurance exist (one sentence in the
  terms); a nightly table of rounded, service-wide aggregate counts kept 13 months, in the
  privacy notice; OWASP ASVS 5.0 L2, WCAG 2.2 AA and a Core Web Vitals budget as hard
  requirements with CI gates; the SOC 2 / ISO 27001/27017/27018 / ISO 42001 certification track
  is **kept on paper** (Alex chose to keep it; audits are a later cost). Plan §6, §6.1.

- **Q2a Old accounts (provisional, Alex to revisit, 2026-10-02):** start fresh. Old accounts are
  retired on the old PDS before the new one issues `*.0x40.me` handles. Permanent once the first
  production account exists, so it must be revisited before then.

## Review decisions (Alex, 2026-10-02, evening)

Taken on cards after the eight-reviewer adversarial review (`reviews/fable-review/00-synthesis.md`). Where Alex chose differently from the recommendation, the choice is recorded, not the recommendation.
1. Closed test track: yes. At most 10 known people, dev PDS, disposable accounts, "not a launch", from the end of Phase 2.
2. Launch gate restated: yes. Whole core done, no severity-1 or -2 bug open, drills and reviews pass, month estimate shown.
3. Account app: **dropped** (the review proposed a thin surface). All account actions, handle change and deactivate included, on the PDS's own `/account`; no `account.unset.ac` host.
4. Bluesky post on video publish: **opt-in per post**, "also post to Bluesky" tick, default off (the review proposed default on).
5. Sign-in: **any atproto account from day one**; Tap follows the public relay with collection filters from Phase 3 (the review leaned closed; review-list item 1 resolved).
6. Draft review queue in `admin` (~300–400 lines); Ozone does labels and post-publication reports only; written carve-out to "no private data" for drafts submitted for publication: yes.
7. Fingerprints (PDQ/TMK, computed locally) of all media, private included, checked against C3P Arachnid Shield; media never leaves; the terms say so: yes.
8. Local open-source nudity gate before Claude; nudity is a fail or a human case and never leaves; Claude sees only nudity-free frames: yes.
9. C-16: 365-day sealed hold; uploader address and time captured only at the moment of a fingerprint match, sealed and destroyed with the hold; one Canadian lawyer hour before production: yes.
10. EU, UK and Australian invitees: **not yet**; invite-country rule and one sentence in the terms until a representative (EU/UK) and age assurance (AU) exist.
11. Chat: build the native client; branded Element Web (configured, not forked) is the launch fallback if it is late.
12. Message requests are the invite only; no text until accepted: yes.
13. Chat device trust: isolated `chat-admin` seeding service plus `OnlySignedDevicesIsolationMode` from day one: yes.
14. Hosting: **decide later, by Phase 5** (the review recommended OVH Canada now); on the review list with the price comparison; the backup provider waits with it.
15. Admin: **web panel from the start** as designed, WebAuthn plus phone (the review proposed a CLI v1); CI ceiling a 3,000-line warning; enrolment on desktop Chrome/Firefox, phones assert only; `pds-admin` verifies assertions only.
16. Tooling: TypeScript 7 and Node 26 from Phase 1: yes.
17. Measurement: nightly rounded aggregate counts, service-wide, 13-month retention, in the privacy notice: yes.
18. Caps: per-account storage quota (2 GB) and a daily upload cap from day one; Alex funds hosting at first; paid plans later: yes.
19. Standards: ASVS 5 L2, WCAG 2.2 AA and the Core Web Vitals budget as hard requirements with CI gates; captions on every video (editable track from the review transcript); **keep** the SOC 2 / ISO certification track on paper (the review proposed dropping it).

## Step-book gaps (2026-10-02, 22:25Z)

While turning the plan into build steps, the step-book thread found nine sequencing gaps
(`unset-plan/breakdown/plan-issues.md`). Seven are adopted as plan defaults, two go to Alex:
- Adopted: the image fingerprint gate, a signed-draft-URL `media` stub and an `invite.issue`-only
  `pds-admin` stub move to Phase 2 (gaps 2, 5, 8); the `review` worker is split into a
  no-network compute container and a `review-egress` step limited to two fixed hosts (gap 3);
  Phase 3 reports live in an app table listed by `admin` until Ozone arrives in Phase 5 (gap 6);
  comments are `sh.unset.comment` records and the private-account matrix is decided before Phase 4
  (gap 7); the bootstrap bundle is moved to TypeScript 7, Node 26, Vitest and the full CI list in
  the first commits (gap 9).
- Gap 1 decided by Alex (22:31Z, decision 20): **the production PDS is deferred to Phase 5**; the
  lexicon authority account starts on the development PDS and migrates later.
- Gap 4 decided by Alex (22:32Z, decision 21): **every upload holds a short sealed buffer** of
  address, time and route, encrypted to the legal-hold key, hard expiry at the check deadline,
  moved into the hold on a match and destroyed otherwise; the one written exception to the
  no-address-logging rule, named in the privacy notice and confirmed in the lawyer hour.
- Phase 4 review batch (22:46Z), adopted as plan defaults: scopes for `getFeedGenerators`, `getPostThread`
  and Bluesky `createReport` requested from day one; draft expiry skips open appeals (alert after 7 days);
  the `api` `getTimeline` serves third-party clients only; the development PDS is monitored while it hosts
  the lexicon authority; on a 413 from a foreign PDS the repo blob falls back to the 720p rendition (card to
  Alex); `review-egress` may also reach internal `pds-admin` for `preserve.create`; TMK+PDQF dropped from v1;
  captions and the fallback thumbnail are repo blobs; publish after review restores the session server-side.
- Decision 22 (Alex, 22:55Z): on a foreign PDS 413 the 720p fallback is **offered to the user, never
  automatic**; the draft waits for their choice and the downgrade is shown on the post.
- Third batch (22:54Z): Tap and the indexer get general HTTPS egress through `net-guard` (private
  ranges blocked), `pds-admin` only the PDS; public pages carry no cookie variation (theme and language
  from client hints, cookies on signed-in pages only). Open to Alex: retiring the old prototype accounts
  on `0x40.space` before the development PDS takes that hostname in Phase 1.
- Phase 2 sign-in review (2026-10-03 02:52Z): the extra Bluesky calls are plain `rpc:` scopes beside the
  `include:`; `createReport` uses `aud=*` so Ozone needs no re-consent in Phase 5; `identity:handle` and
  `account:status` are not requested (handle change and deactivation live on the PDS page per decision 3;
  operator deactivation via `pds-admin`).

## Consequences
Nothing in Phase 0 depends on Q2a. Its review must happen before the first production account,
since old `*.0x40.me` handles would collide with new ones. The evening decisions change Phase 1
inputs (TypeScript 7, Node 26, the Matrix `server_name`, the Tailnet Lock recovery choice, the
legal paperwork) and remove one process (the account app) while adding three (`api`, `review`,
`chat-admin`); the plan's §4 size table and §8 phases were restated to match.
