# 0001 — Defaults taken to start Phase 0

Status: proposed, awaiting confirmation from Alex; amended the same evening with Alex's 19 review decisions (see the dated block below). Date: 2026-10-02.

**Append-only decisions log since 2026-10-04 (decision 35, D8).** This record collected decisions 1 to 34 by editing. From decision 35 on it is a log: entries are appended at the end of the Decision section and never rewritten, every new decision also gets its own ADR (`0002` onwards), and an accepted ADR changes only to be marked superseded. The docs test allows appends to this file alone.

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
  meanwhile become readable later" is impossible in Matrix E2EE and is withdrawn); the
  branded Element Web launch fallback was dropped on 2026-10-03 (decision 11 revised, below).
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
  on the sheet with Alex's approval; Iconoir became the icon set on 2026-10-03 (decision 33, below).
- **Q12 License (decision 27, Alex 2026-10-03):** AGPL-3.0-only for the apps, MIT for the building blocks and the lexicon files.
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
11. Chat: build the native client; branded Element Web was the launch fallback until Alex dropped it on 2026-10-03 (revision below).
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
  from client hints, cookies on signed-in pages only). Decision 24 (Alex, 2026-10-03 11:43Z): the old prototype accounts on
  `0x40.space` are exported or notified, deactivated and tombstoned before the development PDS takes that
  hostname in Phase 1; "start fresh" is final.
- Phase 2 sign-in review (2026-10-03 02:52Z): the extra Bluesky calls are plain `rpc:` scopes beside the
  `include:`; `createReport` uses `aud=*` so Ozone needs no re-consent in Phase 5; `identity:handle` and
  `account:status` are not requested (handle change and deactivation live on the PDS page per decision 3;
  operator deactivation via `pds-admin`); `repo:app.bsky.graph.follow` is added, since public follows are
  written as Bluesky follow records.
- Arachnid Shield facts (2026-10-03 02:55Z, from the official SDK source): PDQ-only lookup, MD5 dropped;
  own small client instead of the axios SDK so the call goes through `net-guard`; a spike with the
  provider's test hash precedes the Phase 2 image gate; the exact-vs-near reporting split is a
  lawyer-hour item. Whether operator uploads may bypass the gate before access is approved is being
  asked in the step-book thread.
- Ozone and PDS facts (2026-10-03 02:57Z, from source): `PDS_MOD_SERVICE_DID` is never set (it would make
  Ozone a PDS admin); only the report-service pair points at Ozone. PDS rate limits are enabled and our
  services use the bypass key, not addresses (no CIDR support). Open to Alex, queued: how moderators reach
  Ozone, since its UI works only through the moderator's PDS to a public endpoint.
- Decision 23 (Alex, 2026-10-03 02:58Z): the live Arachnid Shield check is connected close to deployment,
  not in Phase 2, since only trusted people use the app until then. Safeguards: apply for access in
  Phase 1; keep the slot with a fake in tests and a production start-up refusal without the real check;
  scan every test-period upload once connected, as a launch-gate item. The real client, its spike
  and the C-16 buffer move to Phase 5, before the production PDS; Phases 2 and 4 run the stage with a fake. Decision 7 is unchanged for the
  public product. This closes the "no unchecked uploads" question.
- Phase 1 review facts (2026-10-03 03:00Z, `@atproto/pds` 0.5.37): the PDS logs client IPs and stores them
  in its OAuth device table, so the provisional default (card queued for Alex) is the Synapse treatment:
  no client IP forwarded, PDS request logging off, per-client limits at the edge in memory, PDS per-IP
  limits off, and `web`'s own traffic through the edge gets a measured class of its own rather than an
  exemption; this supersedes the bypass-key line above. Image fingerprints reach `review-egress` through a job
  row, so Arachnid credentials live only there. A changed permission set reaches existing
  grants at refresh, so set changes are Alex-gated PRs and a CID change is an incident. Signing is cosign
  with a key pair and no public transparency log, upstream images mirrored and signed. The dev PDS gets
  integrity checks and a best-effort probe instead of an availability percentage.
- Phase 6 chat review facts (2026-10-03 03:01Z, Synapse 1.162, MAS 1.26, matrix-js-sdk 43, Element): the
  edge strips `User-Agent` for chat and MAS; the Synapse `user_may_invite` module is the one written Python
  exception (stdlib only, black-box tested, pinned image); report intake used a non-human service account
  behind a path-restricted proxy (confirmed by decision 32, 90-day rotation) and `/_synapse/admin` is blocked publicly; sign-out reaches MAS by
  back-channel logout from `chat-auth`; the Element fallback kept most but not all decisions (DM history
  visibility, device isolation flag, partial media gate), which is why it was dropped (decision 11 revised).
- Decision 25 (Alex, 2026-10-03 11:43Z): the plugin seam is **trimmed** to what cannot be retrofitted
  (erase/export hooks, per-plugin schema-and-role rule, middleware order, explicit composition root);
  manifest, registry, nav slots, cron/mail/notification interfaces, tenancy tables and the fixture plugin
  wait for the first real plugin, per the engineering principles 3, 7, 12 and 15. §4 row ~500 → ~100.
- Decision 26 (Alex, 2026-10-03 12:02Z): moderators reach Ozone by **credential login with an app password
  over Tailscale**; UI and `tools.ozone.*` stay tailnet-only; legacy password path revived for moderator
  accounts only; the Phase 5 spike confirms the direct path or the question returns to Alex.
- Decision 27 (Alex, 2026-10-03 11:49Z, step-book thread): licence AGPL-3.0-only for `apps/`, MIT for
  `packages/` and the lexicon files; the lexicons publish under MIT; off the review list.
- Decision 28 (Alex, 2026-10-03 16:21Z, step-book thread, "Mixed by target"): a public member's follow of an
  unset.sh account is our own `sh.unset.follow` record (flat name, aligned with the step book on
  2026-10-03: every `sh.unset.*` schema then resolves from the one `_lexicon.unset.sh` DNS record,
  where `sh.unset.graph.follow` would need a second record for the `graph.unset.sh` authority); a follow of a Bluesky account is
  `app.bsky.graph.follow`; private follows stay in the app; the Following tab merges both. Bluesky's app
  will not show unset.sh-to-unset.sh follows. The new lexicon joins the permission set before Phase 1
  publishes it.
- Decision 29 (Alex, 2026-10-03 11:51Z, step-book card): admin actions may record the acting admin's
  private tailnet address, staff only, 2-year retention with the admin action log, listed in the RoPA;
  the one narrow exception to the no-IP rule. Sign-in history stays counts only.
- Decision 30 (Alex, 2026-10-03 16:22Z to 16:38Z, step-book thread and its "Local check, Llama" card):
  moderation is local-first in v1 and nothing about a post leaves our servers for review. A local text
  gate (spam and link rules, Detoxify multilingual, Llama Guard 3 1B) checks comments, captions, subtitles,
  transcripts and Bluesky post text in the no-network compute container; S4 child sexual exploitation is
  blocked and goes to a person for the Cybertip.ca decision, other unsafe results and self-harm are held,
  the rest is allowed. A small local gore classifier joins the image gates, hold-only until measured.
  Unsure results go to a human reviewer. The Claude API review of frames, captions and transcripts is
  removed from v1 and kept as a documented later option, switched on only after measurement shows the
  local tools are not enough and Alex approves. Consequences: `review-egress` reaches Arachnid Shield
  alone and Anthropic leaves the processor list; the first-publish consent checkbox is dropped; RoPA,
  privacy notice and AI system record list the local models with pinned hashes; gates run in shadow mode
  first against a labelled EN/FR set kept outside the repo. Lawyer-hour items: the "Built with Llama"
  notice for a server-side check, NudeNet's YOLOv8-derived weight licence, the reporting duty for
  written material in comments. Captions: automatic subtitles from local speech-to-text, creator-editable,
  viewer CC toggle, still mandatory under decision 19.
  Suspected material (Alex, 16:39Z): a suspected-CSAM item with no fingerprint match is blocked and sealed
  under the legal hold, the owners get an emergency alert, a person files the Cybertip.ca report (Arachnid
  Shield is a hash lookup, not a channel), police are called directly if a child is in imminent danger, the
  uploader's uploads are frozen, nothing goes to a third party; duties and deadline for suspected versus
  matched material join the lawyer hour.
- Decision 31 (Alex, 2026-10-03 16:41Z, step-book question 33, "Through our server", chosen over the
  recommended text-and-link option): pictures inside Bluesky posts are proxied through our own `media`
  server so viewers' addresses never reach Bluesky. `media` gains one outbound connection, to the fixed
  Bluesky CDN or `getBlob` hosts through `net-guard` (no redirects, size cap); each image is re-encoded
  with metadata stripped, PDQ-checked under the every-picture rule, cached briefly by CID and served with
  the sandbox CSP and `nosniff`. The design's "media makes no outbound connection" rule is amended for
  this alone. Step-book question 32 (reviewer may play a logged 360p copy of an unsure draft) is noted in
  the §4 queue row.
- Decision 32 (Alex, 2026-10-03, step-book question 50: "Email only" at 16:52Z, revised at 16:55Z to
  "make our service account, 90 days"): our own chat client sends reports to `web`'s report route
  (`app.report` rows, `source = 'chat'`); reports from other Matrix clients reach the same `admin` inbox
  through one limited chat-server service account scoped to the report and media admin paths, its
  credential rotated every 90 days behind a path-restricted proxy. The email-only intake is dropped. Same-day step-book answers recorded in the plan: chat defaults confirmed,
  chat follows the account automatically, the server enforces no text before acceptance, the Python
  carve-out is allowed (questions 46 to 49); all four extra admin tools get built (45); backups kept
  30 days, RPO 24 h, core RTO 4 h (38, 44); picture uploads get the decision 21 sealed buffer (43);
  reports on Bluesky posts are forwarded from our moderation account, unset.sh reports never (36);
  reviewers may play a logged, never-downloadable 360p copy except for suspected or matched abuse
  material (32); Bluesky blocks apply (34); hosting, media storage, mirror and backup provider are
  decided together at the start of Phase 5 with the privacy-provider comparison (37, 39 to 42).
- Decision 11 revised (Alex, 2026-10-03 16:57Z, step-book question 53, "Drop backup app", chosen over the
  recommended "keep, known gap"): no branded Element Web fallback; our own chat client is the only one we
  ship, brand and support. If the native client is late, chat is late. People whose browser cannot run it
  cannot chat. The server-side rules still apply to any third-party Matrix client.
- Step-book answers 21, 25, 34 and 52 (Alex, 2026-10-03), recorded in the plan: a paid email sending
  service in Canada or the EU (team shortlist, Alex picks) joins the RoPA; an outside dead-man's-switch
  heartbeat with no personal data; signed-in members' Bluesky blocks apply to unset.sh feeds; chat is
  bound to the account's login, a mismatched chat session is wiped and re-signed-in with no retry, and
  app sign-out ends that browser's chat device.
- Decision 33 (Alex, 2026-10-03 18:00Z, design thread, list approved on a card at 18:02Z): Iconoir is the
  icon set for all icons, replacing the sheet's Unicode glyphs; 36 approved icons copied from Iconoir 7.12.1
  regular (MIT) onto the design sheet as pinned SVG data, rendered inline by the UI kit with `currentColor`,
  `aria-hidden` and a text label; no icon npm package, nothing fetched; the build check blocks icon
  packages. New icons go on the sheet first with Alex's approval. Chat's device-verification emoji panel
  is the one exception (Matrix fixes the set).
- Decision 34 (Alex, 2026-10-04 04:39Z, "Apply all" on the architecture-handoff card; "Ok i reviewed
  conflict.md and it makes sense"): Alex's "Project Architecture & Development Handoff" becomes the fourth
  engineering guideline, with amendments A1 to A6 (`docs/human/engineering/architecture-and-development-
  guideline.md`; rationale in `unset-plan/architecture-handoff/conflicts.md`). A1 layout:
  `apps/{web,admin,chat}`, `interfaces/{http,api,indexer,media,review,pds-admin,chat-admin}`,
  `domains/{identity,content,social,feed,messaging,moderation,privacy}`, `infrastructure/{postgres,pds,tap,
  matrix,storage,arachnid,email,net-guard,seal,audit}`, `shared/{lexicons,ui,config,errors,i18n}`,
  `deployment/`, `tests/{integration,e2e}`, `docs/{human,ai}`; `packages/`, `modules/`, `plugins/` removed;
  process, DB-role and network isolation unchanged; folders created only with their first code. A2 tooling
  stays Biome + dependency-cruiser with the boundary rules (domains never import infrastructure, interfaces
  or apps; apps never import each other or infrastructure; the two admin services import only themselves).
  A3 CI: security and supply-chain checks from the first commit, image scan and signing with the first
  image, axe and Lighthouse with the first page. A4: first slice is sign in and see your own profile.
  A5: unit tests beside their file, integration and e2e under `tests/`. A6: MIT is `shared/`, the rest
  AGPL-3.0-only. Defaults D1 to D6: Terraform and Ansible under `deployment/` only at P5.00; no Redis or
  queue; docs split into `docs/human/` (ADRs in `decisions/`, guidelines in `engineering/`) and `docs/ai/`
  (plan, step book, handoffs); no `plugins/` until the first plugin; CLAUDE.md imports the fourth
  guideline; feature ownership paths recorded per phase. The ChatGPT original is source only, not binding.
  Alignment with the step book (2026-10-04 05:04Z): the §7 tree also names `interfaces/admin` (the admin
  server), `interfaces/{jobs,retention,audit-verify,chat-auth}`, `shared/log` and `scripts/`; the Phase 1
  sign-in slice carries sealed token storage, a minimal audit row, login and edge rate limits, the UI shell,
  the onboarding and email gates and `/me` (about 48 steps, local PDS, no Tailscale), and Phase 2 builds on
  it. The boundary-rule exceptions the book raised (admin-shared signing format, the chat identity verifier,
  matrix-js-sdk in the browser client, @atproto/lex in shared/lexicons, the SSR edge from interfaces/http
  to apps/web) were settled by the architecture thread at 05:10Z as refinements of the guideline (no Alex
  decision changed): interfaces never import each other and the server kit lives in `shared/http`; the two
  admin services get a zero-dependency allowlist (`shared/admin-envelope` today, additions need Alex's
  approval); one vendor-SDK adapter folder per runtime (`apps/chat/matrix` for matrix-js-sdk,
  `shared/lexicons` for @atproto/lex); the serving interface may import its app's render entry;
  `infrastructure/matrix/synapse-module` holds the Python exception; `scripts/` is tooling only; docs/human
  is anything a person must read or follow. Plan §7 and the repo guideline carry the refined text.

- **Decision 35 (Alex, 2026-10-04 12:56Z, "Adopt all" on the architecture handoff card; own record: [0002](0002-engineering-rules.md)):** the 48
  book-derived engineering rules (`docs/human/engineering/engineering-rules.md`) are the fifth engineering
  guideline, with the recommended option for each of its nine open choices: D1 a function does one job at one
  level of abstraction, never split to meet a line count; D2 Beams-style commit subjects with the step id in
  front, no Conventional Commits, squash-only merges, checked by `scripts/guards/commit-msg.ts`; D3 PR size
  warns above about 400 changed source lines and fails above 800 without a `large-pr` label and reason, tests
  excluded; D4 at most three agent PRs waiting for Alex, sev-1/2 fixes excepted; D5 the minimal
  digest-verified deploy (verify, pull by digest, preflight, migrate, smoke, rollback) lands at the end of
  Phase 2 for the closed-test host; D6 Stryker deferred, reconsidered for the Phase 5 security tests; D7 a
  private profile answers like a missing one (`ProfilePrivate` folds into `AccountUnavailable` for everyone
  but the owner; plan §5.4); D8 this record becomes an append-only decisions log and each new decision gets
  its own ADR; D9 per-service operational health signals are allowed beside `metrics_daily`, never per user,
  retention in the retention table and the RoPA (decision 17 clarified). CLAUDE.md imports the rules' Top 15
  page. The plan wins over a rule; the architecture guideline wins on structure.
- **Translations after the first slice (Alex, 2026-10-04 12:58Z, "English first" on the step-book card, against the
  recommendation):** slice 1 ships English text kept in one messages module per feature; the i18n slice
  (P1.19, EN/FR catalogs) follows as its own slice and converts those modules first; no French page ships
  before it lands.

- **Decision 34 trimmed by one folder (architecture thread, 2026-10-04 13:35Z, after the plan review against the
  engineering rules, finding R5-01; no Alex decision changed):** `interfaces/retention` is dropped. `interfaces/jobs`
  runs all scheduled work, the retention classes included, under the retention database role (as step P4.25
  already does). A future job that needs a different grant becomes its own process with an ADR naming its driver
  (rule AB-3). Drivers of the remaining phase-added processes: `jobs` keeps the deleting grants out of `web`;
  `audit-verify` checks the audit chain heads with no write grant; `chat-auth` keeps OIDC issuance out of `web`.
  `docs/human/architecture.md` (rule AB-4) records the ranked driving characteristics and the checked rules.

- **Decision 36 (Alex, 2026-10-04 13:46Z, "Close it" on the plan thread's card; own record: [0003](0003-chat-lookup-private-members.md)):**
  chat's handle lookup answers "no such member" for a private member, the same as for a stranger, so chat leaks no
  more than the profile page does under D7. Private people are reached only from an existing conversation or a request
  they sent; the Everyone/Nobody request setting may reopen lookup per person later. Plan §5.6; step P6.06a.

- **Decision 37 (Alex, 2026-10-04 13:50Z, typed in the plan thread while card 2 was open; own record: [0004](0004-no-false-sense-of-privacy.md)):**
  "I do not wish to create a false sense of privacy. So if a member could be found from another appview or something
  like that, we should also display it." Whatever the network can already show about a member, unset.sh shows too; only
  what the network cannot see is hidden. Applied to the Q2b matrix: profile private with posts public shows the public
  posts under a bare handle on post pages, in feeds and in the read API, Follow on the post page, `/@alice` unavailable
  (plan §11 Q2b; step P4.00). Decision 36 stands: chat membership is not visible from the network.

## Consequences
Nothing in Phase 0 depends on Q2a. Its review must happen before the first production account,
since old `*.0x40.me` handles would collide with new ones. The evening decisions change Phase 1
inputs (TypeScript 7, Node 26, the Matrix `server_name`, the Tailnet Lock recovery choice, the
legal paperwork) and remove one process (the account app) while adding three (`api`, `review`,
`chat-admin`); the plan's §4 size table and §8 phases were restated to match.
