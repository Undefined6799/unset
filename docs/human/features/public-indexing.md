# Public indexing

The indexer copies our members' published profiles into Postgres. The public page reads that copy and does not call a PDS on the request ([ADR 0052](../decisions/0052-ingest-our-pds-with-atproto-sync.md)).

## Route

[`interfaces/web/src/routes/@[actor]/+page.server.ts`](../../../interfaces/web/src/routes/@[actor]/+page.server.ts) serves `GET /@<handle>` and `GET /@<DID>`. It asks [`publicProfileStore.ts`](../../../infrastructure/postgres/publicProfileStore.ts). The profile and its cards come from the views `idx.public_profile` and `idx.public_section` (migration 0030), and the main page's card list from `idx.public_page` (migration 0042). The same statement also left-joins `app.discoverability` (migration 0034) for the member's search and AI choices. No row means both switches are off.

An unknown actor, a path that is not an actor, and a hidden, deactivated, deleted, erased, delisted or suspended account all answer 404. The views show only `idx.visible_account`. A found account under any other path is redirected to its canonical one: the verified handle, or else the DID.

With search and AI listing on for the whole site (`SEARCH_LISTING`, below), the page stays out of search results until the member turns on "Search engines may list my page" ([ADR 0062](../decisions/0062-member-search-and-ai-choices.md)). With it on, the load drops `noindex` from the shell and omits the `X-Robots-Tag` header. [`robots.txt/+server.ts`](../../../interfaces/web/src/routes/robots.txt/+server.ts) lists the pages whose members turned on AI search. [`sitemap.xml/+server.ts`](../../../interfaces/web/src/routes/sitemap.xml/+server.ts) lists the pages whose members turned on search engines. Settings › Privacy ([`settings/privacy/`](../../../interfaces/web/src/routes/settings/privacy), P1.21y) posts the choices to [`settings/search-and-ai/`](../../../interfaces/web/src/routes/settings/search-and-ai), which saves them and returns to `/settings/privacy?saved`. The search title, the description and a search result preview sit under a native "Advanced" disclosure. The preview shows the title, description and address the public page would publish, following the fields as the member types where the client runs. The preview shows the letter avatar until profile pictures are served from the media origin; the public page then gains `og:image` and the preview the same picture.

## Operation

The process is [`interfaces/indexer/`](../../../interfaces/indexer) ([ADR 0052](../decisions/0052-ingest-our-pds-with-atproto-sync.md)).

- [`main.ts`](../../../interfaces/indexer/main.ts) loads config and serves health. [`config.ts`](../../../interfaces/indexer/config.ts) rejects a bad setting before anything starts. Indexing is off unless `INDEXER_ENABLED` is set.
- [`compose.ts`](../../../interfaces/indexer/compose.ts) builds the adapters, or builds nothing when the flag is off.
- [`run.ts`](../../../interfaces/indexer/run.ts) starts the stream reader, then the passes. [`shutdown.ts`](../../../interfaces/indexer/shutdown.ts) stops them on SIGTERM.
- [`consumer.ts`](../../../interfaces/indexer/consumer.ts) applies stream frames. [`track.ts`](../../../interfaces/indexer/track.ts) tracks new members and backfills repos. [`handles.ts`](../../../interfaces/indexer/handles.ts) checks handles. [`account-jobs.ts`](../../../interfaces/indexer/account-jobs.ts) confirms account status. [`stream-watch.ts`](../../../interfaces/indexer/stream-watch.ts) watches the stream. [`health.ts`](../../../interfaces/indexer/health.ts) is the health read.

## Domain rules

[`domains/profile/index-plan.ts`](../../../domains/profile/index-plan.ts) decides what the index keeps from one verified commit. It keeps `sh.unset.profile`, the main page `sh.unset.page/self` (a page under another key is skipped, [ADR 0091](../decisions/0091-a-page-record-holds-the-card-list.md)) and `sh.unset.card`, checks each record against its lexicon, and ignores every other collection in the commit.

[`discoverability.ts`](../../../domains/profile/discoverability.ts) checks the search and AI choices. Both switches start off. The title is at most 70 characters and the description at most 200. [`crawlers.ts`](../../../domains/profile/crawlers.ts) builds `robots.txt` and the sitemap from those choices.

## Adapter

[`infrastructure/firehose/`](../../../infrastructure/firehose) reads the PDS stream and the repos: [`reader.ts`](../../../infrastructure/firehose/reader.ts), [`frames.ts`](../../../infrastructure/firehose/frames.ts), [`repo.ts`](../../../infrastructure/firehose/repo.ts), [`repoStatus.ts`](../../../infrastructure/firehose/repoStatus.ts) and [`handleOnPds.ts`](../../../infrastructure/firehose/handleOnPds.ts).

[`infrastructure/postgres/indexStore.ts`](../../../infrastructure/postgres/indexStore.ts) applies a commit. [`trackStore.ts`](../../../infrastructure/postgres/trackStore.ts) takes the track queue. [`handleStore.ts`](../../../infrastructure/postgres/handleStore.ts) stores a verified handle. The public page uses [`publicProfileStore.ts`](../../../infrastructure/postgres/publicProfileStore.ts) and no other store. That read joins `app.discoverability` as well as the two `idx` views. [`discoverabilityStore.ts`](../../../infrastructure/postgres/discoverabilityStore.ts) saves the member's own choices.

## Tables and grants

`idx` is derived. It can be dropped and rebuilt (rule DA-1). Moderator decisions live in `mod`, so a rebuild does not clear them. Migrations are in [`infrastructure/postgres/migrations/`](../../../infrastructure/postgres/migrations).

- `idx.account`, `idx.profile`, `idx.section`, `idx.record_blob`, `idx.relay_cursor`, `idx.ingest_stat`, `idx.dead_letter`, `idx.account_job`, `mod.account_state`, and the view `idx.visible_account` (0025). `indexer` holds the table grants. No role has a grant on `mod.account_state`.
- `idx.page` (0042) holds the main page; each card's `position` in `idx.section` is its place in that page's list. `indexer` holds the table grants, and `web` reads the view `idx.public_page`.
- `idx.track_request` (0026) is the queue. `web` may insert a row and cannot read or delete it. `indexer` may select and delete, and cannot insert. `finishChat` inserts the row in the transaction that marks onboarding done.
- The indexer may end sessions by executing `app.end_sessions_for_did` (0027). It gains no grant on an `app` table.
- `core.erased_did` and `core.tombstone_key` are the erasure tombstone. `idx.is_erased` answers from them (0028). No role is granted the tables.
- `idx.erase_deleted_account` (0029) lets the indexer erase an account the PDS has confirmed deleted.
- One verified handle has one holder (0031), a partial unique index on `idx.account`.
- `idx.public_profile` and `idx.public_section` (0030) are the only `idx` objects `web` may read. Both show accounts in `idx.visible_account` and run as their owner, so `web` needs no grant on the tables underneath.
- `app.discoverability` (0034) holds the search-engine switch, the AI-search switch, and an optional title and description. `web` may select, insert and update `did`, `search_engines`, `ai_search`, `search_title`, `search_description` and `updated_at`, and may delete a row. No other role has a grant ([`grant-matrix.json`](../../../infrastructure/postgres/grant-matrix.json)).

## Tests

Unit tests sit beside the files in [`interfaces/indexer/`](../../../interfaces/indexer), [`infrastructure/firehose/`](../../../infrastructure/firehose) and [`domains/profile/`](../../../domains/profile) (`discoverability.test.ts`, `crawlers.test.ts`).

Integration: [`tests/integration/indexer/compose.test.ts`](../../../tests/integration/indexer/compose.test.ts), [`recovery.test.ts`](../../../tests/integration/indexer/recovery.test.ts), [`tests/integration/postgres/idx-schema.test.ts`](../../../tests/integration/postgres/idx-schema.test.ts), [`index-store.test.ts`](../../../tests/integration/postgres/index-store.test.ts), [`track-store.test.ts`](../../../tests/integration/postgres/track-store.test.ts), [`handle-store.test.ts`](../../../tests/integration/postgres/handle-store.test.ts), [`public-profile-store.test.ts`](../../../tests/integration/postgres/public-profile-store.test.ts), [`indexer-app-access.test.ts`](../../../tests/integration/postgres/indexer-app-access.test.ts), [`erase-did.test.ts`](../../../tests/integration/postgres/erase-did.test.ts), [`tests/integration/web/public/public-profile.test.ts`](../../../tests/integration/web/public/public-profile.test.ts), [`search-and-ai.test.ts`](../../../tests/integration/web/public/search-and-ai.test.ts).

## When it is off or replaced

## Who sees the page

The member chooses who sees their page ([ADR 0078](../decisions/0078-who-sees-the-profile-page.md), P1.22a): Public, Signed-in members only or Only me, stored as `visibility` on their main page record `sh.unset.page/self` ([ADR 0091](../decisions/0091-a-page-record-holds-the-card-list.md); no page means Public). The index keeps a main page it cannot accept as a page with no cards shown only to its member, so a refused page never opens up. Settings › Privacy is one form: the choice, and under Public the Search and AI fields, shown only while Public is ticked. It posts to `POST /settings/search-and-ai`, which writes the choice to the PDS, then saves Search and AI while the page is public. `/@` reads an optional session. Anyone the choice leaves out gets the limited page ([`limited-profile.svelte`](../../../apps/web/lib/components/profile/limited-profile.svelte)): the avatar, name, handle and DID and one sentence, with Sign in on a page for signed-in members. It has no cards, description or link-preview tags and says noindex. A page that is not public is never listed: noindex, out of the sitemap, no AI search line in `robots.txt`, whatever the Search and AI choices say,, and the stored choices are kept for when it is public again. Search crawlers are still let in, so they read the noindex and drop a page that was listed. The record stays readable on the network, which the settings say beside the choice.

`SEARCH_LISTING` ([`config.ts`](../../../interfaces/web/src/lib/server/config.ts)) is `on` or `off`. It defaults to `off`, and the staging and local stacks set `off`. Off, every response carries `X-Robots-Tag: noindex` ([`server.ts`](../../../interfaces/web/server.ts)), and every page carries the robots meta element (the root layout). `robots.txt` refuses the training and AI search crawlers everywhere and lets `*` fetch every page, so search engines read the `noindex`. It names no sitemap, and the sitemap lists nothing. Members' choices are kept and do nothing until the switch is on, and Settings › Privacy says so.

`INDEXER_ENABLED` defaults to off ([`config.ts`](../../../interfaces/indexer/config.ts)). Off, [`compose.ts`](../../../interfaces/indexer/compose.ts) builds nothing: the process opens no pool, reads nothing and serves only its health endpoint, which reports the process disabled. The public page still reads the views and `app.discoverability`, so it keeps showing the last indexed copy. A member who finishes onboarding is still inserted into `idx.track_request`, and nothing reads that queue until a process with the flag on is running, so that member does not appear yet.

The source stacks turn the flag on. [`deployment/preflight/local-only.ts`](../../../deployment/preflight/local-only.ts) names `pds-admin` and `indexer` as `SOURCE_ONLY_SERVICES`, with the networks `pds_admin`, `pds_admin_pds`, `indexer_pds` and `indexer_egress`. The owner decided on 2026-11-19 to deploy from source for now, and to publish an image only when a service is ready for production. Those two services are built from the checkout in [`deployment/compose.local.yaml`](../../../deployment/compose.local.yaml) and [`deployment/compose.dev.source.yaml`](../../../deployment/compose.dev.source.yaml), and they are absent from [`deployment/compose.dev.yaml`](../../../deployment/compose.dev.yaml).

Their private networks to the PDS are allowed for local and dev only. [`deployment/preflight/checks/networks.ts`](../../../deployment/preflight/checks/networks.ts) gives production no exemption for `pds_admin_pds` or `indexer_pds`. How either service reaches the production PDS is open until the first production deploy (step P5.00).
