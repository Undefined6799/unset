# Phase 4 — video intake, review and publish; playback, social, feeds, labels, reports, expiry, export, metrics, exit (P4.01–P4.28)

Status: **draft, editor pass** (2026-10-03). Merged on 2026-10-03 from `phase-4-part1.md` (P4.01–P4.15, writer pass 2
of 2026-10-02, round-1 review `reviews/r1-phase-4-part1.md` applied) and `phase-4-part2.md` (P4.16–P4.28, writer pass 2,
round-1 review `reviews/r1-phase-4-part2.md` applied); both rounds are recorded under "Notes for the editor". Planning
only: no code. Source of truth: [`../unset-sh-rebuild-plan.md`](../unset-sh-rebuild-plan.md) §2 (rules 6, 8, 10, 13),
§5.2, §5.4, §5.7, §5.8, §6, §6.1, §8 Phase 4, §11 Q2b and Q9, decisions 21–23; [`plan-issues.md`](plan-issues.md)
items 2, 3, 4, 7, 14 and 22. Where this file and the plan disagree, the plan wins; every disagreement found is listed
under "Notes for the editor" at the end. Depth of detail (README): Phase 4 keeps full detail only where a mistake is
hard to undo (data model, trust boundaries, roles, lexicons, legal flows, stop points, "done when"); the algorithm
sections are a reviewed hypothesis that the phase's first step (P4.00, "Refine Phase 4", an outline row) re-reads
against what was built.

**P4.00 also records feature ownership (decision 34, guideline §4; editor pass 2026-10-04).** When P4.00 gets its body
it adds a "Feature ownership" table to this file: for each feature (video posts, review, playback, follows, likes,
comments, feeds, labels, reports, expiry, export, metrics) its ownership path before any code, for example posting a
video: `apps/web → interfaces/http → domains/content (+ domains/moderation) → infrastructure/pds, storage → PDS`; and it
settles the `layout-map.md` placements this phase uses (`interfaces/jobs`; the O-11 review-worker judgement calls, which P4.00 confirms). The step that lands a
feature's first slice writes `docs/human/features/<feature>.md`; `scripts/docs/docs.test.ts` checks that each exists.

**P4.00 also moves the legal-hold definers out of P4.07 (step book thread, 2026-10-04 late).** P4.07's feature migration creates six SECURITY DEFINER legal-hold functions, including `core.is_held`. Under SE-6 these are trusted base even when new, so P0.09c fails a PR that mixes them with feature code. P4.00 moves them into P4.07k, or a new P4.07t when they must follow P4.07's tables, and names them on the CODEOWNERS `# trusted functions:` line in that same step. Until then the classifier's fail-closed fallback applies: a migration whose file name contains `legal-hold`/`legal_hold`, or whose function body names a `legal_hold` table, is treated as trusted base when it defines a SECURITY DEFINER function.

**P4.00 also settles the step-book findings routed to it (editor pass 2026-10-04, findings;
`reviews/step-book-findings-triage.md`):** F-12 (a maximum review-queue depth above which `PUT /upload/video` answers 503
with `Retry-After`, never a silent drop); F-21 (one pure `transition(current, event)` per state machine, `video_upload`
first, with a guarded `UPDATE … WHERE state = $expected` and a table test over every pair, that the steps call instead of
writing `state` themselves); F-28 (responses built field by field from view types; AppView `getTimeline`/`getFeed`
answers size-capped and schema-validated in `infrastructure/`, with a malformed fixture per adapter); F-29 (captions,
display names and report text shown to reviewers safe against bidi and invisible characters); and the visibility rule
of F-01: Phase 4 reads "active and not delisted or suspended" only through `idx.visible_account`, never from columns
(the "Interfaces assumed" row for P3.03 predates `mod.account_state`). P4.00 also writes the `Threats:` heading for
each `[SEC]` step whose algorithm it settles.

**P4.00 also applies decision 37 (Alex, 2026-10-04 13:50Z; plan `9859642`, ADR 0004; review finding R3-04).** The rule:
whatever another app can show about a member, unset.sh shows too. P4.00 does two things:
- It fills the plan's §11 Q2b table with this rule. A member with a private profile and public posts has those posts
  shown under the bare handle, with no profile link, on `/@alice/p/{rkey}` (P3.12 step 9), in every feed (P4.21,
  P4.22) and in the read API (P3.10 `getAuthorFeed`, `getPost`). Follow lives on that post page (P4.18). `/@alice`
  stays the `unavailable` 404 (D7).
- It checks that every feed and post view in this phase renders such an author as the bare handle. The test is
  `feed_private_profile_bare_handle`: the author's item shows the handle as plain text, with no `href` to `/@alice`
  and no profile field.
Chat stays closed by decision 36: chat membership is not visible from the network. R3-05 (private likes, comments and
follows shown to their target) is **answered by decision 39** (Alex 2026-10-04 17:40Z, "Show target", ADR 0006): the
target sees the member's name inside unset.sh only; see P4.17a (Editor pass B 2026-10-04 late).

**P4.00 also runs the Spaces status check (decision 38, Alex 2026-10-04 17:29Z, ADR 0005; review-later item 5).
[STOP] [ALEX].** atproto Spaces is the destination for private data, but nothing runs on the Spaces alpha. P4.00 checks
whether Spaces is (a) in an official, unpatched PDS release and (b) in the atproto spec, and records the versions and
links it read. If both hold, P4.00 stops and asks Alex whether to plan the move (a copy of the private rows into each
member's space; a new step, never folded into a build step). If either is missing, nothing changes: private likes,
comments, follows and drafts stay in unset.sh's database, already shaped for the copy (P2.18, P4.17a), and the check
repeats at the next phase's `.00` step. No step may depend on Spaces, a patched PDS or the unmerged atproto branch
(plan §9).

P4.01–P4.15 build the path a video takes from a phone to a repo: intake into the private draft store, a
**no-network compute worker** that does all media work and every moderation verdict (probe, fingerprints, limits,
transcode, nudity and gore gate, transcript, the local text gate P4.09a, the legal-hold copy), a **small egress step**
that reads no media and may talk only to Arachnid Shield (from P5.07b) and the internal `pds-admin` verb
`preserve.create` (plan-issues 3), routing to publishable, blocked or the human queue, the abuse-material path with
its sealed legal hold (C-16, plan-issues 4) and the suspected-abuse emergency path (Alex 16:39Z), and the publish
write. **Moderation is local in v1 (Alex 16:34Z and 16:38Z, answers 30 and 30b):** nothing is sent to Claude or any
other model provider; the Claude classifier (P4.10) is a documented later option, off in v1. P4.01 is a stop point: the social steps (P4.18–P4.20) and part of P4.02 wait on it.

P4.16–P4.28 then build playback, the social features, feeds, labels, reports, expiry, export, metrics and the
phase exit. Two steps are added with a letter suffix (reasons in each step and in "Notes for the editor"):
- **P4.17a** — the interaction policy module. P4.18, P4.19 and P4.20 all need the P4.01 matrix as typed data,
  the private-interaction tables and the interaction part of the `posts` `CategoryPublisher`; one owner keeps global invariant 2 ("one way").
- **P4.22a** — our public feed-generator endpoint on `api`. Splitting it from P4.22 keeps both near one PR.

## Shared definitions

The first block below was written with P4.01–P4.15 and the second with P4.16–P4.28; both describe the same
tables, states and storage layout.

### Interfaces assumed by P4.01–P4.15 (names reconciled in the editor pass)

| From | Assumed interface (typed pseudocode) |
|---|---|
| P1.02 config | `config.get(key) → value`; boot fails on a missing key; values never printed |
| P1.03 errors/log | `AppError(code)`; `log.info(event, fields)` with a field allowlist (no IP, no UA, no DID in review-worker logs) |
| P1.05 trusted proxy | `clientAddress(req) → string` (the one configured header) |
| P1.06 limits | `RateLimiter.consume(policy, {ip} \| {did}) → {ok: true} \| {ok: false, retryAfterS}` (an IP slot and a DID slot, in memory in each process; the edge limits each client and PDS per-IP limits are off); `bodyLimit(maxBytes)` per route |
| P1.07 CSRF | `csrfGate(req)` on every non-GET |
| P1.12 roles | `roles.json` (web, api, indexer, media, review, review_egress, retention, auditor, backup, legal_hold_reader, admin, …) and the grant-matrix test; this phase adds only grants (see Notes) |
| P1.14 / P1.14a seal | `seal(plaintext, context)` / `unseal(sealed, context)` (symmetric, P1.14) and its one chunked form `sealStream` / `unsealStream` (format `s1c`); the **public-key** seal `sealTo("legal_hold", plaintext ≤1 MiB, context) → "a1.…"` and its streaming form `sealToStream("legal_hold", source, context, maxBytes)` (P1.14a, age X25519 to `LEGAL_HOLD_RECIPIENTS`), with `context = sealContext(column, rowKey)` from `sealed-columns.json`; no deployed server decrypts a `sealTo` envelope: the legal-hold private key stays offline with the owners (P4.07; P4a-A1 settled by Alex 2026-10-03); held media of any size is one `sealToStream` object (P4.07) |
| P1.15 audit | `appendAudit(tx, {action, outcome, actorDid?, actorKey?, target?, reason?, case?, jti?, requestId?, receipt?, pii?})` (the P1.15 shape: a human actor DID or a service key; the lane is never passed; new actions are added to P1.15's closed list by migration) |
| P1.18 / P1.18a / P1.18b net-guard | `guardedRequest(policy, {url, method, headers?, body?, timeoutMs, maxBytes}) → {status, headers, body} \| NetGuardError(egress.*)` and `guardedFetch(policy, defaults)` (built on `undici.request`); one `public` policy with our own PDS as the internal-host exception, plus fixed-host policies; no redirects; `review_egress` uses **proxy mode** through the `egress-fixed-review` proxy instance (P1.18b: smokescreen, allow-list exactly the `arachnid` host; no `anthropic` policy exists in v1, answer 30b; referenced here, not designed) |
| P2.03 sessions | `getSession(req) → {did, handle} \| null` |
| P2.04/P2.07 OAuth | `pdsAgentFor(did) → agent` restored server-side from the sealed token store, wrapped by the P2.07 resilience wrapper; `NeedsReauth` when the grant is gone |
| P2.16 / P2.16b fingerprint stage | `FingerprintCheck.check(hashes: PdqHash[], {timeoutMs}) → {kind: 'clear'} \| {kind: 'match', classification: 'csam' \| 'harmful-abusive-material', matchType: 'exact' \| 'near'} \| {kind: 'unavailable'}` (never throws; PDQ only, no MD5, no TMK; `fakeFingerprintCheck` until **P5.07b** adds the real Arachnid Shield client, its spike, the production origin pin and `provider_access_lost`; production refuses to boot without the real check, decision 23); P2.16b's PDQ module (one hasher for images and video frames); `uploadsEnabled(did) → bool`, the one answer to "may this DID upload?" (reads `app.account.uploads_frozen`; P5.07b adds provider access and an open hold on the DID) |
| P2.17 image pipeline | `encodeImage(bytes, {maxEdge, formats: [avif, webp], maxBytes}) → {avif, webp}` in a bounded decode worker, metadata stripped |
| P2.18 draft store | object store `drafts` with per-DID prefixes `drafts/<did>/…` and a lifecycle backstop rule (not age-only, see P4.25 step 6); `quota.used(did) → bytes`; `quota.limit(did) → bytes` (2 GB default, raised in `admin`); the daily-cap ledger `upload_day_count(did, day, kind)` (P4.03 inserts `kind = 'video'` rows) |
| P2.19 draft media URLs | `mintDraftUrl(objectKey, ttlSeconds, purpose) → url` (shape `/o/<purpose>/<objectKey>`, the MAC covers the purpose) verified by `media`; this phase adds rows to `media`'s per-purpose prefix table (P4.12: `admin_thumb`) |
| P2.22 privacy switches | `privacy.state(did) → {profile: SwitchState, posts: SwitchState, hasUnpublishedChanges}`; only `public` allows a repo write (every other `SwitchState`, including a flip in progress or `waiting_review`, counts as not public); the one publishing interface `CategoryPublisher` (Phase 4 adds the `posts` publisher, P4.17a) |
| P2.23 publish | `lexicon.validate(nsid, record)`; `pds.uploadBlob(agent, bytes, mime) → blobRef`; `pds.applyWrites(agent, did, writes[]) → results[]` |
| P3.07 eraseDid | `eraseDid(did)` covers every DID-column table; under an open legal hold it erases everything except the held material, reports `partially_erased_legal_hold`, and finishes when the hold closes; it never refuses the whole erasure (the single rule, owned by P4.07); the one hold predicate `core.is_held` is declared by P3.07 as a placeholder and its body is written by P4.07; the remainder is tracked in `core.erase_pending_hold` |
| P3.09 media proxy | serves `media/<did>/…` objects only when referenced by an indexed record |
| P3.16 / P3.16c pds-admin | hash-linked log, own clock, verbs from signed envelopes, service keys in the signed roster's `service_keys`; this phase uses the `preserve.*` verbs built by **P3.16c**: `preserve.create` (carries `subject_did`), `preserve.notify`, `preserve.listExpired`, `preserve.close` (summarised in P4.07) |
| P3.20 admin screens | case list, reason codes, per-action WebAuthn signing (P3.19), reveal pattern |

### Storage layout

| Store / prefix | Written by | Read by | Lifecycle |
|---|---|---|---|
| `drafts/<did>/v/<uploadId>/upload` (original bytes; every object under `drafts/<did>/v/` carries the tag `lifecycle=expire`, P4.25 step 6) | `web` (P4.03) | `review` compute only (never `review_egress`) | deleted at publish, failure or expiry; copied (encrypted) into the hold by compute at a match, then deleted |
| `drafts/<did>/v/<uploadId>/{master.mp4, r720.mp4, r360.mp4, poster.avif, poster.webp, captions.draft.vtt, thumbs-blur/*}` | `review` compute | `media` (signed draft URLs), `admin` (only `thumbs-blur/*`, and `r360.mp4` for a reviewer play, P4.12, via signed URL); `review_egress` reads **no** object (answer 30b: no `frames-cleared/*` in v1) | same as above |
| `media/<did>/v/<rkey>/{r360.mp4, r720.mp4, master.mp4, poster.*, captions.<lang>.vtt}` | publish (P4.14) | `media` proxy (P3.09/P4.16) | until unpublish, takedown or erasure (prefix delete) |
| `legal-hold/<holdId>/…` (`media.age`, one `sealToStream` object to the legal-hold recipients, plus `manifest.json`; P4.07) | `review` compute, write-only (P4.07 `preserve_copy`) | nobody in normal operation; an owner fetches the ciphertext per the runbook | **no** lifecycle rule; deleted only by the expiry job after `pds-admin` says the hold expired |

### Draft video states (column `video_upload.state`)

One enum: `uploaded`, `processing`, `ready`, `private`, `reviewing`, `unsure`, `blocked`, `appealed`, `approved`,
`pds_refused_master` (decision 22: a foreign PDS refused the full-quality file and the user is asked), `published`, and
the terminal states `matched_hold`, `failed`, `appeal_upheld`, `publish_failed`, `expired`.
Withdrawing returns to `ready` (no separate state). Flags, not states: `needs_reauth` and `master_downgraded` (on
`approved`/`published`), `uploads_frozen` (on `app.account`, P2.16's one flag). `waiting_since` records when an upload
started waiting on its owner (`approved` with `needs_reauth`, or `pds_refused_master`); after 30 days P4.25 returns it
to `ready` (part-2 note E22). The full machine is the state diagram below; every
transition is made by exactly one step, named in the diagram.

### Tables added by P4.01–P4.15 (all in the app schema; every DID column registered for `eraseDid`; P4.16–P4.28 list theirs in their own Outputs)

| Table | Step | Notes |
|---|---|---|
| `video_upload(id uuid pk, did, state, bytes, container, created_at, deadline_at, expires_at, snapshot_hash, rkey, error_code, bsky_tick bool, needs_reauth bool, master_downgraded bool, waiting_since timestamptz NULL)` | P4.03 | one row per upload |
| `upload_day_count(did, day date, kind, n int)` | P2.18 (table) / P4.03 (`kind = 'video'` rows) | daily cap ledger; rows older than 2 days deleted by the sweeper |
| `transmission_buffer(subject_ref pk, sealed text, expires_at)` **UNLOGGED** | P4.03 | the C-16 buffer (`sealed` is a `sealTo` envelope, registered in `sealed-columns.json` with `form: "sealTo"`); no DID column; excluded from backups; one module, reused by P5.07b for images; see P4.03 |
| `review_job(id, subject_kind video\|bsky_post\|comment, subject_ref, kind, state, attempts, run_after, lease_until, worker, last_error_code)` | P4.04 | queue (one per `ReviewJob` kind, P4.11) |
| `video_fingerprint(upload_id, kind pdq, frame_ms, value, quality)` | P4.06 | PDQ only; deleted with the upload unless held |
| `fingerprint_result(upload_id pk, verdict, classification, match_type, checked_at, provider_ref)` | P4.06 | |
| `legal_hold(hold_id pk, did, subject_kind video\|image\|suspected, item_kind NULL, subject_ref, kind report\|analyst, created_at, notified_at, state, case_id, media_key)` (`item_kind` = `video\|bsky_post\|comment\|image\|chat_evidence`, set only for `suspected`, Alex 16:39Z) | P4.07 | the one hold table (P5.07b adds image holds); display copy, `pds-admin` is authoritative; `media_key` names the held media object and is registered in `sealed-columns.json` as a `sealToStream` object column (row key `subject_ref`) |
| `legal_hold_transmission(hold_id pk, sealed text)` (the `a1.` envelope moved unchanged, so it keeps the context `app.transmission_buffer.sealed\|<subjectRef>`; registered in `sealed-columns.json` with `form: "sealTo"`) | P4.07 | moved from the buffer; never decrypted on any server, only exported as ciphertext by a named owner's own `legal_hold_reader` login (P4.07's offline CLI) |
| `nudity_result(subject_kind, subject_ref, verdict, max_score, frames_checked, model_sha256, gore_verdict clear\|hold, gore_max_score, gore_model_sha256)` (pk `(subject_kind, subject_ref)`) | P4.08 | gore is hold-only (answer 30) |
| `text_result(subject_kind, subject_ref, verdict allow\|hold\|block, categories[], max_scores jsonb, rule_hits[], hit_sources[], model_shas jsonb, mode, created_at)` (pk `(subject_kind, subject_ref)`) | P4.09a | scores only, never a copy of the text; deleted with the draft or pending comment |
| `transcript(upload_id pk, lang, text, segments_json, engine_version)` | P4.09 | |
| `ai_review_consent(did, notice_version, accepted_at)` | P4.11 | the name is kept; the notice now says the checks run on our own servers (answer 30b) |
| `review_decision(id, subject_kind, subject_ref, stage auto\|human\|appeal, verdict, reason_code, decided_by, models jsonb, created_at)` | P4.11 | `models` = name and sha256 of each local model that contributed (P4.08, P4.09a) |
| (no `classifier_result` in v1: P4.10 is off; its table is created only by the future enabling PR) | P4.10 | |
| `appeal(id, upload_id, decision_id, statement, created_at, decided_at, outcome, decided_by, self_reviewed bool)` | P4.13 | |

For a video, `subject_ref` is the upload id; step text that says `upload_id` for `transmission_buffer`, `review_job`,
`legal_hold` or `review_decision` means `subject_ref` with `subject_kind = 'video'`.

### Config keys added by P4.01–P4.15

`VIDEO_UPLOAD_MAX_BYTES` (262144000), `VIDEO_MAX_DURATION_MS` (60500), `VIDEO_DAILY_CAP` (10),
`CHECK_DEADLINE_MINUTES` (120; the transmission-buffer lifetime; ≤1440), `REVIEW_SUBMISSION_DEADLINE_HOURS` (24),
`LEGAL_HOLD_RECIPIENTS` (from P1.14a), `FINGERPRINT_CHECK` (from P2.16; `fake` until P5.07b),
`REVIEW_MODE` (`shadow` \| `enforce`; replaces `CLASSIFIER_MODE`), `NUDITY_MODEL_SHA256`, `NUDITY_T_LOW`, `NUDITY_T_HIGH`,
`GORE_MODEL_SHA256`, `GORE_T_HIGH`, `TEXT_GATE_DETOXIFY_SHA256`, `TEXT_GATE_GUARD_SHA256`, `TEXT_GATE_T_LOW`,
`TEXT_GATE_T_HIGH`, `TEXT_GATE_THREADS` (4), `WHISPER_MODEL_SHA256`, `PDS_PRESERVE_KEY` (the
`review_egress` signing key, listed in the roster's `service_keys` (P3.16); `pds-admin` accepts it for `preserve.create`
only). No key is optional. No `ANTHROPIC_*` or `CLASSIFIER_*` key exists in v1 (answer 30b); a config schema test
refuses them.

### Interfaces assumed by P4.16–P4.28 (names reconciled in the editor pass)

Written in parallel with the steps that own them; the editor reconciles names. Each is used as named here.

| Owner | Interface assumed (typed pseudocode) |
|---|---|
| P1.03 | `AppError(code: ErrorCode, httpStatus)`; codes travel in URLs (`?error=<code>`), never free text; `log.info(event, fields)` with a field allowlist (no IP, no UA). |
| P1.06 | `RateLimiter.consume(policy: PolicyName, {ip: ClientIp \| null} \| {did}) → {ok: true} \| {ok: false, retryAfterS}`: an IP slot and a DID slot, in memory; "per IP hash" in the steps below means the IP slot. |
| P1.07 / P1.08 | The one CSRF gate on every non-GET; `csp.group(name)` route-group policies built from the typed allowlist. |
| P1.10 / P1.23 | `serializeProps(obj)` for island props; island bootstrap with path-scoped `script-src`. |
| P1.12 | Roles from `roles.json` (`web`, `api`, `indexer`, `media`, `review`, `review_egress`, `retention`, `auditor`, `backup`, `legal_hold_reader`, `admin`, `migrator`, …); grant-matrix test. Schema prefix `idx` for index tables. |
| P1.13 | DID-column registry read from `pg_catalog`: `didColumns() → [{schema, table, column}]`. |
| P1.15 | `appendAudit(tx, {action, outcome, actorDid?, target?, reason?, …})` (the P1.15 shape; DID only, no IP, no bodies; the lane is never passed). |
| P1.17 | `withAdvisoryLock(lockPool, namespace, key, fn)`. This file adds the namespace `social_write` and calls it as `withDidLock(did, fn) = withAdvisoryLock(lockPool, LockNamespace.social_write, did, fn)` (review R3). A `LockError` (`lock.timeout`, `lock.pool_exhausted`) maps to the code `social.busy`, and nothing is written. |
| P1.18 / P1.18a | `guardedRequest(policy, {url, method, timeoutMs, maxBytes})` and `guardedFetch(policy, defaults)` on `undici.request`; one `public` policy with our own PDS as the internal-host exception. |
| P1.19 | `t(key, params)` with EN and FR catalogs. |
| P2.01 / P2.02 | `resolveHandle(handle) → did`, `resolveDid(did) → {pdsEndpoint, keys}`; `verifyHandle(did) → handle \| 'handle.invalid'`. |
| P2.03 | `getSession(req) → {did, sid} \| null` (memoised per request). |
| P2.04 | The requested scope string (plan §3, 22:49Z) includes `rpc:app.bsky.feed.getFeed`, `getTimeline`, `getPosts`, `getFeedGenerators` and `getPostThread` with `aud=did:web:api.bsky.app#bsky_appview`, and `rpc:com.atproto.moderation.createReport?aud=*` (Bluesky's moderation service now, our Ozone in Phase 5), plus `repo:app.bsky.graph.follow`, all requested from day one (exactly the scope at plan line 126). A member who consented to the fallback scope may still lack them, so every `rpc:` call maps a scope refusal to a notice. |
| P2.07 | `pds.call(did, nsid, params, {method, timeoutMs, headers}) → PdsResult` and `pds.applyWrites(did, ops[≤200]) → {results[{uri, cid}]}`. Errors: `PdsTimeout`, `PdsTransient` (5xx, network), `PdsRateLimited(retryAfterS)`, `PdsAuthLost` (refresh failed: re-login prompt, session kept), `PdsRejected(status, xrpcError)`. A DPoP-nonce 401 is retried inside the wrapper and never surfaces. `pdsAgentFor(did)` restores the member's OAuth session **server-side** from the sealed token store, with no user present, for every publish that runs after an asynchronous review (plan §5.8, 22:49Z). A grant that is gone returns `NeedsReauth`; this file shows it as "Sign in to publish" and never uses another account's session. |
| P2.16 / P2.17 | Image fingerprint gate and image pipeline: `images.ingest(did, bytes) → DraftImage{key, mime, width, height, bytes}` or `blocked`. The gate runs before anything is stored: it computes PDQ only (no MD5, no TMK+PDQF) and passes the hashes to the `FingerprintCheck` stage (the fake until P5.07b). From P5.07b it also seals the C-16 transmission buffer for the image (P4.03's module) and, at a match, calls P4.07's hold entry point with `subjectKind: 'image'` (decision 23). |
| P2.18 | Draft store tables `app.draft*`, private object store prefix `drafts/{did}/…`; `draftMedia.listForExport(did) → {key, mime, bytes}[]`. |
| P2.22 | `privacy.state(did) → {profile: SwitchState, posts: SwitchState, hasUnpublishedChanges}`, `SwitchState = private \| going_public \| paused_going_public \| public \| updating \| paused_updating \| going_private \| paused_going_private \| waiting_review`; the one publishing interface `CategoryPublisher` (`nextBatch` with `defer`, `apply`, `finish`, `needsReviewConsent`), passed in the `publishers` map by `web`'s composition root (no registry; the resumable batch runner is P2.22's); `privacy.reviewDone(did, ref, outcome)`. |
| P2.23 | `lexicon.validate(nsid, record) → ok \| invalid(path)` (the one validator, §2 rule 8). |
| P3.03 / P3.05 | Generic index table `idx.record(uri PK, did, collection, rkey, cid, rev, record jsonb, created_at, indexed_at)` plus `ingest.registerCollection(nsid, {promote(record) → columns, table})`, monotonic `rev` guard on upsert and delete, and the like filter "drop likes whose subject is not our post NSID" (likes on our posts are `sh.unset.like`, plan §5.8; `idx.like` is created by P4.19). `idx.account(did, active, status, delisted)`. |
| P3.06 / P3.07 | Account state hides records and blobs; `eraseDid(did)` (SECURITY DEFINER) reaches every table in the DID-column registry, skips material under an open legal hold (`partially_erased_legal_hold`, the rule P4.07 owns); `erasure.registerStoragePrefix(prefixFn)`. |
| P3.09 | Media entrypoint on the media domain; `mediaHeaders() → {CSP: "default-src 'none'; sandbox", nosniff, Cache-Control: "public, max-age=3600"}`; `media.purge({did, cid?, recordUri?})`; published-blob route `/b/{did}/{cid}`. |
| P3.11 | `verifyServiceJwt(token, {aud, lxm}) → {iss: did}` (alg allowlist, `exp` ≤60 s, `jti` replay). |
| P3.12 | Public `/@handle`, `/@handle/p/{rkey}` route group (zero JS, own CSP, `Referrer-Policy: same-origin`). |
| P3.15 | `reports.submit({subject: ReportSubject, reasonCode, note?, reporterDid?}) → {caseId}`; stored for `admin`, never logged. |
| P4.02 | Lexicons `sh.unset.video` (`video` blob = 1080p master, or the 720p rendition when `master_downgraded`; `poster`, `aspectRatio`, `captions[{lang, file: blob text/vtt}]`, `caption` text) plus `sh.unset.comment` and `sh.unset.like` (plan §5.8). Caption files are **repo blobs** (a public post; other clients read them) and `media` keeps a served copy (plan §5.8, 22:49Z; E11). P4.02 also registers `sh.unset.video` with the P3.05 ingest, promoting `video_cid` and `created_at` (E8). |
| P4.03 / P4.04 | `video_upload(id, did, state, created_at, expires_at, rkey, needs_reauth, master_downgraded, …)` with part 1's single state enum: `uploaded`, `processing`, `ready`, `private`, `reviewing`, `unsure`, `blocked`, `appealed`, `approved`, `pds_refused_master`, `published`, and the terminal states `matched_hold`, `failed`, `appeal_upheld`, `publish_failed`, `expired`. `needs_reauth` and `master_downgraded` are flags, not states. Review job kinds include `limits`, `preserve_copy`, `unblur_frame`, `manual_match`, `nudity`, `text_gate` and `route`. `review_egress` reads no media at all (answer 30b). |
| P4.05 / P4.14 | Storage layout (part 1): drafts live under `drafts/<did>/v/<uploadId>/…`. At publish, P4.14 copies renditions, posters and captions to `media/<did>/v/<rkey>/{r360.mp4, r720.mp4, master.mp4, poster.avif, poster.webp, captions.<lang>.vtt}`. This file assumes that, after the copy, P4.14's publisher inserts `idx.rendition_set(did, rkey, master_cid, ready_at, duration_ms, width, height, master_downgraded)` (E7, R8, E25). Private posts live under `drafts/<did>/private/` with no 30-day rule and no lifecycle tag. |
| P4.07 | Legal holds: the one table `legal_hold(hold_id, did, subject_kind, subject_ref, kind, state, …)` in the app schema, written in P4.07's transaction B; `pds-admin` stays authoritative for the 365-day clock. This file reads holds only through the one hold predicate `core.is_held('video', upload_id) → boolean` (declared by P3.07, body by P4.07; R5; see P4.25). |
| P4.08 / P4.09a | Local image gate `nudity.check(images[]) → {nudity: clear \| unsure \| fail, gore: clear \| hold}` and local text gate `textGate.check({fields: [{source, text}]}) → allow \| hold(reasons) \| block(reasons) \| suspected_csam`, both in the no-network compute container. P4.17 sends images and text, and P4.20 sends text, through these same two functions (R4). P4.10 (Claude) is off in v1 (answer 30b). |
| P4.11 | `review.submit(job: ReviewJob) → jobId` with `ReviewJob = {kind: 'video', uploadId} \| {kind: 'bsky_post', did, draftId, text, imageKeys[≤4]} \| {kind: 'comment', did, pendingCommentId, text}` and one pipeline per kind. Video uses the part-1 pipeline. For `bsky_post`, the images were already cleared by the P2.16 gate at upload, then go through the P4.08 image gate (nudity and gore), then the P4.09a text gate on the text and alt texts. `comment` is text only: no image gate, then the P4.09a text gate. Nothing leaves our servers for any kind (answer 30b). The decision callback is `onReviewDecision(jobId, pass \| fail(reason) \| unsure)`, and `unsure` waits for P4.12. The union is defined once in P4.11's outputs (editor pass, R4/E27a). |
| P4.13 | Appeals go `blocked → appealed → approved \| appeal_upheld`, and a person decides them. P4.17 and P4.20 reuse the same appeal route and statement-of-reasons text for their kinds. |
| P4.14 | Publish a video with one `applyWrites`, uploading the master immediately before it. The optional Bluesky twin (`app.bsky.feed.post`) uses **the same rkey** as the `sh.unset.video` record (editor note E9, adopted by part 1). |

## Dependency diagrams

### P4.01–P4.15

```mermaid
flowchart TD
  P401["P4.01 STOP: privacy matrix + comment record"] --> P402["P4.02 lexicons"]
  P131["P1.31 lexicons pkg"] --> P402
  P218["P2.18 draft store"] --> P403["P4.03 upload intake + C-16 buffer"]
  P127["P1.27 images"] --> P404["P4.04 review worker skeleton (compute + egress)"]
  P112["P1.12 roles"] --> P404
  P118["P1.18 net-guard + P1.18b proxy mode"] --> P404
  P403 --> P405["P4.05 probe + transcode"]
  P404 --> P405
  P405 --> P406["P4.06 fingerprints (PDQ) + FingerprintCheck stage"]
  P216["P2.16 stage + P2.16b PDQ"] --> P406
  P114a["P1.14a sealTo"] --> P403
  P114a --> P407
  P406 --> P407["P4.07 match path + legal hold"]
  P316["P3.16 + P3.16c preserve verbs"] --> P407
  P403 --> P407
  P320 --> P407
  P405 --> P408["P4.08 nudity gate"]
  P405 --> P409["P4.09 transcript + draft captions"]
  P404 --> P409a["P4.09a local text gate"]
  P409 --> P409a
  P408 --> P411
  P407 --> P411["P4.11 routing + submission"]
  P409a --> P411
  P410["P4.10 Claude classifier: later option, OFF in v1"]
  P411 --> P412["P4.12 admin draft review queue"]
  P320["P3.20 admin screens"] --> P412
  P405 --> P412
  P412 --> P413["P4.13 appeals"]
  P411 --> P414["P4.14 publish a video"]
  P402 --> P414
  P223["P2.23 publish"] --> P414
  P414 --> P415["P4.15 SPIKE + ALEX: also post to Bluesky"]
```

### P4.16–P4.28

```mermaid
flowchart LR
  subgraph earlier[earlier phases]
    P207[P2.07 PDS wrapper]; P222[P2.22 privacy switches]; P223[P2.23 publish]
    P217[P2.17 image pipeline]; P305[P3.05 ingest]; P307[P3.07 eraseDid]
    P309[P3.09 media proxy]; P311[P3.11 service JWT]; P312[P3.12 public routes]
    P315[P3.15 report intake]; P112[P1.12 roles]; P117[P1.17 advisory lock]; P216[P2.16 fingerprint stage]; P218[P2.18 draft store]
  end
  subgraph p4a[P4.01–P4.15]
    P401[P4.01 matrix decision STOP]; P402[P4.02 lexicons]; P403[P4.03 upload intake]
    P405[P4.05 transcode]; P407[P4.07 legal hold]; P411[P4.11 review routing]; P413[P4.13 appeals]
    P414[P4.14 publish video]
  end
  P405 --> P416[P4.16 playback]; P309 --> P416; P414 --> P416
  P411 --> P417[P4.17 Bluesky posts]; P217 --> P417; P207 --> P417; P216 --> P417; P413 --> P417
  P401 --> P417a[P4.17a interaction policy]; P222 --> P417a; P305 --> P417a
  P417a --> P418[P4.18 follows]; P312 --> P418; P117 --> P418
  P417a --> P419[P4.19 likes]; P305 --> P419; P117 --> P419
  P417a --> P420[P4.20 comments]; P305 --> P420; P411 --> P420; P117 --> P420
  P418 --> P421[P4.21 home timeline]; P207 --> P421; P416 --> P421
  P309 --> P421a[P4.21a Bluesky images via media]; P216 --> P421a; P217 --> P421a; P421a --> P421
  P421 --> P422[P4.22 feed tabs]
  P422 --> P422a[P4.22a feed generator endpoint]; P311 --> P422a
  P421 --> P423[P4.23 labels]
  P315 --> P424[P4.24 report button]; P207 --> P424
  P403 --> P425[P4.25 expiry jobs]; P112 --> P425; P407 --> P425; P413 --> P425
  P307 --> P426[P4.26 export]; P218 --> P426
  P414 --> P427[P4.27 metrics_daily]
  P416 --> P428[P4.28 phase exit]; P422 --> P428
  P419 --> P428; P420 --> P428; P423 --> P428; P424 --> P428; P425 --> P428; P426 --> P428; P427 --> P428; P417 --> P428; P422a --> P428
```

## Flow: one video from upload to publish

```mermaid
sequenceDiagram
  autonumber
  actor U as Member (browser)
  participant W as web
  participant DB as Postgres
  participant D as drafts store
  participant C as review compute (no network)
  participant E as review_egress (no media; 1 fixed host)
  participant A as FingerprintCheck (fake; Arachnid Shield from P5.07b)
  participant P as user's PDS
  U->>W: PUT /upload/video (≤250 MB, CSRF, session)
  W->>DB: check caps, quota, uploadsEnabled
  W->>D: stream bytes to drafts/<did>/v/<id>/upload
  W->>DB: video_upload(uploaded) + sealed transmission_buffer(expires = now + CHECK_DEADLINE) + job probe
  W-->>U: 202 {uploadId}
  C->>DB: claim probe (SKIP LOCKED)
  C->>D: ffprobe + decode test (allow-listed demuxer, file protocol only); no limits yet
  C->>DB: job fingerprint
  C->>D: sampled frames (≤63) → PDQ (P2.16b module)
  C->>DB: video_fingerprint rows + job egress_fingerprint
  E->>DB: claim egress_fingerprint (hashes from the DB, no media)
  E->>A: check(PDQ hashes) (the real check goes through net-guard proxy mode, P5.07b)
  alt match
    E->>E: P4.07 match path (see its own diagram)
  else no known match
    E->>DB: fingerprint_result(no-known-match); destroy transmission_buffer; job limits
    C->>DB: limits (duration, codec, dimensions, fps): reject → failed, else job transcode
    C->>D: master 1080p, 720p, 360p, posters, blurred thumbs
    C->>D: whisper.cpp transcript → captions.draft.vtt (every video has a track)
    C->>DB: state ready
  end
  U->>W: edit caption/captions, tick the review notice, Submit for publication
  W->>DB: ai_review_consent, snapshot_hash, state reviewing, job nudity
  C->>D: nudity + gore models on 1 fps frames (P4.08)
  C->>DB: nudity_result; job text_gate
  C->>C: P4.09a text gate on caption, alt, captions cue text, transcript (rules, Detoxify, Llama Guard 3 1B)
  C->>DB: text_result; job route
  Note over C,E: Nothing is sent to any model provider (answer 30b). Suspected CSAM → P4.07 emergency path.
  C->>DB: route: approved | blocked | unsure (admin queue) | suspected (P4.07); approved → web_job publish
  W->>P: (approved) [Bluesky video prep first, P4.15] then uploadBlob(master, captions) + one applyWrites [sh.unset.video (+ app.bsky.feed.post)]
  W->>D: copy renditions to media/<did>/v/<rkey>/, delete drafts/<did>/v/<id>/*
  W->>DB: state published
```

## State diagram: a draft video

```mermaid
stateDiagram-v2
  [*] --> uploaded: P4.03 intake
  uploaded --> processing: P4.05 probe claimed
  processing --> failed: P4.05 limits reject or transcode fail (after the check), or P4.06 check past deadline
  processing --> matched_hold: P4.07 any fingerprint match
  processing --> ready: P4.06 no match, then P4.05 limits + transcode and P4.09 transcript done
  ready --> private: P4.14 save as private post (no AI review)
  ready --> reviewing: P4.11 submit (consent recorded)
  reviewing --> ready: P4.11 withdraw
  reviewing --> blocked: P4.11 nudity fail or text gate block (enforce mode)
  reviewing --> unsure: P4.11 nudity unsure, gore hold, text hold, shadow mode, error past deadline
  reviewing --> matched_hold: P4.11 text gate S4 (suspected CSAM, P4.07 emergency path)
  reviewing --> approved: P4.11 pass (enforce mode)
  unsure --> approved: P4.12 human approve
  unsure --> blocked: P4.12 human block
  unsure --> matched_hold: P4.12 reviewer suspects CSAM (P4.07 emergency path)
  unsure --> ready: P4.11 withdraw
  blocked --> appealed: P4.13 appeal filed
  appealed --> approved: P4.13 overturned by a person
  appealed --> appeal_upheld: P4.13 upheld (draft deleted)
  approved --> published: P4.14 applyWrites ok
  approved --> approved: P4.14 flag needs_reauth (waits for "Publish now")
  approved --> ready: P4.25 needs_reauth for 30 days (E22)
  approved --> pds_refused_master: P4.14 foreign PDS 413 on the master (decision 22, ask the user)
  pds_refused_master --> approved: P4.14 user chooses 720p (flag master_downgraded)
  pds_refused_master --> ready: P4.14 user keeps it as a draft, or P4.25 after 30 days
  approved --> publish_failed: P4.14 PDS refuses (own-PDS 413, a 413 on the 720p copy, 400, invalid record)
  ready --> expired: P4.25 30-day expiry
  blocked --> expired: P4.25 30-day expiry
  unsure --> expired: P4.25 30-day expiry
  publish_failed --> expired: P4.25 30-day expiry (media/ copies already deleted)
  failed --> [*]: bytes deleted
  appeal_upheld --> [*]: bytes deleted
  expired --> [*]: bytes deleted
  matched_hold --> [*]: P4.07 hold expiry job, 365 d after notification
  published --> [*]
```

## Flow: the abuse-material match (nobody views)

```mermaid
sequenceDiagram
  autonumber
  participant E as review_egress (no media access)
  participant A as FingerprintCheck (Arachnid Shield from P5.07b)
  participant DB as Postgres
  participant C as review compute (no network)
  participant D as drafts store
  participant H as legal-hold store
  participant PA as pds-admin (own clock + log)
  participant AD as admin (owners; no private key)
  participant O as owner's own device (offline key)
  participant CT as Cybertip.ca
  E->>A: check(PDQ hashes) (hashes only, never media)
  A-->>E: match {classification, matchType}
  E->>DB: tx A: state matched_hold, buffer expiry → now + 7 d, freeze uploads, case(reason csam)
  E->>PA: preserve.create {holdRef, kind, subject_did} signed with the review_egress service key (P3.16c)
  PA-->>E: receipt {holdId, createdAt (pds-admin clock)}
  E->>DB: tx B: move transmission_buffer → legal_hold_transmission (ciphertext unchanged), legal_hold row, job preserve_copy
  C->>D: read upload
  C->>H: write media.age (sealToStream to the legal-hold recipients) + manifest; verify checksums
  C->>D: delete drafts/<did>/v/<id>/*
  E->>AD: immediate alert "legal hold created" (no DID, no reason code in the alert body)
  Note over AD: No screen shows or decrypts the media. Thumbnails are never generated for a matched upload.
  AD->>AD: owner opens the case (hold metadata only: ids, dates, status)
  O->>DB: owner runs the offline export CLI with their own legal_hold_reader login over the tailnet (audited) → ciphertext bundle
  O->>O: owner decrypts on own device with the hardware-key identity (runbook)
  O->>CT: owner files the report per the P1.37 runbook (hashes, classification, transmission data)
  AD->>PA: preserve.notify {holdId, notifiedAt} (signed) → expiry = notifiedAt + 365 d
  PA-->>AD: receipt
  Note over PA,H: At expiry: retention job reads preserve.listExpired, deletes H objects and the sealed row, then preserve.close
```

## Loading a feed tab (sequence)

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser (feed island)
  participant W as web (unset.sh)
  participant DB as Postgres (app + index)
  participant P as User's PDS
  participant AV as Bluesky AppView
  participant FG as Feed generator
  participant M as media proxy (media domain)
  B->>W: GET /home/feed?tab=<id>&cursor=<c> (cookie __Host-sid)
  W->>DB: getSession, saved_feed row for (did, tab), rate limit
  alt tab is a Bluesky feed or Following (Bluesky half)
    W->>P: app.bsky.feed.getFeed / getTimeline via P2.07 (DPoP, rpc scope, atproto-accept-labelers: bsky;redact, ours)
    P->>AV: proxied, service-auth JWT iss=user aud=did:web:api.bsky.app lxm=method
    AV->>FG: getFeedSkeleton (JWT signed for the user)
    FG-->>AV: skeleton (post URIs)
    AV-->>P: hydrated posts + labels + viewer state (blocks, mutes applied)
    P-->>W: response (timeout 4 s; 429/5xx → partial page)
  end
  opt tab is ours, or Following (our half)
    W->>DB: index query: public sh.unset.video of followed or latest, active, not delisted, rendition_set ready
    W->>DB: idx.label join (our labeler), like and comment counts by subject URI
  end
  W->>W: validate (lexicon), merge by time window, dedupe Bluesky twins, apply label decisions (hide / warn), escape
  W-->>B: JSON page (no-store) + next cursor
  B->>M: GET poster / 360p rendition with Range (CORS, sandbox CSP, nosniff)
```

## The privacy matrix as an input

P4.01 is a stop point: Alex decides the matrix and the comment record type. Nothing in P4.17a–P4.20 hard-codes a
cell. The matrix is one typed, checked-in data file read by `interactionPolicy.decide()` (P4.17a); the steps branch
on the returned `Cell`. The **default the book builds against** is the plan's Q2b proposal (marked "proposal"
below) so code and tests can be written; P4.17a's completeness test fails until P4.01's ADR id is filled in, so
the default cannot ship silently.

**Settled by Alex (2026-10-03, answers 26–29b):** the proposal cells below are confirmed (private: inside unset.sh,
the counterpart sees it and **sees who**; private likes and replies on Bluesky posts disabled with a reason; going
public converts in the same batch as posts). P4.01's ADR records them; the completeness test still needs its id.

| Interaction (viewer's "Posts and follows") | private | public |
|---|---|---|
| post (video, Bluesky post) | app DB only, owner sees it (Q2b, decided) | repo record, public everywhere (decided) |
| follow | decided (decision 39): app DB row; target sees the member's name and "follows you" inside unset.sh only | decided (answer 29b, plan decision 28): **by target**: an unset.sh account (has an `sh.unset.profile` record) → `sh.unset.follow` in the repo; a Bluesky account → `app.bsky.graph.follow` in the repo |
| like on our post | decided (decision 39): app DB row; the author sees the member's name with the like, inside unset.sh only | `sh.unset.like` in the repo, indexed and counted (plan §5.8, decided) |
| like on a Bluesky post | proposal: disabled with a one-line reason | `app.bsky.feed.like` in the repo, not indexed by us |
| comment on our post | decided (decision 39): app DB row; the author sees it with the commenter's name; nobody else sees it | `sh.unset.comment` (plan §5.8, decided) |
| comment on a Bluesky post | proposal: disabled with a one-line reason | `app.bsky.feed.post` with `reply` |

```mermaid
flowchart TD
  A[action: follow / like / comment; target origin ours or bsky] --> S{privacy.state viewer .posts}
  S -- any state but private or public --> X[refuse: social.privacy_flip_in_progress]
  S -- private / public --> D[interactionPolicy.decide kind, targetOrigin, state]
  D -- Cell repo --> R[lexicon.validate → pds.applyWrites → own_interaction ledger]
  D -- Cell app_db --> L[private_interaction row; visibleTo rule]
  D -- Cell disabled --> Z[refuse with reasonCode, button shown disabled with reason]
```

**What each option changes** (so P4.01's answer maps to code without redesign):

| Cell option | Code path taken | Tables touched | Tests that change |
|---|---|---|---|
| `repo` (collection N) | lexicon validate, `applyWrites` create/delete, ledger row | `app.own_interaction`; index via P3.05 | repo-write tests; "nothing in app DB" assertion |
| `app_db` visibleTo `owner` | private row, shown to the actor only | `app.private_interaction` | target view does **not** show it |
| `app_db` visibleTo `owner_and_target` | private row, target sees an anonymous "a member …" line | `app.private_interaction` | target sees count, never actor DID |
| `app_db` targetSeesActor `true` | as above but target sees who | same | target sees actor handle (the settled choice for `like_ours`, `comment_ours` and `follow_ours`/`follow_bsky` private cells: answer 27) |
| `disabled` | button rendered disabled with the reason code's text; POST refused | none | refusal tests per kind |
| flip `toPublic: convert` | P2.22 batch turns private rows into repo records, then deletes rows | both | flip-batch tests |
| flip `toPublic: drop` / `keep_private` | rows deleted, or kept and still private | `app.private_interaction` | flip-batch tests |
| flip `toPrivate: convert` / `delete` | repo records deleted; rows created or not | both | flip-batch tests |
| comment `review: before_publish` / `none` | comment waits for P4.11 text review / is written at once | `app.pending_comment` or none | review tests in P4.20 |
| comment type `sh.unset.comment` (plan §5.8; the other values, `app.bsky.feed.post` reply / app DB only, are closed and kept only as a guard) | which collection P4.20 writes for comments on our posts | see P4.20 | P4.20 tests use `sh.unset.comment` |

---

### P4.01 — Decisions before building: the private-account interaction matrix (comment and like record types now settled by the plan)
Tags: [STOP]            Depends on: —            Plan: §11 Q2b (likes, comments and follows on a private account), §2 "prototype defects", §5.8, plan-issues 7
Where: no code. Output is an ADR draft `docs/human/decisions/00xx-social-privacy-matrix.md` and a question to Alex through the coordinator.
Size: ~0 source lines; ~1 page of ADR

**Goal:** get Alex's decision on where each like, comment and follow lives and who sees it when an account's "Posts and follows" switch is private or public, so P4.17a and P4.18–P4.20 can be built without guessing. The record types are no longer open (editor pass, 2026-10-03): plan §5.8 makes a comment on a video `sh.unset.comment` (text, `subject` strongRef to the video, optional `parent` strongRef for one level of replies) and a like on our videos `sh.unset.like`; follows are mixed by target (Alex 16:21Z, answer 29b, plan decision 28, superseding answer 29): a public member's follow of an unset.sh account (one with an `sh.unset.profile` record) is our own `sh.unset.follow` record in their repo, published with the P1.31 permission set; a follow of a Bluesky account is `app.bsky.graph.follow` (in the plan's scope, line 126); private follows stay inside unset.sh.

**Inputs:** plan §11 Q2b (the review's proposal, explicitly "not yet an Alex decision"); review 03 SERIOUS-5; review 07 SERIOUS-1 (follows as `app.bsky.graph.follow`); the prototype defects (comment root always equals parent; likes keyed on CID; Bluesky likes sharing our like collection).

**Outputs:** an ADR with Alex's answers to Q1–Q4 below, the filled matrix table (the plan says it "goes in the lexicon docs when Alex confirms"), and any NSID beyond the plan's that P4.02 must add. New collections join the **existing** permission set through an `[ALEX]` PR under the P1.31 rules; there is no new set NSID (a new set would force every user to consent again). Until the ADR is merged, P4.18–P4.20 do not start; P4.02 builds the plan's records (`sh.unset.video`, `sh.unset.comment`, `sh.unset.like`) regardless.

**Algorithm:**
1. Write the questions below into the ADR draft with the options, the plan/review recommendation and the consequence of each option.
2. Send the ADR link to the coordinator for Alex. Stop.
3. When Alex answers: if an answer equals a listed option, record it verbatim with the date. Else (a new option) record it and list every step in this book it touches (at least P4.02, P4.18, P4.19, P4.20, P2.22) for the editor.
4. Fill the matrix table from the answers and open the PR. Building resumes only after Alex merges it.

**The questions (for Alex):**

Q1. **Private account, interacting with Bluesky posts** (a like or reply there is a public `app.bsky.*` record naming the DID).
- (a) **Disabled while "Posts and follows" is private, with a one-line reason.** *Recommended by the review and the plan's proposal (1).* Keeps "no false sense of privacy": nothing public is written for a private account.
- (b) Allowed, with a warning each time that this one action is public. Breaks the switch's meaning.
- (c) Allowed silently. Rejected: false privacy.
- **Settled by Alex (2026-10-03 16:18Z, answer 28): (a)**, like and reply on Bluesky posts disabled while private, with a one-line reason.

Q2. **Private account, interacting with unset.sh content** (like, comment, follow).
- (a) **Stored in the app DB, shown to the target inside unset.sh only ("a member liked this", "follows you"), and the user is told the author sees it.** *Recommended (proposal 2).* Counts on unset.sh then include private interactions; other apps never see them.
- (b) Private accounts are read-only consumers (no likes, comments or follows). Simple, but empties the product for the default setting.
- (c) Stored in the app DB and visible to nobody but the actor. Rejected by the review: authors never see comments.
- **Settled by Alex (2026-10-03 16:16Z, answer 26): (a)**, kept inside unset.sh, the counterpart sees it, the user is told, other apps never see it. **The author sees who** (answer 27, 16:17Z: `targetSeesActor = true`).

Q3. **Record types once public.**
- Follows: **decided by Alex (answer 29b, 16:21Z; plan decision 28): mixed by target.** Following an unset.sh account (the target has an `sh.unset.profile` record in the index; P4.00 may refine the test) writes `sh.unset.follow`; following a Bluesky account writes `app.bsky.graph.follow`. The Following tab merges both. Accepted cost: Bluesky's app does not show unset.sh-to-unset.sh follows. (The earlier options, `app.bsky.graph.follow` for every public follow or an own type for every follow, are closed.) The NSID is flat (`sh.unset.follow`, not the plan's provisional `sh.unset.graph.follow`) because P1.31 allows only flat NSIDs under one `_lexicon.unset.sh` record; see Notes.
- Likes on our videos: **decided by the plan (§5.8): `sh.unset.like`**, in the permission set, counted in our index keyed on the subject **URI** (never CID, never by listing the user's repo). (The options this question first offered, `app.bsky.feed.like` on an `sh.unset.video` URI or an own like type, are closed.)
- Flip to public: a resumable batch, `applyWrites` ≤200 ops per call (proposal 4; already P2.22's model). **Settled by Alex (answer 27):** going public converts the private interactions to public records in the same batch as the posts.

Q4. **The comment record type** on an unset.sh video: **decided by the plan (§5.8, plan-issues 7):** our own `sh.unset.comment` `{subject: strongRef (the video), parent?: strongRef (one level of replies), text (≤1,000 graphemes), langs?, createdAt}`; counts keyed on the subject URI. When the video was also posted to Bluesky, the comment may additionally be written as an `app.bsky.feed.post` reply to that Bluesky post, opt-in like the post itself. (This writer's earlier options, an own type with `reply.root`/`reply.parent`, an `app.bsky.feed.post` reply to the `sh.unset.video` record (the prototype's shape, `lexicons/app.0x40.post.json:32-55`), or app-DB-only comments, are closed.) The ADR only records the matrix cells for comments (Q2) and Q4b.
- Comments on **Bluesky** posts are always `app.bsky.feed.post` replies, whatever Q4 says (only allowed when public, per Q1).
- Sub-question Q4b: are public **text** comments reviewed before publishing? **Answered by Alex (answer 30, 16:34Z):** yes, by the local P4.09a text gate (`comment.review = before_publish`); comments never go to Claude; anything the gate holds goes to a person (P4.12). No media in comments.

**Edge cases and failures:**
- Alex answers only some questions → record the answered ones; the steps that depend on the unanswered ones stay blocked; P4.02 builds `sh.unset.video` regardless.
- An answer contradicts the plan text (for example private likes visible to nobody) → it goes to `plan-issues.md` through the coordinator; the book does not change the plan.

**Done when (tests):**
- `adr-merged`: the ADR exists on `main` with Alex's answers and the date → a docs check finds every one of Q1–Q3 and Q4b answered or marked "deferred by Alex" (Q4 and the like type cite plan §5.8).
- `matrix-complete`: the table has a cell for each of {post, follow, like-on-ours, like-on-Bluesky, comment-on-ours, comment-on-Bluesky} × {private, public} → a docs lint fails on an empty cell.

**Reuse:** prototype `app/src/actions/social.ts:76-78` (sets `root` and `parent` to the same subject) → REJECT (plan §2 defect). `app/src/lib/social-interactions.ts:38-84` (finds a like by listing the whole repo, keyed on uri+cid) → REJECT (the 5,000-like defect and the CID keying). `lexicons/app.0x40.post.json:48-55` (`replyRef` with root and parent strongRefs) → LESSON for option Q4(a). Provisional — for reuse review.

**Not in this step:** building follows, likes or comments (P4.18–P4.20); the flip-to-public batch (P2.22 runner, P4.17a's part of the `posts` publisher); the lexicon JSON (P4.02); the permission-set PR itself (P4.02, `[ALEX]`).

**Diagram:** none.

---

### P4.02 — Lexicons: `sh.unset.video`, `sh.unset.comment`, `sh.unset.like`
Tags: [ALEX] (the schema publish by the P1.35 `goat` runbook and the permission-set PR; outline change in Notes)            Depends on: P1.31 (P4.01 only for the matrix docs table)            Plan: §5.8 "Video posts", "Captions on every video", §6.1 lexicon versioning, decision 19
Where: `shared/lexicons/schemas/sh/unset/video.json`, generated code under `shared/lexicons/gen/`, `shared/lexicons/limits.ts`, unit tests beside them in `shared/lexicons/`
Size: ~120 source lines (JSON + limits), ~120 test lines

**Goal:** add the short-video record type with caption, captions track, alt text and aspect ratio, plus the plan's comment and like records (§5.8), as one lexicon-derived source for UI limits, the write path and the indexer.

**Inputs:** P1.31 lexicons package (`lex build`, breaking-change check, `lex install` for vendored `app.bsky.*`, the permission set); plan §5.8 for the comment and like shapes; the merged P4.01 ADR (for the matrix docs table only).

**Outputs:**
- `sh.unset.video` (key `tid`), record properties:
  - `video`: blob, `accept: ["video/mp4"]`, `maxSize` = `VIDEO_MASTER_MAX_BYTES` (the 1080p master cap, 60 MB; must be ≤ the PDS `PDS_BLOB_UPLOAD_LIMIT`, checked by the P1.30 preflight, see Notes);
  - `caption`: string, `maxGraphemes: 300`, `maxLength: 3000` (optional);
  - `alt`: string, `maxGraphemes: 1000` (optional; review 08 asked for it);
  - `aspectRatio`: `{width: integer ≥1, height: integer ≥1}` (required, from the master);
  - `durationMs`: integer 1..60500 (required);
  - `posterTimeMs`: integer ≥0 (optional; which frame the poster was cut from);
  - `captions`: array `maxLength: 4` of `{lang: language, file: blob accept ["text/vtt"] maxSize 20000}` (optional; the same shape as `app.bsky.embed.video#caption`, so the Bluesky tick can reuse the blob; see Notes on "caption files never in the PDS blobstore");
  - `langs`: array of language, `maxLength: 3` (optional); `createdAt`: datetime (required).
- `limits.ts` exports `VIDEO_LIMITS = {captionGraphemes: 300, altGraphemes: 1000, captionsMax: 4, vttMaxBytes: 20000, durationMsMax: 60500, masterMaxBytes}` derived from the JSON (a test proves equality).
- `sh.unset.comment` (key `tid`): `subject` strongRef (the video, required), `parent` strongRef (optional; a top-level comment, one level of replies), `text` (`maxGraphemes: 1000`, required), `langs?`, `createdAt`. `sh.unset.like` (key `tid`): `subject` strongRef (required), `createdAt`. Both plan §5.8.
- The three collections added to the existing permission set (no new set NSID; P1.31 rules), as an `[ALEX]` PR. (`sh.unset.follow` is not added here: it is in P1.31's first publication of the set, answer 29b.)
- A docs table: the P4.01 matrix rendered in the lexicon docs.

**Algorithm:**
1. Write `video.json` as above. Every optional field is optional so later additions stay non-breaking (§6.1: a break is a new NSID).
2. Run `lex build`; check the generated code in.
3. Write `VIDEO_LIMITS` by reading the JSON at build time (not by hand-copying numbers); the limits test re-reads the JSON.
4. Add `sh.unset.comment` and `sh.unset.like` the same way (`subject` and `parent` are `com.atproto.repo.strongRef`), and the three NSIDs to the permission set's JSON (EN and FR consent text updated). Any extra record a P4.01 answer needs goes in a follow-up PR `P4.02a`.
5. Run the breaking-change check against `main` (new NSIDs only, so it passes).
6. Write the publish request for Alex: the `goat` runbook from P1.35 publishes the new schema under the lexicon authority. The agent stops until Alex reports it published; P4.14 must not merge before (a record whose schema does not resolve fails validation in other apps).

**Edge cases and failures:**
- A field named `caption` (the post text) is confused with `captions` (the WebVTT track) → the docs table and the field descriptions say which is which; the i18n labels are "Description" and "Captions (subtitles)".
- `VIDEO_MASTER_MAX_BYTES` above the PDS blob limit → the preflight fails the deploy; the lexicon constant is the single source.
- P4.01 not answered → the three plan records still ship; only the matrix docs table waits.

**Done when (tests):**
- `video-valid-minimal`: a record with `video`, `aspectRatio`, `durationMs`, `createdAt` → validates.
- `video-rejects-long-caption`: 301 graphemes (and a 300-emoji caption over 3,000 bytes) → rejected with the field path.
- `video-rejects-duration`: `durationMs` 60501 and 0 → rejected.
- `video-rejects-wrong-mime`: `video` blob with `video/quicktime`; captions blob with `text/html` → rejected.
- `video-rejects-five-caption-tracks` → rejected.
- `limits-match-json`: `VIDEO_LIMITS` equals the values read from `video.json`.
- `lex-build-clean`: regenerating produces no diff.
- `comment-subject-required`: a comment without `subject` → rejected; a comment with a `parent` and no `subject` → rejected.
- `like-shape`: an `sh.unset.like` with a `subject` strongRef validates; without it → rejected.
- `permission-set-lists-collections`: the permission set's JSON names `sh.unset.video`, `sh.unset.comment` and `sh.unset.like`, and its NSID is unchanged.

**Reuse:** prototype `lexicons/limits.ts:55-68` plus `lexicons/test/limits.test.ts:99-107` (limits mirrored from lexicon JSON and checked by a test) → LESSON (same pattern; but derive from the JSON instead of hand-copied constants). `lexicons/app.0x40.post.json` → LESSON (embed union of image/video; superseded by a dedicated video record). Provisional — for reuse review.

**Not in this step:** the Bluesky post record (vendored `app.bsky.feed.post`, used in P4.15); writing records (P4.14); indexing them (P4.16/P4.19/P4.20 and Phase 3 ingest).

**Diagram:** none.

---

### P4.03 — Upload intake into the draft store, with the caps and the C-16 transmission buffer
Tags: [SEC]            Depends on: P2.18, P2.16, P1.14a            Plan: §5.8 "Upload checks", "Caps from day one", decision 9 (C-16), decision 21, decision 23, §6 (no IPs, the one exception), §2 rules 10 and 16; plan-issues 2 and 4
Where: `interfaces/http/routes/upload-video.ts`, `domains/content/media/video-intake.ts`, `domains/moderation/transmission-buffer.ts` (the one buffer module; P5.07b reuses it for images), migration for `video_upload`, `transmission_buffer` (`upload_day_count` is P2.18's table); tests beside them
Size: ~250 source lines, ~300 test lines

**Goal:** accept one video upload per request into the private draft store, enforcing size, container sniffing, the 2 GB quota and the 10-per-day cap, and seal the uploader's transmission data, encrypted to the legal-hold public key, into a short-lived buffer that is destroyed unless a fingerprint match moves it into a legal hold (Alex decision 21).

**Inputs:** P2.18 draft store, quota hooks and `upload_day_count(did, day, kind)`; P2.16 `uploadsEnabled(did)`; P1.05 `clientAddress`; P1.06 `RateLimiter`; P1.07 CSRF; P1.14a `sealTo` and P1.14 `sealContext`; P2.03 sessions; config keys `VIDEO_UPLOAD_MAX_BYTES`, `VIDEO_DAILY_CAP`, `CHECK_DEADLINE_MINUTES`, `LEGAL_HOLD_RECIPIENTS`.

**Outputs:**
- Route `PUT /upload/video` (body = the file bytes, `Content-Length` required) → `202 {uploadId}` or an error code: `upload_disabled`, `upload_frozen`, `quota_exceeded`, `daily_cap`, `too_large`, `unsupported_container`, `rate_limited`, `length_required`.
- Route `GET /upload/video/:id/status` → `{state, errorCode?}` for the owner only (404 for anyone else).
- `videoIntake.accept({did, bodyStream, declaredLength, client: {address, at, route}}) → {uploadId} | IntakeError(code)`.
- `transmissionBuffer.put(subjectRef, {address, at, route}, expiresAt)`; `transmissionBuffer.takeForHold(subjectRef) → sealed | null` (callable only through the definer function `move_transmission_to_hold(subject_ref, hold_id)` in P4.07); `transmissionBuffer.sweep(now) → count`. One module: built here for videos (`subjectRef` = upload id) and reused unchanged by P5.07b for images (P2 note E24).
- A sweeper job (runs every minute in `web`'s scheduler, or as a one-shot under the `retention` role): deletes expired buffer rows and day-count rows older than 2 days.
- Body-limit exception: this one route gets `VIDEO_UPLOAD_MAX_BYTES`; every other route keeps the global limit (P1.06).

**Algorithm (PUT /upload/video):**
1. Run the CSRF gate; on deny → 403 (fail closed, also on exception).
2. `session = getSession(req)`; if null → 401. `did = session.did`.
3. If not `uploadsEnabled(did)` → 403 `upload_disabled` (P2.16's one answer; during the trusted test track uploads run against the fake check, and production refuses to boot without the real one, decision 23).
4. If `app.account.uploads_frozen` is set (P2.16's flag, set by P4.07 at a match) → 403 `upload_frozen` (generic text, see P4.07). (This check runs before step 3, so a frozen account gets `upload_frozen`, not `upload_disabled`.)
5. `RateLimiter.consume("upload", {did})`; if not ok → 429 `rate_limited`.
6. If `Content-Length` is absent or not an integer → 411 `length_required`. If it exceeds `VIDEO_UPLOAD_MAX_BYTES` → 413 `too_large` (before reading the body).
7. In one transaction with `SELECT … FOR UPDATE` on `upload_day_count(did, today_utc, kind = 'video')` (P2.18's table):
   a. if `n ≥ VIDEO_DAILY_CAP` → rollback, 429 `daily_cap`;
   b. if `quota.used(did) + declaredLength > quota.limit(did)` → rollback, 413 `quota_exceeded`;
   c. else increment `n`, insert `video_upload(id = random uuid, did, state = 'uploaded', bytes = 0, created_at = now, deadline_at = now + CHECK_DEADLINE_MINUTES, expires_at = now + 30 d)`; commit. (The cap counts attempts, not successes, so failed uploads still count; the copy says so.)
8. Stream the body to `drafts/<did>/v/<uploadId>/upload`, written with the object tag `lifecycle=expire` (E26; P4.25 step 6), with a running byte counter and a 15-minute total time limit:
   a. if the counter passes `declaredLength` or `VIDEO_UPLOAD_MAX_BYTES` → abort, delete the partial object, set state `failed`/`too_large`, 413;
   b. on client disconnect or the time limit → delete the partial object, state `failed`/`upload_incomplete`, nothing else (the day count stays);
   c. on store error → delete partial, state `failed`/`store_error`, 503;
   d. on success: the first 64 bytes were kept in memory during streaming.
9. Sniff the container from the first 64 bytes, never the client's `Content-Type`:
   - ISO-BMFF: bytes 4–7 are `ftyp` and the major brand is in the allow-list (`isom`, `iso2`, `mp41`, `mp42`, `avc1`, `qt  `, `M4V `, `3gp4`, `3gp5`, `3gp6`) → `container = 'isobmff'`;
   - EBML header `1A 45 DF A3` → `container = 'matroska'` (WebM/MKV; the demuxer and codecs are re-checked by ffprobe);
   - else → delete the object, state `failed`/`unsupported_container`, 415.
10. In one transaction: update `video_upload` (`bytes`, `container`), insert `transmission_buffer(subject_ref = uploadId, sealed = sealTo("legal_hold", JCS({address: clientAddress(req), at: request start time ISO, route: "PUT /upload/video"}), sealContext("app.transmission_buffer.sealed", uploadId)), expires_at = deadline_at)` (a few hundred bytes, far under `sealTo`'s 1 MiB cap), insert `review_job(kind = 'probe')`. Commit.
11. Return 202 `{uploadId}`. The response and every log line carry no address.

**Algorithm (sweeper):**
1. `DELETE FROM transmission_buffer WHERE expires_at < now()` **and whose upload is not `matched_hold`** (P4.07 keeps a matched buffer for up to 7 days until it is moved; review F2); log the count only.
2. For each `video_upload` in state `uploaded` or `processing` whose `deadline_at < now()` and whose fingerprint check has not finished → hand to P4.06's deadline rule (state `failed`/`check_unavailable`, bytes deleted). The buffer row is gone by step 1 either way.
3. `DELETE FROM upload_day_count WHERE day < current_date - 2`.

**Edge cases and failures:**
- The transmission buffer is the one place an address is written (global invariant 3's exception; **Alex decision 21**, plan §5.8 and §6). It is sealed with `sealTo` to the **legal-hold recipients** (P1.14a, age X25519; asymmetric: the upload path can seal but never read); the private key never touches a server (it stays offline with the owners and is used only on an owner's device after that owner exports the ciphertext with their own `legal_hold_reader` login, P4.07; P4a-A1 settled by Alex 2026-10-03), so `web`, `review`, `review_egress`, `admin`, logs and moderators cannot read it; a match moves the ciphertext unchanged into the hold, anything else destroys it within minutes (no match: at once, P4.06; no verdict: at the hard check deadline); it is an **UNLOGGED** table so it never enters WAL or replicas; its data is excluded from every backup (the P5.04 dump uses `--exclude-table-data=transmission_buffer`; see Notes); the IP-write CI check (P0.06 / admin design §8.1 test) allow-lists exactly this table and `legal_hold_transmission`.
- Postgres crash → an UNLOGGED table is truncated on recovery: every pending buffer is lost; a match found afterwards is held without transmission data and the case says "transmission data unavailable (lost before match)". Accepted; the runbook says so.
- `Content-Length` lies (smaller than the body) → the counter aborts at the declared length.
- Two parallel uploads racing the daily cap → the row lock in step 7 serialises them.
- Quota counts the declared original size; the real derived sizes are re-checked by P4.05 (masters and renditions are counted against quota when written) → if the derived set exceeds the quota, P4.05 fails the upload with `quota_exceeded`.
- A file that sniffs as MP4 but is a playlist, an image or a text file pretending to be MP4 → caught by ffprobe in P4.05 with a fixed demuxer.
- Upload from a signed-out browser or with a cross-site Origin → 401 / 403 before any byte is read.
- Clock: `at` is the server's time at request start, not a client value.

**Threats:** untrusted video uploads up to 250 MB, and the sealed transmission buffer.
  - D Storage or bandwidth exhaustion → length required, declared and streamed caps, quota, daily cap
    (`intake-length-required`, `intake-body-exceeds-declared`, `intake-quota`, `intake-daily-cap`).
  - T A non-video or playlist file accepted → container sniff (`intake-sniff-rejects`).
  - E A frozen or disabled uploader, or another DID reading the status → refused (`intake-frozen`,
    `intake-uploads-disabled`, `status-owner-only`).
  - I Transmission data (IP, UA) readable or kept → sealed to a key no service holds, unlogged table, expiry, not in
    logs (`buffer-unreadable-by-web-and-review`, `buffer-expiry-destroys`, `buffer-unlogged`, `no-ip-in-logs`).

**Done when (tests):**
- `intake-happy-path`: signed-in member, 5 MB MP4 fixture (synthetic, ffmpeg `testsrc`) → 202; object exists; `video_upload.state = uploaded`; one `transmission_buffer` row whose `sealTo` envelope (decrypted with the test legal-hold identity, held only by the test) has the context `app.transmission_buffer.sealed|<uploadId>` and address, time and route; one `upload_day_count` row with `kind = 'video'`; one `probe` job.
- `intake-uploads-disabled`: a DID for which `uploadsEnabled` is false → 403 `upload_disabled`, no row, no object.
- `intake-frozen`: DID with `uploads_frozen` → 403 `upload_frozen`.
- `intake-length-required` and `intake-declared-too-large` (250 MB + 1) → 411 / 413 before the body is read (the test body stream throws if read).
- `intake-body-exceeds-declared`: declared 1 MB, sends 2 MB → 413, partial object deleted, state `failed`.
- `intake-daily-cap`: 10 uploads, 11th → 429 `daily_cap`; 11 parallel requests → exactly 10 succeed.
- `intake-quota`: quota used 2 GB − 1 MB, upload 2 MB → 413 `quota_exceeded`.
- `intake-sniff-rejects`: PNG bytes with `Content-Type: video/mp4`; an `.m3u8` text file; random bytes → 415, object deleted.
- `intake-sniff-accepts-webm-and-mov`: WebM and QuickTime fixtures → 202.
- `intake-disconnect`: the client aborts mid-stream → partial object deleted, state `failed`/`upload_incomplete`.
- `intake-csrf-exception-denies`: CSRF middleware throws → 403.
- `buffer-unreadable-by-web-and-review`: the `web`, `review`, `review_egress` and `admin` containers' config holds no legal-hold private key (config schema test), the `review` and `review_egress` DB roles get `permission denied` on `SELECT … FROM transmission_buffer`, and a decrypt attempt with every key available to `web` fails.
- `buffer-expiry-destroys`: an upload whose check never finishes → after `deadline_at` one sweep deletes the row; the ciphertext is nowhere in the DB (`SELECT` by upload id returns nothing) and the upload is `failed`/`check_unavailable`.
- `buffer-unlogged`: `pg_class.relpersistence = 'u'` for `transmission_buffer`.
- `buffer-sweep`: rows past `expires_at` are deleted by one sweep; rows before are kept; a row past `expires_at` whose upload is `matched_hold` is kept.
- `no-ip-in-logs`: capture all log output of the happy path → no IPv4/IPv6 pattern, no UA.
- `status-owner-only`: another DID asks for the status → 404.

**Reuse:** prototype `app/src/lib/posts.ts:36-49` (`assertPostMediaAllowed` trusts the client MIME and size) → LESSON (check size, but sniff bytes, never trust MIME). `app/src/actions/posts.ts:50-74` (reads the whole file into memory, then uploads raw bytes to the repo) → REJECT (plan §2 rule 10 and §5.8: originals never reach a repo; stream, do not buffer). Provisional — for reuse review.

**Not in this step:** codec, duration and dimension checks (P4.05 ffprobe); fingerprints (P4.06); moving the buffer into a hold (P4.07); the upload UI and progress bar (P4.14 owns the publish screen; the picker uses the shared UI kit); the 30-day expiry (P4.25); resumable uploads (not in the plan, see Notes).

**Diagram:** see "Flow: one video from upload to publish" (steps 1–5).

---

### P4.04g — Grants for the `review` roles on existing tables (split from P4.04, SE-6)
Tags: [SEC]            Depends on: P4.03, P1.12            Plan: §5.2 roles; §9 trusted base (rule SE-6, as ruled 2026-10-04; plan `f9b48f8`)
Where: one migration (role and grant statements only), `roles.json`, `grant-matrix.json` rows, matrix test rows
Size: ~20 lines SQL, ~20 test lines

Why a separate step (letter suffix): `video_upload` exists since P4.03, so `review`'s and `review_egress`'s grants on it
are trusted base; so is any `roles.json` change that lets these roles log in (`passwordFrom`, P0.09c rule 8). Grants on
tables P4.04 itself creates (`review_job`) ride with P4.04; grants on tables later steps create (`video_fingerprint`,
`fingerprint_result` P4.06, `nudity_result` P4.08, `transcript` P4.09, `text_result` P4.09a, `review_decision`) ride
with those steps, as P4.04's table lists them.
Goal: the two review roles can touch `video_upload` exactly as P4.04's table says, and can log in.
Inputs: P1.12 roster (`review`, `review_egress`, both `passwordFrom: null`); P4.03 `video_upload`.
Outputs: `review` and `review_egress`: SELECT on `video_upload`, UPDATE (`state`, `error_code`) on it; their roster
  entries' `passwordFrom` set; the matrix rows. Nothing else (P4.00 confirms the list against what P4.03 built).
Algorithm: the statements and the roster change.
Edge cases and failures: a grant P4.04's table does not list → the matrix test fails.
Threats: the review roles.
  - E A review role wider than its table → `grant-matrix-review-roles` (P4.04) and `matrix_matches`.
Done when (tests): `matrix_matches`; as `review`, `UPDATE video_upload SET bytes = …` fails `42501`.
Reuse: none. Not in this step: the queue, containers and definers (P4.04). Diagram: none.

---

### P4.04 — `review` worker skeleton: no-network compute container, egress container, Postgres job queue
Tags: [SEC]            Depends on: P4.04g, P1.27, P1.12, P1.18, P1.18b, P1.02, P1.03            Plan: §5.8 "The worker runs ffmpeg in its own container with no network except storage, on its own CPU quota", §6.1 transcoder budget, §7 (`interfaces/review`); plan-issues 3
Where: `interfaces/review/compute/main.ts`, `interfaces/review/egress/main.ts`, `infrastructure/postgres/jobs/queue.ts`, migration for `review_job`, the roles `review`, `review_egress` and the cross-role definer functions; `deployment/compose.dev.yaml` services `review` and `review-egress` with their networks; the Dockerfile(s) for both
Size: ~320 source lines, ~280 test lines

**Goal:** stand up the two halves of the review worker, a compute container that can reach only Postgres and the object store and does all media work and every moderation verdict, and an egress container that reads no media and reaches only one fixed outside host (Arachnid Shield, from P5.07b; plus the internal `pds-admin` verb `preserve.create`) through `net-guard` in proxy mode, sharing one Postgres job queue with leases and bounded retries. No Anthropic call exists in v1 (answer 30b).

**Inputs:** P1.27 image conventions (non-root, digest-pinned `node:26`, hadolint, signing); P1.12 roles and grant-matrix test; P1.18/P1.18a net-guard and P1.18b proxy mode with the `egress-fixed-review` proxy instance; P1.02 config; P1.03 logger.

**Outputs:**
- `queue.enqueue(tx, {uploadId, kind, runAfter?})`; `queue.claim(kinds[], workerId, leaseSeconds) → job | null` using `SELECT … FOR UPDATE SKIP LOCKED LIMIT 1` on `state = 'queued' AND run_after ≤ now()`; `queue.complete(job, next?: {kind}[])`; `queue.fail(job, errorCode, retryable)`; `queue.extendLease(job)`.
- Job kinds and the container that may claim each:

  | Kind | Container | Next |
  |---|---|---|
  | `probe` | compute | `fingerprint` (always; for a file that cannot be decoded at all, `fingerprint` finds no frame to hash) |
  | `fingerprint` | compute | `egress_fingerprint` |
  | `egress_fingerprint` | egress | `limits` (no known match) or the P4.07 match path; runs the `FingerprintCheck` stage (fake until P5.07b) |
  | `limits` | compute | `transcode` or `failed` |
  | `transcode` | compute | `transcript` |
  | `transcript` | compute | none → `ready` |
  | `preserve_copy` | compute | none (P4.07) |
  | `manual_match` | egress | the P4.07 match path (enqueued by `admin`, P4.12) |
  | `unblur_frame` | compute | none (enqueued by `admin`, P4.12) |
  | `nudity` | compute | `text_gate` (P4.08: nudity and gore on the images; always continues, so the text gate sees every submission) |
  | `text_gate` | compute | `route` (P4.09a; the first job for a `comment`) |
  | `route` | compute | inserts a `web_job` publish task (P4.14, run by `web`'s job runner), or hands a suspected item to P4.07 `onMatch` |

  (`egress_classify` is not a v1 kind: it belongs to the P4.10 later option.)

  Handlers are registered by later steps; the skeleton ships with a no-op test handler.
- Roles: `review` (compute) and `review_egress` (both already in `roles.json`, P1.12), each with the minimum grants, added to the P1.12 grant matrix. Grants on `video_upload` (an existing table) and the roles' `passwordFrom` are **P4.04g** (SE-6); the rest ride with the step that creates each table. (`provider_access_lost` and its grants are P5.07b's.)

  | Table / function | `review` | `review_egress` |
  |---|---|---|
  | `review_job` | select/update/insert | select/update/insert |
  | `video_upload` | select; update `state`, `error_code` | select; update `state`, `error_code` |
  | `video_fingerprint` | insert, select | select |
  | `fingerprint_result` | select | insert, select |
  | `nudity_result`, `transcript`, `text_result` | insert, select | — |
  | `review_decision` | insert | — |
  | `web_job` | insert only (kind `publish_video`) | — |
  | `transmission_buffer`, `legal_hold_transmission` | **none** | **none** (only `EXECUTE` on the P4.07 definer functions) |

- Cross-role writes, all through definer functions or narrow grants listed in the P1.12 matrix (review F10): `web` → `review_job` insert (kind `probe`, `nudity`, `text_gate`) and `cancel_review_jobs(upload_id)` (sets `cancelled` only); `review` → `web_job` insert only; `admin` → `review_job` insert of kinds `unblur_frame` and `manual_match` only, through `enqueue_admin_review_job(kind, upload_id)`; the `retention` role → the P4.07 hold-expiry definer function (no direct `DELETE` grant on `legal_hold_transmission`).
- Compose networks: `review-store` (internal: Postgres, object store); the compute service is on `review-store` only, `cpus: 2.0`, `mem_limit`, `pids_limit`, read-only root FS, a bounded `tmpfs` scratch, `cap_drop: ALL`, `no-new-privileges`, non-root user. `review-egress` is on `review-store`, on `internal-pds-admin` (it may call `preserve.create` only, key-scoped by `pds-admin`) and on `review-out`, whose only route outside is the **`egress-fixed-review` proxy instance** (P1.18b: smokescreen, allow-list exactly the `arachnid` host, generated from the net-guard policy) that net-guard reaches in proxy mode. This step only references it; the `arachnid` host is first used by P5.07b's real check, so until then the proxy allows nothing. No firewall rule lists IP addresses.
- Object-store credentials (review F1):
  - compute: read on `drafts/*/v/*/upload`; read/write on `drafts/*/v/*/` derived files; **delete** on `drafts/*`; **write-only** (no read, no delete) on `legal-hold/*`;
  - egress: **no object-store credential at all** (answer 30b removed `frames-cleared/*`). Egress never reads, copies or deletes any object.
  - If the provider cannot scope by prefix, the compute credentials are per bucket and the step notes it.
- Metrics hooks: queue depth per kind, job wall time per kind, failures per error code (aggregate only, no DID or upload id).

**Algorithm (worker loop, both containers):**
1. On boot: load config (fail on any missing key); egress also checks that its net-guard policy names the `arachnid` host when `FINGERPRINT_CHECK = arachnid` (P5.07b), that no other outside policy is configured, and that the `egress-fixed-review` proxy answers its health check, else exit non-zero.
2. Loop: `job = queue.claim(myKinds, workerId, lease = 120 s)`; if none → wait 1 s (bounded backoff to 5 s), repeat.
3. Run the handler with an AbortSignal whose deadline is the per-kind time limit (probe 30 s, fingerprint 120 s, limits 10 s, transcode 180 s, transcript 60 s, preserve_copy 300 s, unblur_frame 20 s, nudity 120 s (nudity and gore), text_gate 60 s, egress_fingerprint 60 s, manual_match 60 s, route 10 s). Extend the lease every 60 s while running.
4. On success → `queue.complete(job, next)` in the same transaction as the handler's own writes.
5. On a retryable error (storage 5xx, network timeout, 429) and `attempts < 5` → `state = queued`, `run_after = now + 2^attempts × 10 s` with ±20 % jitter, `last_error_code` set.
6. On a non-retryable error or `attempts = 5` → `state = failed`; the handler's failure policy decides the upload's state (each later step says which); never "pass".
7. On a lease expiry (worker died) → another worker may claim it after `lease_until`; handlers are idempotent (each writes with `ON CONFLICT` on its result table and deterministic object keys).
8. On SIGTERM → stop claiming, finish or release the current job (set `state = queued`, `lease_until = null`) within 25 s, exit.

**Edge cases and failures:**
- Compute tries any outbound connection (DNS, an IP) → no route; the network test proves it.
- Egress tries a host not on the list (including the object store's public endpoint or an IP literal) → net-guard refuses; the proxy refuses any hostname not on its list; the bare-`fetch` lint (P0.06) covers the code.
- A compromised egress container can read no media at all (it holds no object-store credential) and can reach only Arachnid Shield and `preserve.create`.
- A poison job that always crashes the process → attempts are incremented at claim time, not at completion, so a crash loop ends after 5 claims.
- Queue grows faster than processing → queue-depth alert at > 50 or oldest `probe` > 10 min (§6.1 "queue-depth alert").
- The CPU quota is a hard limit, so a burst slows reviews, never `web` or the PDS (§5.8).
- Two workers claim the same job → impossible under `SKIP LOCKED`; a test proves it with 20 concurrent claimers.

**Threats:** the review worker: untrusted media processed next to fixed outside hosts.
  - E A parser exploit in compute reaches the network → compute has no network (`compute-has-no-network`).
  - E Egress reads media or reaches other hosts → no store credential, fixed hosts only, no model provider
    (`egress-has-no-store-credential`, `egress-only-fixed-hosts`, `no-model-provider-egress`).
  - E A role wider than its tables → grant matrix (`grant-matrix-review-roles`, `compute-legal-hold-write-only`).
  - D A poison job loops → stops after 5 claims (`queue-poison-stops`).

**Done when (tests):**
- `queue-skip-locked`: 100 jobs, 20 concurrent claimers → each job claimed exactly once.
- `queue-retry-backoff`: a handler failing retryably 3 times → `run_after` grows, then success.
- `queue-poison-stops`: a handler that kills the process → after 5 claims the job is `failed`.
- `queue-lease-recovery`: claim, kill the worker, advance time past the lease → another worker claims it; the handler's write is idempotent (one result row).
- `queue-sigterm-releases`: SIGTERM during a job → job back to `queued` within 25 s.
- `compute-has-no-network` (compose integration): from inside the compute container, TCP to `1.1.1.1:443` and a DNS lookup of `example.com` both fail; Postgres and the object store succeed.
- `egress-only-fixed-hosts` (integration): from the egress container, net-guard to an unlisted host is refused; a direct socket bypassing the proxy has no route; the proxy refuses an unlisted hostname.
- `egress-has-no-store-credential`: the egress container's config schema holds no object-store key; an object-store request from inside it fails authentication for every key (`upload`, `master.mp4`, `r360.mp4`).
- `compute-legal-hold-write-only`: with compute credentials, PUT on `legal-hold/x` succeeds; GET and DELETE on it → 403.
- `grant-matrix-review-roles`: `information_schema.role_table_grants` equals the tables above; `review` and `review_egress` have no grant on `transmission_buffer`; `web` can cancel but not otherwise update `review_job`; `admin` can enqueue only `unblur_frame` and `manual_match`.
- `boot-missing-key`: unset `PDS_PRESERVE_KEY` in egress → exit non-zero, the key name (not its value) in the error.
- `no-model-provider-egress` (answer 30b): the net-guard policy set and the `egress-fixed-review` allow-list contain no `anthropic` (or any other model-provider) host; the config schema refuses `ANTHROPIC_*` and `CLASSIFIER_*` keys.
- `images-hardened`: hadolint clean; the container runs as non-root; root FS read-only.

**Reuse:** none in the prototype (it had no worker; transcoding never existed). Libraries: none new in this step (the forward proxy belongs to P1.18b). Provisional — for reuse review.

**Not in this step:** any handler logic (P4.05–P4.11); the forward proxy itself (P1.18b); production networks (P5.02 re-implements the compose rules for production); capacity sizing (P5.11).

**Diagram:**
```mermaid
flowchart LR
  subgraph review-store [network review-store, internal]
    C[review compute<br/>ffmpeg, pdq, nudenet, gore model, whisper.cpp,<br/>Detoxify, Llama Guard 3 1B<br/>all media reads and writes, every verdict]
    PG[(Postgres)]
    OS[(object store)]
  end
  E[review_egress<br/>reads no media] --> PG
  E --> FP[egress-fixed-review proxy<br/>hostname allow-list, P1.18b]
  FP -->|the only fixed host, from P5.07b| AS[Arachnid Shield API]
  E -->|internal, preserve.create only| PA[pds-admin]
  C --> PG
  C --> OS
```

---

### P4.05 — Probe, limits and transcode: ffprobe validation, stripped 1080p master, 360p and 720p faststart renditions, posters
Tags: [SEC]            Depends on: P4.04, P4.03            Plan: §5.8 "Renditions", "Upload checks", "Compressed for feeds", "Fingerprint check on everything" (decision 7); §2 rule 10; §6.1 budget (feed clip, transcoder ≤90 s per 60 s clip on two cores)
Where: `interfaces/review/compute/probe.ts`, `interfaces/review/compute/limits.ts`, `interfaces/review/compute/transcode.ts`, `interfaces/review/compute/mp4-verify.ts`, `interfaces/review/compute/ffmpeg-args.ts`; ffmpeg/ffprobe in the compute image (pinned build); tests and synthetic fixtures under `tests/integration/review/fixtures/` (generated by ffmpeg `testsrc2`/`sine` at test time, never real footage)
Size: ~370 source lines, ~370 test lines

**Goal:** read and pick the streams of every upload so it can be fingerprinted, then, only after the fingerprint check passes, reject anything that is not a short, allow-listed video and produce the stripped 1080p H.264 master that will become the repo blob, two progressive renditions with 2-second keyframes and faststart, posters and blurred review thumbnails.

**Inputs:** P4.04 queue and handler registry; P4.03 upload object and row; P2.17 `encodeImage` for posters; config `VIDEO_MAX_DURATION_MS`; quota hooks from P2.18.

**Outputs:**
- Handler `probe(job) → ProbeInfo | Undecodable` where `ProbeInfo = {container, durationMs, video: {index, codec, width, height, rotation, fps, pixFmt}, audio?: {index, codec, channels, sampleRate}, extraVideoStreams: int}`. Next job is always `fingerprint` (decision 7: every video processed is checked, including ones the limits will reject).
- Handler `limits(job)` (runs after P4.06 recorded `no-known-match`) → `ok` (next `transcode`) or `Reject(code)` (state `failed`, objects deleted).
- Handler `transcode(job)` writing `master.mp4`, `r720.mp4`, `r360.mp4`, `poster.avif`, `poster.webp`, `thumbs-blur/{0..9}.webp` under `drafts/<did>/v/<uploadId>/`, and the helper `extractFrames(objectKey, {everyMs | count}, maxEdge) → frame files` reused by P4.06, P4.08 and P4.12.
- `mp4Verify(bytes) → ok | VerifyError(code)`: a box walker that checks the output: `moov` before `mdat` (faststart), no `udta`/`meta`/`uuid`/`©xyz` boxes, zero creation/modification times, exactly the expected tracks.
- `video_upload` updated with `aspect = {width, height}` and `durationMs`; quota re-check on derived bytes.

**Algorithm (probe):**
1. Run `ffprobe` on the local scratch copy with: `-v error`, `-print_format json`, `-show_streams -show_format`, `-protocol_whitelist file`, `-f` set from the sniffed container (`mov` for ISO-BMFF, `matroska` for EBML), `-probesize 50M -analyzeduration 20M`, time limit 30 s.
2. Pick the video stream: the first video stream whose disposition is not `attached_pic`, preferring one with the `default` flag (not requiring it); ignore `attached_pic` streams (cover art); count the other real video streams in `extraVideoStreams`. Audio: the first audio stream, default preferred; others ignored (never mapped). Subtitle, data and attachment streams are never mapped.
3. Decode test: decode the first 2 s of the picked video stream to `null` (time limit 20 s).
4. If ffprobe times out or exits non-zero, no real video stream exists, or the decode test fails → `Undecodable`: store that flag, write no frames, next job `fingerprint` (which then has no frame to hash, P4.06). A file ffmpeg cannot decode at all is the only one that is deleted without a PDQ check: v1 checks PDQ only, and no media-free exact lookup exists (plan §5.8; decision 23).
5. Else store `ProbeInfo`, state `processing`, next job `fingerprint`. No limit is applied yet.

**Algorithm (limits; only after `no-known-match`):**
1. If the upload was `Undecodable` → `Reject(probe_failed)`.
2. `extraVideoStreams ≥ 1` → `Reject(multiple_video)`.
3. Video codec ∈ {h264, hevc, vp8, vp9, av1}; audio codec (if any) ∈ {aac, opus, mp3, vorbis}; else `Reject(codec_not_allowed)`.
4. `durationMs` (format duration, else the video stream's) present and `≤ VIDEO_MAX_DURATION_MS` else `Reject(too_long)`; `width, height` within 144..4096 each and `width × height ≤ 4096 × 2304` else `Reject(dimensions)`; `fps ≤ 120` else `Reject(fps)`.
5. On any reject: state `failed` with the code, delete `drafts/<did>/v/<uploadId>/*` and the fingerprint rows, complete with no next. (The buffer row was already destroyed at `no-known-match`, P4.06.)
6. Else next job `transcode`.

**Algorithm (transcode):**
1. Compute the target sizes with rotation applied (ffmpeg autorotate on; the output carries no rotation side data): master = short edge ≤1080, r720 = short edge ≤720, r360 = short edge ≤360; never upscale; even dimensions.
2. One ffmpeg invocation per output (or one with three outputs), arguments built only by `ffmpeg-args.ts` from typed values (no string from the file reaches the command line): `-protocol_whitelist file -f <demuxer> -i <scratch>`, `-map 0:<videoIndex> -map 0:<audioIndex>?`, `-map_metadata -1 -map_chapters -1 -sn -dn`, `-fflags +bitexact -flags:v +bitexact -flags:a +bitexact`, `-c:v libx264 -profile:v high -pix_fmt yuv420p -preset medium`, rate control per output (master `-crf 20 -maxrate 6M -bufsize 12M`; r720 `-crf 23 -maxrate 3M -bufsize 6M`; r360 `-crf 23 -maxrate 1.2M -bufsize 2.4M`), output fps `f = min(source fps, 60)` (`-fpsmax 60`), keyframes every 2 s (`-g 2×f -keyint_min 2×f -sc_threshold 0`), `-c:a aac -b:a 128k|96k|64k -ac 2` (no audio track if the source has none), `-movflags +faststart`, `-t 60.5`, `-f mp4`. Wall-time limit 180 s, `nice 10`, threads = 2.
3. On non-zero exit or timeout → retryable once (a transient OOM), then state `failed`/`transcode_failed`, delete all draft objects, no next job.
4. Run `ffprobe` and `mp4Verify` on each output: codec h264 High, the expected dimensions, average bitrate within the cap (r360 ≤ 1.2 Mbps, r720 ≤ 3 Mbps measured as size×8/duration, 10 % tolerance), keyframe interval ≤ 2.1 s (from `-show_frames -select_streams v -skip_frame nokey` on r360), real duration ≤ 60.5 s, `moov` before `mdat`, no metadata boxes, zero timestamps. Any failure → `failed`/`output_invalid` (never published).
5. Poster: extract the frame at `posterTimeMs` (default 1,000 ms, or 0 for clips shorter than 1 s) at the master size; `encodeImage(frame, {maxEdge: 1080, formats: [avif, webp], maxBytes: 30 KB})`; if it cannot meet 30 KB at the floor quality, reduce `maxEdge` stepwise to 540, then fail `poster_too_large`.
6. Blurred thumbnails for the admin queue: 10 frames evenly spaced, scaled to 160 px on the long edge, Gaussian blur σ = 12, WebP. (Unblurred review frames are made on demand by P4.12, never stored in advance.)
7. Quota: if `quota.used(did)` including the new derived bytes exceeds the limit → state `failed`/`quota_exceeded`, delete derived objects.
8. Write `aspect`, `durationMs`; next job `transcript` (P4.09).
9. Delete the scratch copy in all branches (the `finally` of every handler).

**Edge cases and failures:**
- A file rejected by the limits (61 s, MPEG-2, 8K) was still fingerprinted first (decision 7); only an undecodable file skips PDQ (it has no frame to hash) and is then rejected by the limits.
- A file with a header claiming 60 s but a real stream of 10 minutes → frame sampling in P4.06 is spread over the real duration (capped at 63 frames); the limits check uses the probed duration; `-t 60.5` caps the encode and the post-check measures the real output.
- Cover art (`attached_pic`) and files with no `default` disposition → handled by the stream-pick rule.
- Variable frame rate phone footage → `-fpsmax 60` and constant-GOP flags make keyframes regular; the keyframe test covers VFR.
- HDR/10-bit HEVC (iPhone) → `-pix_fmt yuv420p` with a tone-map filter (`zscale`+`tonemap`) when the transfer is PQ/HLG. If the filter is missing in the build → the image build test fails.
- No audio stream → outputs have no audio; P4.09 marks "no speech".
- Portrait video with a rotation matrix → autorotate applied once; `aspectRatio` is the displayed one.
- Decompression bomb (tiny file, huge dimensions) → the decode test runs under the container memory limit; the dimension limit applies after the check.
- An ffmpeg demuxer exploit → contained by the no-network, non-root, read-only container; the image is rebuilt by Renovate on each ffmpeg release.
- A file that ffmpeg decodes as an image sequence or a playlist → impossible: the demuxer is fixed (`-f mov` or `-f matroska`) and only the `file` protocol is allowed.

**Threats:** untrusted video parsed and transcoded by ffmpeg.
  - E A playlist or reference file makes ffmpeg fetch → refused, local listener sees nothing
    (`probe-rejects-playlist`).
  - E Limits rejecting a file before its fingerprint is checked → fingerprint first (`limits-run-after-fingerprint`,
    `probe-undecodable-still-fingerprinted`).
  - D Lying durations or huge frames exhaust the worker → limits and a time budget (`transcode-lying-duration`,
    `limits-reject-dimensions`, `transcode-budget`).
  - I Location and device metadata published → stripped (`transcode-strips-metadata`). T Broken output served →
    `mp4verify-fails-closed`.

**Done when (tests):**
- `probe-accepts-h264-aac`: synthetic 10 s 1080×1920 H.264/AAC MP4 → ProbeInfo with rotation 0, duration 10,000 ± 50 ms; next job `fingerprint`.
- `probe-cover-art`: MP4 with an `attached_pic` stream and no `default` flags → the real video stream picked, `extraVideoStreams = 0`.
- `probe-undecodable-still-fingerprinted`: random bytes behind a valid `ftyp` → `Undecodable`, next job `fingerprint` (no hash, `no_hashable_frames`), then `limits` → `failed`/`probe_failed`.
- `limits-run-after-fingerprint`: a 61 s fixture → a `fingerprint_result` row exists **before** `failed`/`too_long`; objects deleted after.
- `limits-reject-codec`, `limits-reject-multiple-video` (two real video streams), `limits-reject-dimensions` (8000×8000 single frame) → rejected after the check.
- `probe-rejects-playlist`: an HLS playlist renamed `.mp4` that references `http://127.0.0.1/x.ts` → `Undecodable`; a local HTTP listener in the test records zero connections.
- `transcode-outputs-valid`: 1080×1920 source → master 1080×1920, r720 720×1280, r360 360×640, all H.264 High, faststart, keyframe interval ≤2.1 s, r360 ≤1.2 Mbps, r720 ≤3 Mbps.
- `transcode-120fps`: a 120 fps source → output 60 fps, keyframe every 120 frames (2 s).
- `transcode-strips-metadata`: source with a `©xyz` location, `©mak`/`©mod`, a GPS `uuid` box and a creation time → outputs contain none of the strings; `mvhd` times zero (`mp4Verify` ok).
- `transcode-rotated`: 1920×1080 with rotation 90 → outputs portrait, no rotation side data.
- `transcode-no-upscale`: 640×360 source → master, r720 and r360 are all 640×360.
- `transcode-lying-duration`: crafted file with a short header duration and a long stream → output ≤60.5 s or `too_long`.
- `transcode-budget` (tagged `slow`, runs on the CI runner with 2 cores): a 60 s 1080×1920 30 fps synthetic clip → total wall time ≤90 s (§6.1). The CI job records the time as a metric.
- `poster-size`: AVIF and WebP posters ≤30 KB each.
- `mp4verify-fails-closed`: truncated or malformed output → `VerifyError`, never "ok".
- `transcode-quota`: quota nearly full → `quota_exceeded`, derived objects deleted.

**Reuse:** prototype `app/src/lib/privacy-video.ts:20-96` (MP4 box walker that neutralises `udta`/`meta`/`uuid` in place and zeroes `mvhd`/`tkhd`/`mdhd` times, with the lesson that `stco`/`co64` offsets forbid deleting bytes) → LESSON: the rebuild re-encodes instead, and the walker idea becomes the **verifier** `mp4Verify`; its fail-open line `privacy-video.ts:98-103` ("a file that does not parse … is returned unchanged") → REJECT that behaviour (verify fails closed). `app/src/lib/privacy-video.test.ts:5-15` (the `box()` fixture builder) → LESSON for the verifier's unit tests. `app/src/lib/privacy-image.ts:42` (`sharp(…, {failOn: "none"})`) → REJECT (fail-open decode); poster encoding goes through P2.17. Libraries: **ffmpeg/ffprobe** (plan-named) → USE, pinned build by digest; licence to verify: a build with libx264 is **GPL-2.0+**, so the image must ship or offer the corresponding source; confirm compatible with the AGPL choice (P0.13). Provisional — for reuse review.

**Not in this step:** fingerprints (P4.06); serving renditions (P4.16); the player (P4.16); HLS (not planned); AV1 output (rejected by the plan).

**Diagram:** none (the job order is in P4.04's table).

---

### P4.06 — Video fingerprints: PDQ on sampled frames, checked through the `FingerprintCheck` stage from the egress step
Tags: [SEC] [MOD]            Depends on: P4.05, P2.16 (the `FingerprintCheck` stage and `fakeFingerprintCheck`), P2.16b (the PDQ module)            Plan: §5.8 "Fingerprints (decision 7)", "Fingerprint check on everything"; decision 23 (the real Arachnid check in Phase 5); §6 RoPA (Arachnid Shield, fingerprints only); plan-issues 3 and 4
Where: `interfaces/review/compute/fingerprint.ts` (hashing, no network), `interfaces/review/egress/fingerprint-check.ts` (calls the `FingerprintCheck` stage), migration for `video_fingerprint`, `fingerprint_result`; P2.16b's PDQ module in the compute image
Size: ~150 source lines, ~220 test lines

**Goal:** compute the PDQ fingerprints of every uploaded video inside the no-network worker, pass only the hashes to the one `FingerprintCheck` stage from the egress step, and record one verdict that gates everything else.

**Why the stage and not a client (editor pass, decision 23):** Phase 4 uses the same `FingerprintCheck` interface as P2.16, with `fakeFingerprintCheck` in development, CI and the trusted test track. The real Arachnid Shield client (PDQ hashes, `POST /v1/pdq/`, through net-guard), its spike, the production origin pin, the `provider_access_lost` flag and the image legal-hold entry point are **P5.07b**; production refuses to boot without the real check (P2.16). Swapping in the real check is one line in `review_egress`'s composition root; this step never adds a second client.

**Inputs:** P4.05 `probe` result and `extractFrames`; P2.16 `FingerprintCheck` (configured by `FINGERPRINT_CHECK`) and P2.16b's PDQ module; P4.04 queue; P4.03 `transmission_buffer` and `deadline_at`.

**Outputs:**
- Handler `fingerprint(job)` (compute): writes `video_fingerprint` rows, one `pdq` row per sampled frame (`frame_ms`, 256-bit hash hex, `quality` 0–100). Next: `egress_fingerprint`.
- Handler `egressFingerprint(job)` (egress): calls `FingerprintCheck.check`, writes `fingerprint_result(upload_id, verdict: no-known-match | match, classification: csam | harmful-abusive-material | null, match_type: exact | near | null, checked_at, provider_ref)` (the check's `name`, `fake` or `arachnid`, is recorded in `provider_ref`). On `no-known-match`: destroys the transmission buffer row, next job `limits` (P4.05). On `match`: calls the P4.07 entry point `onMatch({subjectKind: 'video', subjectRef: uploadId, did, result})`.
- v1 computes **PDQ only**: no MD5 (no media-free exact lookup exists; Arachnid's "exact" is a match on uploaded media) and no TMK+PDQF (no provider available to us accepts it; it returns when a provider does; plan issue, see Notes).

**Algorithm (compute, `fingerprint`):**
1. If the upload is `Undecodable` (P4.05) → write no row, enqueue `egress_fingerprint` (step 5 below records `no_hashable_frames`).
2. Sample frames from the **uploaded original** (not the transcode, which runs later): at 1 fps when the real duration is ≤61 s, otherwise 63 frames evenly spaced across the real decoded duration; always include the first and last frame; native size capped at 1,024 px long edge (PDQ downsamples internally); never more than 63 frames, so a 10-minute file costs the same as a 60 s one.
3. For each frame run P2.16b's PDQ module (5 s limit per frame); collect `{hash, quality}`. If it fails on a frame → retry that frame once, then record it as missing; if more than half the frames fail → job fails retryably (then the deadline rule applies).
4. Insert all rows in one transaction (`ON CONFLICT DO NOTHING` on `(upload_id, kind, frame_ms)`); enqueue `egress_fingerprint`.

**Algorithm (egress, `egress_fingerprint`):**
1. If `now > deadline_at` → go to step 6 (deadline rule).
2. Read the PDQ rows; keep hashes with `quality ≥ 50` (ThreatExchange's guidance and P2.16's rule: low-quality hashes, such as flat or black frames, produce false near-matches); deduplicate identical hashes.
3. If none remain → `verdict = no-known-match` with `provider_ref = "no_hashable_frames"` (a flat or undecodable file cannot match a perceptual list); go to step 5.
4. `r = FingerprintCheck.check(hashes, {timeoutMs: 10000})` (batching, the HTTP call and the response parsing are inside the real check, P5.07b):
   - `clear` → `verdict = no-known-match`.
   - `match` → `verdict = match` with the result's `classification` (`csam` or `harmful-abusive-material`) and `matchType`.
   - `unavailable` → retryable job failure (P4.04 backoff); nothing is decided. (Provider access loss, 401/403 and an unparseable response are reported as `unavailable` by the real check, which also raises `provider_access_lost`, P5.07b.)
5. Write `fingerprint_result` in a transaction with the next transition:
   - `no-known-match` → `destroy_transmission(upload_id)` (P4.07 definer function) **in the same transaction**; enqueue `limits`.
   - `match` → hand to P4.07 `onMatch` (which owns the transaction that keeps and moves the buffer). Never transcode a match.
6. Deadline rule (no verdict by `deadline_at`): state `failed`/`check_unavailable`; enqueue a compute cleanup that deletes the draft objects; delete the fingerprint rows; the buffer row is deleted by the sweeper (P4.03) if not already; the user sees "We could not check this upload; please try again later." Never publish or keep an unchecked video.

**Edge cases and failures:**
- The check unavailable for hours → every upload fails at the deadline (fail closed, the plan's rule); queue-depth and failure-rate alerts fire.
- A near match on one frame among 60 → still a match (P4.07 decides report vs analyst hold).
- Hash rows outlive the upload → deleted with the draft (P4.25 expiry, P4.14 publish, failure paths) unless held.
- An unknown classification from the provider → the real check reports `unavailable` (P5.07b), never "no match".
- Private posts and drafts are checked exactly like public ones (§5.8 "every photo and video").
- The privacy-notice line ("fingerprints of every photo and video leave for this check; media never does") is P2.15's text; this step adds only the failure copy.

**Threats:** the fingerprint check of every uploaded video.
  - I Frames, DIDs or names sent outside → hashes only (`check-only-hashes-passed`).
  - E A video passing unchecked (outage, fake in production, long file) → retries then fails closed; fake refused in
    production; frames capped over the real duration (`check-unavailable-retries`, `check-deadline`,
    `check-prod-refuses-fake`, `fingerprint-long-file-capped`).
  - T A match not acted on → `onMatch` once (`check-match-hands-off`).

**Done when (tests):** (no real abuse material anywhere: PDQ correctness is P2.16b's, tested on ThreatExchange's published benign test images; the check here is `fakeFingerprintCheck` with a fixture list; the real client's contract tests are P5.07b's)
- `pdq-on-frames-matches-module`: a frame extracted from a synthetic clip → the stored hash equals P2.16b's module output for the same frame.
- `fingerprint-frame-count`: 10 s synthetic clip → 11 or 12 PDQ rows (1 fps + first/last, deduplicated by timestamp); no other kind of row.
- `fingerprint-long-file-capped`: a 10-minute synthetic file → exactly 63 PDQ rows spread over the real duration.
- `check-low-quality-no-call`: an all-black 5 s clip → zero `check` calls, `no-known-match`, `provider_ref = no_hashable_frames`.
- `check-no-match-destroys-buffer`: fake returns `clear` → `fingerprint_result.no-known-match`, `transmission_buffer` row gone in the same transaction (a crash injected after commit still finds no row), job `limits` queued.
- `check-match-hands-off`: a fixture hash listed as `match` (`csam`, `exact`) → `onMatch` called once with `subjectKind: 'video'` and that result; no `limits` or `transcode` job.
- `check-hyphenated-names`: the stored classification is `harmful-abusive-material` for a fixture listed that way; underscores never appear.
- `check-unavailable-retries`: fake returns `unavailable` → retryable failure, `run_after` set; next call `clear` → `no-known-match`.
- `check-deadline`: clock advanced past `deadline_at` before a verdict → `failed`/`check_unavailable`, objects and fingerprint rows deleted.
- `check-only-hashes-passed`: the check receives only PDQ hashes; no frame bytes, no DID, no handle, no filename.
- `check-prod-refuses-fake`: `review_egress` with `UNSET_ENV = prod` and `FINGERPRINT_CHECK = fake` → boot fails (P2.16's rule, applied to this container).

**Reuse:** P2.16's `FingerprintCheck` and P2.16b's PDQ module → USE (one stage, one hasher; this step never adds a second). The Arachnid Shield SDK and our own client → P5.07b. Provisional — for reuse review.

**Not in this step:** what happens at a match (P4.07); image fingerprints (P2.16); the real Arachnid client, the `provider_access_lost` flag and the image hold (P5.07b); chat media (cannot be checked; §5.6).

**Diagram:** see "Flow: one video from upload to publish" and "Flow: the abuse-material match".

---

### P4.07g — Legal-hold reader logins (split from P4.07, SE-6)
Tags: [SEC]            Depends on: P1.12            Plan: §5.2 roles; §9 trusted base (rule SE-6, as ruled 2026-10-04; plan `f9b48f8`); §5.8 "Abuse-material law (decision 9)"; lead decision 2026-10-03 (`legal_hold_reader` is for named humans only)
Where: one migration (role statements only), `roles.json`, `grant-matrix.json` (`roles` section), matrix test rows
Size: ~15 lines SQL, ~25 test lines

Why a separate step (letter suffix): new roles and role memberships are trusted base whatever they grant on. The
`EXECUTE` on `core.export_sealed_record`, which P4.07 creates, rides with P4.07.
Goal: each owner has their own `lh_<owner>` login, a member of `legal_hold_reader`, before the export path exists.
Inputs: P1.12 `legal_hold_reader` (group, no login) and its per-class assertions; the signed roster's owners.
Outputs: per owner, role `lh_<owner>` (class `human`, `LOGIN`, `connectionLimit` 1, `passwordFrom: null`, the P1.12
  attributes) and `GRANT legal_hold_reader TO lh_<owner>`; `roles.json` entries; matrix `roles` rows. Nothing else.
Algorithm: the statements, idempotent like P1.12's.
Edge cases and failures: a service or job role made a member, directly or through another role → P1.12's
  `class_assertions` fails the build.
Threats: the legal-hold export.
  - E A service or `admin` gains export → `class_assertions` (P1.12), `matrix_matches`.
  - S A login without a certificate → `pg_hba.conf` `cert` only (P4.07; outside the parsed paths, CODEOWNERS-reviewed).
Done when (tests): `roster_complete` and `class_assertions` (P1.12) with the new roles; an `lh_<owner>` has no
  password.
Reuse: none. Not in this step: `core.export_sealed_record`, `app.legal_hold_reader_login`, `pg_hba.conf`, the CLI
  (P4.07). Diagram: none.

---

### P4.07k — Legal-hold domain and the offline export CLI (split from P4.07, SE-6)
Tags: [SEC] [MOD]            Depends on: P4.07g, P4.06, P3.16c, P1.14a            Plan: §5.8 "Abuse-material law (decision 9)", decision 21; §9 trusted base (rule SE-6, as updated 2026-10-04; plan `6275827`): the legal-hold seal path and `interfaces/legal-hold-export/`
Where: `domains/moderation/legal-hold/*`, `interfaces/legal-hold-export/` + their tests
Size: hypothesis, P4.00 sets it (~150 source lines, ~200 test lines)

Why a separate step (letter suffix): both folders are trusted base; P4.07 used to build them in the same PR as the
review callers, the admin screen and the migration, which P0.09c's isolation check refuses.
Goal: the one hold entry point and the ciphertext-only export exist and are tested before anything calls them.
Inputs: P1.14a `sealTo`/`sealToStream`; P3.16c `preserve.*` verbs (as a port); P4.07g `lh_<owner>` logins.
Outputs (contract as P4.07 states it): `onMatch` (the one hold entry point, shared with P5.07b for images), written
  against ports for the database definers, `preserve.create` and the object store, so it has no `infrastructure/`
  import (invariant 13); the CLI `legal-hold-export <holdId> --out <file>` exactly as P4.07's "Offline export CLI"
  bullet describes, calling `core.export_sealed_record` through its port.
Algorithm (hypothesis, P4.00 refines): as P4.07's match path and export bullets.
Edge cases and failures: as P4.07; the CLI's database calls are tested against a fake port here and against the real
  function in P4.07's integration tests.
Threats: the legal-hold seal path.
  - I Plaintext of held material on any server → no decrypt code (P1.14a `no_decrypt_in_servers`), ciphertext-only
    export (P4.07 `legal-hold-export-in-no-image`).
Done when (tests): P4.07's tests for `onMatch` and the CLI that need no database (P4.00 lists them);
  `legal-hold-export-in-no-image`.
Reuse: none. Not in this step: the migration, definers, callers, admin screen and expiry job (P4.07). Diagram: none.

---

### P4.07 — Match path: block, sealed 365-day legal hold on `pds-admin`'s clock, transmission data held unread, Cybertip.ca report by an owner, no moderator view
Tags: [SEC] [MOD]            Depends on: P4.07k, P4.07g, P4.06, P3.16 and P3.16c (the preserve verbs), P4.03, P3.20, P1.14a, P3.07            Plan: §5.8 "Abuse-material law (decision 9)", "Fingerprints", decision 21 (the buffer); §6 retention ("one year after notification … transmission data sealed with the hold and destroyed with it"); admin design §6.6, §7, §8.1; plan-issues 4
Where: (`domains/moderation/legal-hold/*`, the one hold entry point `onMatch` shared with P5.07b for images, and `interfaces/legal-hold-export/` are **P4.07k**, trusted base, SE-6; this step wires them) `interfaces/review/egress/on-match.ts` (the video caller); `interfaces/review/compute/preserve-copy.ts`; `apps/admin/screens/legal-hold.ts` (owner-only case view from hold metadata, notify); definer functions `keep_transmission_for_match`, `move_transmission_to_hold`, `destroy_transmission`, `close_expired_hold`, `core.list_holds`, `core.export_sealed_record` (the body of `core.is_held`, declared by P3.07, is **P4.07h**: replacing an existing function is trusted base, SE-6); the `legal_hold.media_key` row in `infrastructure/postgres/sealed-columns.json`; (the owners' human login roles in `roles.json` are P4.07g); migration for `legal_hold`, `legal_hold_transmission` (the `uploads_frozen` flag is P2.16's column on `app.account`; the `preserve.*` verbs are built by P3.16c); the hold-expiry job under the `retention` role; runbook update `docs/human/runbooks/cybertip-report-and-preserve.md` (from P1.37) with the offline decryption procedure
Size: ~330 source lines (egress ~100, compute ~110, admin ~70, expiry ~50), ~420 test lines

**Goal:** when any fingerprint matches, stop the upload, preserve the upload and its transmission data in an encrypted legal hold that no moderator can browse and that runs on `pds-admin`'s clock for one year after notification, and give an owner exactly what the Cybertip.ca report needs, decrypted only on the owner's own device. The same entry point runs the **suspected-abuse emergency path** (Alex 16:39Z, answer 30c) when a local check or a person suspects child sexual abuse material that no fingerprint matched (see "Suspected abuse material" below).

**Settled by Alex (2026-10-03, P4a-A1, answered by #1 at 11:45Z): K2 lives only on the owners' hardware keys, offline; records are exported and opened on the owner's device.** Where the legal-hold private key lives: **no server holds the private key**. It is an X25519 `age` identity (P1.14a refuses plugin recipients on servers) kept offline and protected at rest by the owners' hardware keys (P0-A4, answered by Alex 2026-10-03 11:45Z: opening it needs one of the two hardware keys), from the P0.12 ceremony (inventory row K2). A named owner exports the sealed record with the offline CLI and their own `legal_hold_reader` login (never through `admin`), and decrypts offline following the runbook. The online-decrypt path is never built.

**Inputs:** P4.06's call `onMatch({subjectKind: 'video', subjectRef: uploadId, did, result})` and the `manual_match` job from P4.12; P4.03 `transmission_buffer` (a `sealTo` envelope); P3.16/P3.16c `pds-admin`; P3.19/P3.20 per-action signing and the owner role; P1.15 `appendAudit`; P3.07's `erase_did`, its placeholder `core.is_held` and `core.erase_pending_hold`; the P1.37 runbook; P1.14a `sealTo` and `sealToStream` (encrypt only; no decrypt function is deployed anywhere).

**Outputs:**
- `onMatch({subjectKind: 'video' | 'image' | 'suspected', subjectRef, did, result})` in `domains/moderation/legal-hold/`: **the one hold entry point**, called by P4.06 for videos (in `review_egress`), by P5.07b for images, and for suspected material (answer 30c) by the `manual_match` job (enqueued by P4.11 `route` on a text-gate S4 verdict, or by a P4.12 reviewer), by P4.21a for a proxied Bluesky image, and by P6.15's chat evidence report. For `subjectKind = 'suspected'`, `result = {kind: 'suspected', origin: 'text_gate' | 'nudity' | 'reviewer' | 'chat_report', itemKind: 'video' | 'bsky_post' | 'comment' | 'image' | 'chat_evidence'}` and `subjectRef` is the item's own reference. Database work and the internal `preserve.create` call only; it never touches media. The video path is specified below; P5.07b specifies the image path through the same function and table.
- Handler `preserve_copy(job)` in **compute**: seals the upload (for a suspected item: the item's parts, below) while copying it to `legal-hold/<holdId>/`, writes and verifies a manifest, then deletes the drafts prefix. Held media of any size is **one object**, sealed with P1.14a's streaming form: `sealToStream("legal_hold", source, sealContext("app.legal_hold.media_key", subjectRef), maxBytes = the upload cap)`, written as `legal-hold/<holdId>/media.age`. The column `app.legal_hold.media_key` (the object's key) is registered in `sealed-columns.json` as a `sealToStream` object column with row key `subject_ref`, as P1.14 requires, so the context exists before the hold id does (P5.07b seals images in `web` under the same context). The manifest keeps only what is still needed: the object key, the ciphertext size and sha256 (store and backup verification, P5.04), the plaintext size and sha256 (the owner's check after decrypting), the context string, the recipient id, the PDQ values and the provider ref. No chunking of our own and no second encryption mechanism exist: age's own STREAM format chunks and authenticates the object (lead decision 2026-10-03).
- `pds-admin` verbs used (built by **P3.16c**, summarised here for this step's tests; zero-dependency, same envelope format):
  - `preserve.create {holdRef (random 128-bit), kind: report | analyst, subject_did}` (no `createdBy` argument: `created_by` comes from the verified service key) accepted **only** with the `review_egress` service key (`PDS_PRESERVE_KEY`, in the roster's `service_keys`, as `web`'s key is accepted for `invite.issue` only) or an owner envelope; idempotent on `holdRef`; returns a receipt `{holdId, createdAt}` from `pds-admin`'s clock; log entry; immediate owner alert. `subject_did` lets `pds-admin`'s reaper and held deletes refuse that DID (P3 B3).
  - `preserve.notify {holdId, notifiedAt}` owner envelope only; sets `expiresAt = notifiedAt + 365 d`; refuses a second notify; receipt.
  - `preserve.listExpired {}` → `[holdId]` whose `expiresAt ≤ now(pds-admin clock)` and not closed; the `retention` service key (roster `service_keys`; read-only verb).
  - `preserve.close {holdId}` → only for an expired hold; `retention` service key; receipt.
  - No verb shortens, cancels or releases a hold early; a legal order that changes the period is a break-glass runbook entry with two owners (admin design §6.6).
- Definer functions (executed by the named role only):
  - `keep_transmission_for_match(subject_ref)` (`review_egress`; P5.07b grants it to its caller for images): sets the buffer's `expires_at = now + 7 d`; for a video, allowed only when `video_upload.state = 'matched_hold'`.
  - `move_transmission_to_hold(subject_ref, hold_id)` (`review_egress`): inserts `legal_hold_transmission(hold_id, sealed)` from the buffer and deletes the buffer row atomically; returns `moved | absent`.
  - `destroy_transmission(subject_ref)` (`review_egress`, used by P4.06 at `no-known-match`).
  - `close_expired_hold(hold_id)` (`retention`): deletes the sealed row and the fingerprint rows for that hold, marks it closed. When the subject's DID was erased under this hold (`partially_erased_legal_hold`, the remainder tracked in `core.erase_pending_hold`), the expiry job then runs `erase_did` again with `why = legal_hold_closed` (P3.07).
  - The body of **`core.is_held`** (P3.07 declares it as a placeholder; one name, lead decision 2026-10-03), in two argument forms: `core.is_held(did text) → boolean` (the DID has an open hold) and `core.is_held(subject_kind text, subject_ref text) → boolean` (that subject has an open hold; P4.25 calls `core.is_held('video', upload_id)`). Both read `legal_hold` where `state` is not closed; SECURITY DEFINER, `search_path` pinned; `EXECUTE` to the roles that erase, back up or expire (P3.07, P5.04, P5.09, `retention`); they return a boolean, never a hold row.
  - `core.export_sealed_record(hold_id) → (hold_id, subject_kind, subject_ref, created_at, media_key, sealed)`: the only read path to `legal_hold_transmission`; it returns **ciphertext** only. `EXECUTE` goes to the group `legal_hold_reader` and to nothing else. In the same transaction it writes the audit row through `audit.append` (P1.15's SQL side of `appendAudit`; action `pii.transmission_export`, `actorDid` = the owner DID that `legal_hold_reader_login` maps the calling `session_user` to, target the hold id); a login with no mapping → raise, nothing returned (fail closed).
  - `core.list_holds() → (hold_id, subject_kind, kind, state, created_at, notified_at)`: hold metadata only (ids, dates, status; no DID, no subject ref, no ciphertext). `EXECUTE` to `admin` only. `admin` has no other privilege on `legal_hold` or `legal_hold_transmission`.
  - **`legal_hold_reader` is for named humans only (lead decision 2026-10-03, security).** The group (P1.12, `rolcanlogin = false`) has `EXECUTE` on `core.export_sealed_record` and nothing else. Its members are the owners' own login roles `lh_<owner>` (class `human` in `roles.json`, one per owner in the signed roster, `connectionLimit` 1, `passwordFrom: null`: no password exists; the role logs in only with a TLS client certificate whose private key stays on that owner's device, so no server holds the credential), mapped to the owner's DID in `app.legal_hold_reader_login(rolname, owner_did)` (migration-only writes). `pg_hba.conf` accepts these roles only with method `cert` and only from the staff tailnet range (the tailnet policy grants each owner device the Postgres port for this and nothing else). **`admin`, a service, and every other service or job role must never be a member of `legal_hold_reader`, directly or transitively**; P1.12's per-class assertion fails the build if one is.
- **The single erasure rule (owned here; P3.07, P5.04, P5.08b, P5.09 apply it):** `core.is_held` is the one hold predicate. `eraseDid` erases every row and object of the DID except held material, reports `partially_erased_legal_hold`, and never refuses the whole erasure; the remainder is tracked in `core.erase_pending_hold` and erased when the hold closes (the expiry job runs `erase_did` again with `why = legal_hold_closed`).
- `legal_hold` row (display copy) and an `admin` case with reason code `csam`, owner-visible only.
- Owner screens in `admin` (owner role): the case (from `admin`'s own case record: classification, match type, provider ref, hash list) and the hold's metadata through `core.list_holds()` (hold id, dates, status); **Record notification** (`preserve.notify`). `admin` has **no export**: no screen, URL or signed URL displays, plays, decrypts, exports or downloads the held media or the sealed transmission data.
- **Offline export CLI** `interfaces/legal-hold-export` (an entry point run by a named owner on their own device, never in a container): `legal-hold-export <holdId> --out <file>` connects to Postgres over the tailnet as the owner's own `lh_<owner>` login (its client certificate; the server certificate pinned), calls `core.export_sealed_record`, fetches the `media_key` object's ciphertext with a read-only credential for the `legal-hold/` prefix that the owners hold offline (separate from P5.04's backup credential; no service holds it), and writes one bundle: the sealed transmission record, the sealed media object and the manifest, all ciphertext. It contains no decrypt code (P1.14a's `no_decrypt_in_servers` guard covers `tools/**`); decryption happens afterwards with the `age` CLI and the owner's offline key.
- Hold-expiry job (`retention` role, daily): `preserve.listExpired` → for each: delete `legal-hold/<holdId>/*` (retention holds delete rights on that prefix only), `close_expired_hold(holdId)`, `preserve.close`, `appendAudit` action `review.hold_closed`; then, if `core.erase_pending_hold` lists the hold's DID and no other hold on it is open, `erase_did(did, why = legal_hold_closed)`.

**Report vs analyst hold (provisional until the lawyer hour; plan §5.8 and review 04 MINOR 12):**

| Match | Content | Action |
|---|---|---|
| `exact`, classification `csam` | any | hold `kind = report`; owner files the Cybertip.ca report |
| `exact`, classification `harmful-abusive-material` | any | hold `kind = report` pending the lawyer hour's answer on whether it is reportable as child pornography (else `analyst`) |
| `near`, classification `csam` | submitted for publication (public intent) | hold `kind = report` |
| `near`, any classification | private draft, not submitted | hold `kind = analyst`: no report; the owner asks a C3P analyst per the runbook; only an analyst ever views |
| `near`, `harmful-abusive-material` | submitted for publication | hold `kind = analyst` |

**Algorithm (`onMatch`, video path, called in `review_egress`):**
1. Idempotency: if `legal_hold` already has a row for this subject (`subject_kind = 'video'`, `subject_ref = upload_id`) → return (a retried job).
2. Transaction A (commit before any outside call):
   a. `video_upload.state = 'matched_hold'`, `error_code = 'unavailable'`;
   b. `keep_transmission_for_match(upload_id)` (buffer now expires in 7 days, so a match found close to `deadline_at` cannot lose the evidence; the P4.03 sweeper also skips any buffer whose upload is `matched_hold`);
   c. set `app.account.uploads_frozen = true` (P2.16's one flag, read by `uploadsEnabled`; reversible only by an owner, with a reason);
   d. create the case (reason `csam`, kind from the table), owner-only;
   e. cancel every other queued job for this upload;
   f. `appendAudit(tx, {action: 'review.match', outcome: 'succeeded', actorKey: 'review_egress', target: <upload id>, case})`; no DID in the body (the case holds it), no address.
3. Call `pds-admin` `preserve.create {holdRef, kind, subject_did}` with the `review_egress` service-key envelope (`PDS_PRESERVE_KEY`; internal network, 5 s timeout):
   - timeout or 5xx → retry 5 times with backoff (P4.04); after 5 failures → immediate alert "hold not created", the job stays failed for an owner to re-run from the case (idempotent on `holdRef`);
   - 4xx (envelope refused) → immediate alert; same owner re-run path;
   - success → receipt `{holdId, createdAt}`.
4. Transaction B: insert `legal_hold(hold_id, did, subject_kind = 'video', subject_ref = upload_id, kind, created_at = receipt.createdAt, state = 'open', case_id, media_key = 'legal-hold/<holdId>/media.age')`; `move_transmission_to_hold(upload_id, hold_id)`; if it returns `absent` (lost in a Postgres crash, or the upload came through `manual_match` long after the deadline) → mark the case "transmission data unavailable" (the report then carries what exists, s. 4 "data in your possession"); enqueue `preserve_copy`.
5. Immediate owner alert "legal hold created" (admin design §7.5 tiers: action class and panel link only; no DID, no reason code, no hashes).
6. A buffer still unmoved 7 days after Transaction A (the hold never got created) → owner alert at day 6; at day 7 the sweeper destroys it as usual and the case records the loss.
7. User-facing: the upload shows "This upload is unavailable. Contact support if you think this is a mistake." (no reason given, pending the lawyer hour on tipping off); further uploads return `upload_frozen`.

**Suspected abuse material: the emergency path (Alex 16:39Z, answer 30c; full detail: a mistake here is hard to undo).**
Entered when a local check or a person suspects child sexual abuse material that no fingerprint matched: the P4.09a
text gate returns S4 (child sexual exploitation) on a non-transcript field; a reviewer in P4.12 chooses "Suspected
child abuse material"; a P6.15 chat evidence report is marked so by its reviewer; or a future image check flags a
probable minor (no v1 model can: P4.08 says so, so in v1 that origin is reached only through a reviewer). Alex asked
to "send to Arachnid": Arachnid Shield is a hash lookup only, every image and video was already PDQ-checked, and new
material cannot be submitted to it, so nothing new is sent there; the legal channel is **Cybertip.ca**, run by the same
organisation (C3P) under the Mandatory Reporting Act.
1. **Block at once.** The item is never published and never sent to any third party (no model provider, no
   Arachnid call for the item's content, no Bluesky write). Video: `video_upload.state = 'matched_hold'`; `bsky_post`
   and `comment`: the draft or pending comment moves to the same terminal hold state (`matched_hold`, added to their
   state lists by P4.17 and P4.20); the item leaves every queue.
2. **Seal it under the legal hold** through `onMatch({subjectKind: 'suspected', …})` in `review_egress` (the
   `manual_match` job; compute and `admin` only enqueue it): transaction A and `preserve.create` exactly as the video
   path, hold `kind = report`, `legal_hold.subject_kind = 'suspected'` with `item_kind`; the C-16 preservation clock
   applies unchanged (`pds-admin`, one year after notification). `preserve_copy` then seals the item's parts as one
   deterministic, uncompressed tar stream through the same `sealToStream` call into `legal-hold/<holdId>/media.age`:
   video → the upload; `bsky_post` → its stored images and its text; comment → its text; image (P4.21a, P5.07b) →
   the bytes; chat evidence → the reporter-supplied evidence P6.15 holds. After the copy verifies, the plaintext
   draft rows and objects are deleted (`pending_comment.text` and `bsky_post_draft.text` are overwritten in the
   same transaction). There is no transmission data for most suspected items (a video's buffer was destroyed at
   `no-known-match`; text has none); the case says "transmission data unavailable (not a fingerprint match)".
3. **Emergency alert to the owners at once** through P3.20c's highest alert class, `csam_emergency`: delivered
   immediately through `alert.notify`, never only in the daily digest and never suppressed by the alert caps (a
   request to P3.16d/P3.20c, see Notes). Payload: the class and the panel link only (no DID, no handle, no reason
   code, no hashes, no text).
4. **A report case that needs a person**: reason `csam_suspected`, owner-only, `kind = report`; the case cannot
   close until an owner records the Cybertip.ca filing (`preserve.notify`) or an owner records, with a reason, that
   the item is not reportable (the hold then follows the analyst path and expires 365 days after creation,
   provisional, lawyer hour). Until the lawyer hour fixes the legal deadline, the case re-alerts in the
   `csam_emergency` class every 4 hours until one of those is recorded. The runbook
   (`docs/human/runbooks/cybertip-report-and-preserve.md`, P1.37, section "Suspected, not matched") says: file the
   Cybertip.ca report within the deadline; **if a child appears to be in imminent danger, also call the police
   directly (911 or the local police) at once**.
5. **Freeze uploads** for the DID that posted the item (`app.account.uploads_frozen`, P2.16's flag; reversible
   only by an owner with a reason). The **reporter is never frozen** (a chat evidence report freezes the reported
   sender if they are our member, never the reporter).
6. **Audit** `appendAudit(tx, {action: 'csam.suspected', outcome: 'succeeded', actorDid?: <reviewer DID when a person
   decided>, actorKey?: 'review' | 'review_egress' (automated), target: <hold ref>, case})` in transaction A; no DID
   of the subject, no text, no address in the row (the case holds the DID). `csam.suspected` joins P1.15's closed
   action list by migration.
- **Viewing is the minimum.** Reviewers never download the item. After step 1 the item cannot be unblurred, played or
  opened in P4.12 or anywhere in `admin`; owners see the case metadata only, and the content only offline through the
  export CLI when the report needs it, like a match.
- A false S4 (Llama Guard over-flags) is costly (a hold, a freeze, an alert), but Alex's rule is to treat suspicion as
  an emergency; shadow mode (P4.09a) measures the S4 rate before launch and the AI system record states it.

**Algorithm (`preserve_copy`, compute):**
1. Stream `drafts/<did>/v/<uploadId>/upload` through `sealToStream("legal_hold", source, sealContext("app.legal_hold.media_key", uploadId), maxBytes = the video upload cap)` (compute holds the recipients' public keys only) into `legal-hold/<holdId>/media.age`, computing the plaintext and ciphertext sizes and sha256 while streaming. A `seal_to.*` or stream error → delete the partial object and retry (P4.04).
2. Write `legal-hold/<holdId>/manifest.json` (object key, ciphertext size and sha256, plaintext size and sha256, context, recipient id, the PDQ values, the provider ref). Compute cannot read back `legal-hold/*`; verification uses the sizes and hashes the store returns on PUT (ETag/checksum headers) compared with those computed while streaming.
3. On a mismatch or store error → retry (P4.04); never delete the drafts until the copy verifies.
4. Delete `drafts/<did>/v/<uploadId>/*` (the original; derived files should not exist because the limits and transcode never ran).

**Algorithm (owner report, `admin`):**
1. Owner opens the case in `admin` (owner role required, else 403): case facts and hold metadata only.
2. On their own device, the owner runs `legal-hold-export <holdId>` with their own `lh_<owner>` login over the tailnet: `core.export_sealed_record` writes the audit row (`pii.transmission_export`, the owner's DID as actor) and returns the ciphertext; the CLI writes the bundle. `admin` is not involved, holds no `legal_hold_reader` membership and cannot export or decrypt. Any failure (no tailnet, no mapping, certificate refused) → no bundle (fail closed).
3. On their own device, the owner decrypts per the runbook (`docs/human/runbooks/open-sealed.md` from P1.14a). Decryption needs one of the two hardware keys in hand (P0-A4, answered by Alex 2026-10-03 11:45Z): the owner opens the K2 identity file from its USB copy with `age-plugin-yubikey` (PIN and touch) straight into the `age -d -i` call (process substitution; the opened identity is never written to disk), so the bundle is decrypted with the standard `age` CLI; there is no paper or passphrase copy of K2. The export CLI itself still decrypts nothing. Then the owner checks (P1.14a runbook: check the context of the record and of the media object's header line, and compare the media with the manifest's plaintext sha256), files the Cybertip.ca report (hashes, classification, provider ref, DID, handle, upload time, transmission data; never media from our side: C3P requests preserved data through the runbook if needed), and destroys the local plaintext afterwards.
4. The owner records the notification: `preserve.notify {holdId, notifiedAt}` (signed) → `expiresAt = notifiedAt + 365 d`, mirrored to `legal_hold.notified_at`.
5. A `report` hold with no notification after 24 h → immediate alert, then daily digest; an `analyst` hold follows the runbook's analyst path and, if the analyst finds nothing, expires 365 days after creation (provisional, lawyer hour).

**Edge cases and failures:**
- No moderator view: there is no route, signed URL purpose or media-proxy prefix for `legal-hold/*`; `media` refuses any key outside `drafts/` (signed) and `media/` (indexed); a test enumerates `admin` routes and fails if one reads `legal-hold/`.
- No online decryption: no container image or config contains the legal-hold private key; a test scans the built images' config schemas and secret lists.
- The hold must survive draft TTL, backup pruning and `eraseDid`: no lifecycle rule on `legal-hold/`; P5.04 backups keep legal-hold objects outside pruning; `eraseDid` erases everything else and skips `legal_hold*` rows and `legal-hold/` objects while a hold is open (outcome `partially_erased_legal_hold`), then finishes when the hold closes; the reaper skips the DID (`preserve.create` carries `subject_did`; admin design §8).
- The account is not automatically taken down: a takedown is a moderator action in `admin` per the runbook (it is public and could tip off); uploads are frozen at once.
- `pds-admin` clock vs Postgres clock disagree → `pds-admin` is authoritative; the expiry job asks it, never computes from `legal_hold.notified_at`.
- A second upload from the same DID with a match → a second hold and case (one per upload).
- Owners lose every copy of the legal-hold identity → held transmission data and media cannot be decrypted; key custody is in the P0.12 ceremony (P0-A4 answered: K2's identity file is encrypted to both hardware keys, two USB copies in two places, no paper copy; losing both hardware keys loses K2).
- A P4.12 reviewer's "Suspected child abuse material" (`manual_match` job) → `onMatch` with `subjectKind = 'suspected'`, `origin = 'reviewer'`, `kind = report` and `provider_ref = "manual:<caseId>"` (the emergency path above, answer 30c); the buffer is long gone, so the case says so.
- Notifications under C-16 go to the body the regulation designates; the runbook names it and is updated when the designation changes (quarterly bills watch, §6).

**Threats:** matched material, the evidence hold and the transmission data held for authorities.
  - I Held material or transmission data read by any service or moderator → sealed; no role, route or CLI decrypts
    (`roles-cannot-decrypt`, `export-only-human-reader`, `admin-lists-metadata-only`, `export-cli-no-decrypt`,
    `no-media-route`, `egress-never-reads-media`).
  - T A hold shortened, cancelled or erased → no early release; erasure skips it; expiry on `pds-admin`'s clock
    (`pds-admin-no-early-release`, `erase-skips-hold`, `pds-admin-expiry-from-notification`).
  - E The preserve key used for other verbs → scoped (`pds-admin-preserve-key-scope`).
  - E A matched or suspected item processed, viewed or published → blocked, uploads frozen (`match-no-processing`,
    `match-freezes-uploads`, `suspected-not-viewable`, `suspected-never-leaves`).
  - I Identifiers in alerts → none (`alerts-carry-no-identifiers`).

**Done when (tests):** (all with synthetic bytes, a `fakeFingerprintCheck` match and a test-only age identity that exists only in the test process)
- `match-moves-buffer`: upload with a buffer row; `onMatch(exact csam)` → `legal_hold_transmission` has the identical ciphertext bytes, `transmission_buffer` has no row, `legal_hold.state = open`, `video_upload.state = matched_hold`.
- `match-near-deadline-keeps-buffer`: match committed 1 s before `deadline_at`; the sweeper runs; `preserve.create` succeeds after 30 s → buffer moved, not lost.
- `match-buffer-unmoved-7d`: `preserve.create` keeps failing → owner alert at day 6; buffer destroyed at day 7; case records the loss.
- `match-buffer-absent`: buffer row deleted before the match → case flagged "transmission data unavailable", hold still created.
- `match-freezes-uploads`: after a match, `PUT /upload/video` by the same DID → 403 `upload_frozen`.
- `match-no-processing`: no `limits`, `transcode`, `nudity` or `text_gate` job exists for the upload.
- `preserve-copy-in-compute`: the `preserve_copy` job is claimed only by compute; for a 5 MB fixture, `legal-hold/<holdId>/media.age` exists, contains no `ftyp`/EBML header, opens with the test identity, its header line carries the context `app.legal_hold.media_key|<uploadId>`, and the remaining bytes equal the original and the manifest's plaintext sha256; the drafts prefix is then empty.
- `preserve-copy-one-stream`: `preserve_copy` calls `sealToStream` once and never `sealTo` (spies); a 0-byte upload produces a valid object and manifest.
- `media-key-registered`: `app.legal_hold.media_key` is in `sealed-columns.json` as a `sealToStream` object column with row key `subject_ref` (P1.14's registry test passes on the migrated schema).
- `preserve-copy-verify-before-delete`: the store returns a wrong checksum → retry, drafts kept.
- `egress-never-reads-media`: during the whole match path, the egress object-store mock records zero reads, copies or deletes.
- `pds-admin-preserve-key-scope` (with P3.16c): an envelope signed with `PDS_PRESERVE_KEY` for `preserve.notify`, `takedown` or `deleteAccount` → refused and logged; for `preserve.create` → accepted; repeated `holdRef` → same `holdId`.
- `pds-admin-no-early-release`: no verb shortens or cancels a hold; `preserve.close` on an unexpired hold → refused.
- `pds-admin-expiry-from-notification`: create at day 0, notify at day 3 → `listExpired` empty at day 367, contains it at day 368 (pds-admin clock mocked).
- `roles-cannot-decrypt`: `web`, `review`, `review_egress` and `admin` DB roles → `permission denied` selecting `legal_hold_transmission` directly; no deployed config holds the legal-hold private key; decrypting the held ciphertext with every key any container holds fails.
- `export-only-human-reader`: `admin`, `web`, `review`, `review_egress`, `retention` and `backup` → `permission denied` executing `core.export_sealed_record`; an `lh_` login in `legal_hold_reader` with a DID mapping → ciphertext only (no plaintext), one `pii.transmission_export` audit row with that DID as actor; an `lh_` login without a mapping → error, no row returned; a temp migration granting `legal_hold_reader` to `admin` → the P1.12 class assertion fails.
- `admin-lists-metadata-only`: `admin` calling `core.list_holds()` gets ids, dates and status only; `admin` selecting `legal_hold` or `legal_hold_transmission` directly → `permission denied`; a static scan finds no export route in `admin`.
- `export-cli-no-decrypt`: `interfaces/legal-hold-export/**` imports no `age-encryption` and contains no `Decrypter`; it is in no container image.
- `legal-hold-export-in-no-image`: for every `Dockerfile` and every compose `build.context` in the repository, no `COPY`/`ADD`
  source names `interfaces/legal-hold-export`, and each context that would contain the folder excludes it in its
  `.dockerignore`; a built image's file list (P1.27's image test) has no path under it. A fixture Dockerfile with
  `COPY interfaces/ ./interfaces/` and no ignore line fails.
- `no-media-route`: static scan of `admin` and `media` routes → none reads `legal-hold/`; a signed URL minted for `legal-hold/…` is refused by `media`.
- `expiry-job-deletes`: expired hold → objects and sealed row deleted through `close_expired_hold`, `preserve.close` receipt, audit row; unexpired hold untouched; the `retention` role has no direct `DELETE` grant on `legal_hold_transmission`.
- `erase-skips-hold`: `eraseDid` on a DID with an open hold → every other row erased, `legal_hold*` rows and `legal-hold/` objects kept, outcome `partially_erased_legal_hold` (never a refusal); after the hold closes, the expiry job runs `erase_did` with `why = legal_hold_closed`, the `core.erase_pending_hold` row goes, and nothing of the DID remains.
- `is-held-predicate`: `core.is_held('video', ref)` is true for an open hold and false for a closed or absent one; `core.is_held(did)` is true exactly while one of the DID's holds is open; neither returns a hold row.
- `alerts-carry-no-identifiers`: the alert payloads contain no DID, handle, address or hash.
- `report-vs-analyst-table`: each row of the table → the expected `kind`.
- `suspected-blocks-and-holds` (answer 30c): a `route` job with a text-gate S4 on the caption → upload `matched_hold`, one `manual_match` job, then `legal_hold(subject_kind = 'suspected', item_kind = 'video', kind = report)`, case `csam_suspected`; the same for a `comment` (pending comment `matched_hold`, its text sealed, no plaintext left in `pending_comment`) and a `bsky_post`.
- `suspected-never-leaves`: during the whole suspected path the net-guard mock records zero outside requests (no model provider, no Arachnid request carrying the item, no PDS write).
- `suspected-emergency-alert-immediate`: one `csam_emergency` alert delivered in the same monitor cycle, not waiting for the digest, not suppressed when the caps are already reached; payload without DID, handle, text or hash.
- `suspected-freezes-uploader-not-reporter`: the item's author gets `upload_frozen`; a reporter DID (chat report fixture) is not frozen.
- `suspected-audit-row`: exactly one `csam.suspected` audit row (reviewer DID as actor when a person decided; the service key when automated); no subject DID in the row.
- `suspected-case-realerts`: no notification recorded after 4 h → a second `csam_emergency` alert; recording `preserve.notify` stops it.
- `suspected-not-viewable`: after the flag, P4.12 play, unblur and item routes for the item → 404/409; no signed URL can be minted for it.
- `suspected-not-reportable-path`: an owner records "not reportable" with a reason → hold `kind = analyst`, expiry 365 days after creation, uploads stay frozen until an owner unfreezes them with a reason.

**Reuse:** prototype — none (it never matched or preserved anything; `app/src/lib/post-report.ts:20-23` logged reports to stdout → REJECT as the anti-pattern). Libraries: the public-key seal is P1.14a's `sealTo` and `sealToStream` (one way to do it; `age-encryption`/typage pinned there); the `age` CLI on the owner's offline machine (P0.12). Provisional — for reuse review.

**Not in this step:** the fingerprint call (P4.06); the text-gate verdict (P4.09a); the chat evidence caller (P6.15, through this step's entry point); the image hold path, the image transmission buffer and the real check (P5.07b, through this step's entry point and table); the `preserve.*` verbs themselves (P3.16c); the account takedown (moderator action, P3.20/P5.08); legal-order handling in general (admin design §8.1); the lawyer hour (P5.12).

**Diagram:** see "Flow: the abuse-material match (nobody views)" above.

---

### P4.07h — The body of `core.is_held` (split from P4.07, SE-6)
Tags: [SEC] [MOD]            Depends on: P4.07            Plan: the single erasure rule (owner P4.07); §9 trusted base (rule SE-6; plan `badf15a`: a replaced body of a function the PR does not create)
Where: one migration (`CREATE OR REPLACE FUNCTION` of both `core.is_held` forms only) + tests
Size: ~20 lines SQL, ~60 test lines

Why a separate step (letter suffix), and why after P4.07: `core.is_held` exists since P3.07k, so replacing its body is
trusted base (and it is on the `# trusted functions:` line). Its body reads P4.07's `legal_hold` table, so it lands
right after P4.07, which creates that table; until then the placeholder returns false, as in Phase 3.
Goal: erasure, backup and expiry see open holds.
Inputs: P4.07 `legal_hold`; P3.07k's placeholder signatures.
Outputs: both forms exactly as P4.07's "The body of `core.is_held`" bullet specifies (SECURITY DEFINER, `search_path`
  pinned, boolean only; EXECUTE unchanged).
Algorithm: the two `CREATE OR REPLACE` statements.
Edge cases and failures: a closed hold → false; `legal_hold` unreadable → the call raises and the caller fails closed
  (erasure keeps the row).
Threats: the single erasure rule.
  - T Held material erased → `erase-skips-held-rows` (P3.07) rerun with the real body; the hold tests P4.07 names.
Done when (tests): P3.07's `erase-skips-held-rows` with a real open hold; a closed hold → erased.
Reuse: none. Not in this step: the hold tables and definers (P4.07). Diagram: none.

---

### P4.08 — Local image gate: nudity (NudeNet class) and gore (hold-only), in the no-network container
Tags: [MOD]            Depends on: P4.05            Plan: §5.8 "Local nudity gate (decision 8)"; review 04 SERIOUS 4; Alex answers 30 and 30b (gore classifier hold-only; moderation local); `reviews/self-hosted-moderation-research.md` §3–§4
Where: `interfaces/review/compute/nudity.ts`, `interfaces/review/compute/gore.ts`, the two model files and their runtime in the compute image, migration for `nudity_result`
Size: ~200 source lines, ~240 test lines

**Goal:** run a local nudity detector and a local gore detector on the frames of a video (or the images of a Bluesky post) submitted for publication, so that nudity is blocked or sent to a person and gore is always held for a person; no frame leaves our servers (answer 30b).

**Inputs:** P4.05 `extractFrames`; P4.04 queue; a `nudity` job enqueued by the submission route (P4.11) or by P4.17 for a `bsky_post`; config `NUDITY_MODEL_SHA256`, `NUDITY_T_LOW`, `NUDITY_T_HIGH`, `GORE_MODEL_SHA256`, `GORE_T_HIGH`.

**Outputs:**
- Handler `nudity(job)` → `nudity_result(subject_kind, subject_ref, verdict: clear | unsure | fail, max_score, frames_checked, model_sha256, gore_verdict: clear | hold, gore_max_score, gore_model_sha256)`; next job always `text_gate` (P4.09a), whatever the verdict, so the text gate sees every submission (it is the only automated S4 check).
- `nudityScore(frameBytes) → {maxScore, classes}` using the pinned ONNX model on CPU.
- `goreScore(frameBytes) → {nsfl, nsfw}` using the pinned gore model (default `image-safety-classifier-s`, below) on CPU.
- No `frames-cleared/` object is written in v1 (that existed only to feed Claude, P4.10, off).

**Algorithm:**
1. Verify both model files' sha256 against `NUDITY_MODEL_SHA256` and `GORE_MODEL_SHA256` at boot; mismatch → refuse to start (the compute container exits; alert).
2. Frames: 1 fps from the 720p rendition (all frames of a ≤60 s clip, ≤61) plus the poster frame; for a `bsky_post`, each stored image (≤4).
3. For each frame: `nudityScore`; the score is the maximum over the "exposed" classes the model defines (genitalia, breasts, buttocks, anus); covered classes are ignored. Then `goreScore`. Time limit per frame 2 s per model; on a model error → retry once, then the job fails retryably; after 5 attempts → nudity `unsure` and gore `hold` (never `clear` on error).
4. `max_score = max over frames` of `max(nudity score, the gore model's NSFW score)` (the second model is a second opinion on nudity, research §4); `gore_max_score = max over frames` of the NSFL score.
5. Nudity: `max_score ≥ NUDITY_T_HIGH` → `fail`; else `≥ NUDITY_T_LOW` → `unsure`; else `clear`.
6. Gore: `gore_max_score ≥ GORE_T_HIGH` → `hold`; else `clear`. **Gore never blocks** (gore can be news or documentation; the model is immature): `hold` only sends the item to a person (P4.11 reason `needs_human_gore`). Changing that to a block is a later, measured, Alex-approved PR.
7. Insert `nudity_result`; next job `text_gate`.

**Thresholds:** `NUDITY_T_LOW` and `NUDITY_T_HIGH` start at the values the model's documentation recommends for "exposed" detection; `GORE_T_HIGH` starts low (hold generously). All three are tuned in shadow mode (P4.09a's `REVIEW_MODE`) on the labelled image set, measured as the false-negative rate first, and recorded in the AI system record (P1.36 template, filled in P4.09a). The labelled set never enters the repository; tests use stubs.

**Edge cases and failures:**
- Adult content is banned at launch, so nudity `fail` is a block with appeal and `unsure` is a person's case; these models "cannot reliably distinguish between an adult and a minor" (review 04; research §3: no local model does it reliably), so no v1 model flags a probable minor. P4.12 shows blurred thumbnails and offers the "Suspected child abuse material" button, which starts P4.07's emergency path; a future age-estimation model would enter the same path with `origin = 'nudity'`.
- Private drafts and private posts are not run through this gate (they are not sent anywhere); the gate runs only for submissions.
- A video with no faces or people → scores near 0 → `clear`.
- Model missing or corrupt → container refuses to start; submissions wait in the queue; queue-depth alert. Never a pass-through.
- CPU budget: ~0.5 s per frame for nudity plus ~20 ms per frame for gore on CPU → ≈32 s per clip on two cores; counted in the §6.1 budget alongside transcode (they run in different jobs). Gore model resident memory ~0.1 GB (research §4, estimate; the P4.09a spike measures it).

**Done when (tests):** (both models are replaced by stubs returning scripted scores in unit tests; no nude or gore imagery is ever a fixture)
- `nudity-unsure-routes`: one frame scores between T_LOW and T_HIGH → `unsure`, next job `text_gate`.
- `nudity-fail-routes`: one frame ≥ T_HIGH → `fail`, next job `text_gate` (the text gate still runs).
- `nudity-catches-between-samples`: stub scores high only at second 37 → `fail` (every second is scored).
- `nudity-second-opinion`: NudeNet stub low, gore model NSFW score above T_HIGH → `fail` (the max of the two).
- `gore-hold-never-blocks`: NSFL above `GORE_T_HIGH` → `gore_verdict = hold`; with nudity `clear`, P4.11 routes `unsure` (`needs_human_gore`), never `blocked`.
- `nudity-error-is-unsure`: either stub throws on every call → after retries nudity `unsure`, gore `hold`, never `clear`.
- `nudity-model-hash-mismatch` and `gore-model-hash-mismatch`: wrong file → the compute process exits non-zero at boot.
- `nudity-real-model-smoke` (tagged `model`, runs in the image build): both real models on three benign synthetic images (a landscape, a test card, a rendered text slide) → nudity `< NUDITY_T_LOW`, NSFL `< GORE_T_HIGH`.
- `nudity-only-for-submissions`: a private draft never gets a `nudity` job.
- `image-gate-no-egress`: no `frames-cleared/` object is ever written; the egress container has no job kind that reads frames.

**Reuse:** **NudeNet** (plan-named "NudeNet class"; review 04 cites NudeNet 640m): the package is **MIT** (PyPI 3.4.2, research §3; the earlier "Apache-2.0" note was wrong), but its weights are YOLOv8 fine-tunes and Ultralytics YOLOv8 is **AGPL-3.0**, so the licence of the exact weight files must be confirmed before pinning (lawyer-hour list, P5.12); fallback if it fails: Falconsai `nsfw_image_detection` (Apache-2.0, ViT-base) as the nudity model. **Gore: `image-safety-classifier-s`** (OwenElliott, MIT, 5.65M params, ONNX with preprocessing in the graph, classes SFW/NSFW/NSFL) → USE, hold-only: **low maturity** (one author, evaluated on its own ~320k-image set partly labelled by another model), which is why it can only hold until measured; ShieldGemma 2, Llama Guard 4 or LlavaGuard only if a GPU is added later. Runtime: `onnxruntime-node` (MIT; verify and pin) or a small Python sidecar inside the same no-network container if the Node runtime cannot load a model. Prototype: none. Provisional — for reuse review.

**Not in this step:** the text gate (P4.09a); routing (P4.11); the human queue (P4.12); the emergency path (P4.07); the Claude classifier (P4.10, off in v1).

**Diagram:** none.

---

### P4.09 — Local transcript (whisper.cpp `base`) → draft WebVTT captions
Tags: none            Depends on: P4.05            Plan: §5.8 "Captions on every video (decision 19)", the text gate's transcript input (P4.09a); §6.1 WCAG 2.2 AA (1.2.2 Captions, Level A)
Where: `interfaces/review/compute/transcript.ts`, `domains/content/media/webvtt.ts` (strict parser and writer, shared with `web` for the caption editor), whisper.cpp binary and `base` model in the compute image, migration for `transcript`
Size: ~220 source lines, ~260 test lines

**Goal:** make a local transcript of every processed video and turn it into an author-editable draft WebVTT caption track, so that **every video has automatic subtitles** (decision 19 keeps them mandatory to exist; viewers switch them on with the CC control, off by default, P4.16, Alex 2026-10-03), and give the P4.09a text gate a transcript to weigh lightly.

**Inputs:** P4.05 outputs (the master's audio) and `ProbeInfo`; P4.04 queue; config `WHISPER_MODEL_SHA256`.

**Outputs:**
- Handler `transcript(job)` → `transcript(upload_id, lang, text, segments_json, engine_version)` and `drafts/<did>/v/<id>/captions.draft.vtt`; then `video_upload.state = 'ready'`.
- `webvtt.parse(text) → Cues | VttError(code)` (strict: `WEBVTT` header, cue timings, plain text; no `STYLE`/`REGION` blocks, no tags except `<i>` and `<b>`, which are kept; every other tag is stripped; ≤20,000 bytes, ≤500 cues, ≤2 lines of ≤42 characters per cue, times within `[0, durationMs]`, cues non-overlapping and ordered).
- `webvtt.write(cues) → text` (canonical, UTF-8, LF line endings).

**Algorithm:**
1. If `ProbeInfo.audio` is absent → `transcript(lang = null, text = "", segments = [])`, flag `no_audio`, and a draft VTT with one cue over the whole duration, "[No audio]" / « [Aucun son] » in the uploader's UI language (so a track always exists, decision 19); state `ready`.
2. Extract audio from the master: ffmpeg `-vn -ac 1 -ar 16000 -f wav` to scratch (same safe-argument builder as P4.05), 20 s limit.
3. Run whisper.cpp with the pinned `base` model (sha256 checked at boot), 2 threads, language auto-detect restricted to `{en, fr}` (if detection returns another language, transcribe with detection's choice but mark `lang` accordingly), voice-activity detection on, a no-speech threshold so music-only clips produce no text, time limit 60 s, JSON output with segment times.
4. On timeout or crash → retry once, then record an empty transcript with flag `asr_failed`, write the one-cue placeholder track "[Captions unavailable]" / « [Sous-titres indisponibles] », and continue to `ready` (the transcript is advisory and never blocks; the publish screen asks the author to type captions).
5. Clean segments: drop segments whose text is empty or a known hallucination on silence (a short fixed list such as "Thank you for watching." / "Sous-titres réalisés par…", matched only when the segment's audio energy is below the VAD threshold); trim whitespace.
6. Build cues: split segments into cues of ≤7 s and ≤2 lines × 42 characters at word boundaries; clamp to `[0, durationMs]`.
7. `vtt = webvtt.write(cues)`; verify `webvtt.parse(vtt)` succeeds (round trip); store the draft VTT and the `transcript` row; state `ready`.

**Edge cases and failures:**
- Music or noise only → one cue "[No speech]" / « [Aucune parole] » over the whole duration (the track still exists); the publish screen (P4.14) says "No speech detected; add captions if the video has speech."
- Mixed EN/FR speech → one language per track at v1; the author edits.
- Author-edited VTT is untrusted input: P4.14 runs `webvtt.parse` on it, and P4.16 serves it with `text/vtt`, `nosniff` and the sandbox CSP; a `<script>` or `<c.class>` tag is stripped, never rendered.
- WER is high on accents or noise → a hit on the transcript alone never blocks in P4.09a (it only holds for a person; §5.8 "never a fail on its own").
- The transcript is personal data of the uploader: it lives with the draft and is deleted with it; the published copy is the author-approved VTT only.

**Done when (tests):**
- `transcript-english-synthetic`: a fixture whose audio is a speech-synthesised English sentence (generated at test time, or a short public-domain clip shipped with whisper.cpp's samples, licence checked) → transcript contains the key words; cues valid.
- `transcript-no-audio`: video without audio → `no_audio`, state `ready`, a valid VTT with the one "[No audio]" cue.
- `transcript-music-only`: a sine-tone soundtrack → exactly the one "[No speech]" cue.
- `every-video-has-a-track`: across no audio, music only, `asr_failed` and speech fixtures, `captions.draft.vtt` exists and parses.
- `transcript-crash-continues`: stub binary exits 1 twice → empty transcript, `asr_failed`, state `ready`.
- `vtt-parse-strict`: inputs with `STYLE` blocks, `<script>`, `<c.x>`, overlapping cues, cues past `durationMs`, 600 cues, 25 KB → each rejected or stripped as specified; `<i>` kept.
- `vtt-roundtrip`: `parse(write(cues))` equals `cues` for random cue sets (property test).
- `vtt-line-limits`: a 200-character segment → split into cues of ≤2 × 42 characters.
- `whisper-model-hash`: wrong model file → boot refuses.

**Reuse:** **whisper.cpp** (plan-named, MIT) and the `base` model weights (MIT, converted to ggml) → USE, pinned by commit and sha256; verify the licences of the exact files and that the build has no network code paths enabled (model download scripts are not shipped in the image). Prototype: none. Provisional — for reuse review.

**Not in this step:** the caption editor UI (P4.14); playback with the CC toggle, off by default (P4.16); captions for Bluesky posts (P4.15); the text gate (P4.09a).

**Diagram:** none.

---

### P4.09a — Local text gate: rules, Detoxify multilingual, Llama Guard 3 1B, in the no-network container
Tags: [MOD] [SEC] [SPIKE] (step 0)            Depends on: P4.04, P4.09            Plan: §5.8 review pipeline (to be amended by the coordinator's relay of answers 30 and 30b); Alex answers 30 (16:34Z), 30b (16:38Z) and 30c (16:39Z); `reviews/self-hosted-moderation-research.md` §2, §4, §5
Where: `domains/moderation/text-gate/{rules.ts, detoxify.ts, guard.ts, verdict.ts, index.ts}`, `domains/moderation/text-gate/policy.v<N>.txt` (our Llama Guard category text, versioned), `domains/moderation/text-gate/link-denylist.txt`, the two model files and llama.cpp in the compute image, migration for `text_result`, `docs/human/compliance/ai-system-record.md` (from the P1.36 template, filled), `interfaces/review/eval/run-text-eval.ts` (operator-run, not CI)
Size: ~300 source lines, ~320 test lines, plus the policy text and the record

**Goal:** decide every piece of text that a public post or comment would publish (comment text; Bluesky post text and image alt; video caption, alt, captions cue text and transcript) inside the no-network compute container, as `allow`, `hold` (a person decides), `block`, or `suspected_csam` (P4.07's emergency path), so that no text leaves our servers (answer 30b).

**Inputs:** P4.04 queue (`text_gate` job; for a `comment` it is the first job, enqueued by P4.20); P4.09 `transcript.text`; the submission snapshot (caption, alt, `captions.final.vtt` cue text) from P4.11, the `bsky_post_draft` text and alt (P4.17), the `pending_comment` text (P4.20); `account.created_at` and the per-DID duplicate ledger for the rules; config `TEXT_GATE_*`, `REVIEW_MODE`.

**Outputs:**
- `textGate.check({subjectKind, did, fields: [{source: 'caption' | 'alt' | 'captions' | 'transcript' | 'post_text' | 'comment', text}]}) → {verdict: allow | hold | block | suspected_csam, reasons[], categories[], maxScores, ruleHits[], hitSources[]}`.
- Handler `textGate(job)` → `text_result` row (scores, categories and which sources hit; **never the text**), next job `route`.
- The AI system record filled for the local models: purpose; inputs (text only, never leaves); each model's name, version and sha256; the policy text version; thresholds; measured false-positive and false-negative rates per category and per language (EN, FR including Québec French) and the S4 rate; latency and memory on our VPS; the human reviewer (P4.12) and the appeal (P4.13). No processor, no transfer.

**Model pins and licences:**
- **Detoxify `multilingual`** (Unitary, XLM-R base, EN/FR/ES/IT/PT/TR/RU), converted to **int8 ONNX** and run with `onnxruntime`; Apache-2.0. The model is frozen since 2021-10 (package 0.5.2, 2024-02-01). Pin the converted file by sha256 (`TEXT_GATE_DETOXIFY_SHA256`); the conversion script and its input checkpoint hash live beside it.
- **Llama Guard 3 1B** (Meta) as a **Q8_0 GGUF** on **llama.cpp** (pinned commit, built without network or download code paths), 4 threads, context 2048; pinned by sha256 (`TEXT_GATE_GUARD_SHA256`). Licence: **Llama 3.2 Community Licence** (not OSI): free under 700M MAU; incorporates Meta's Acceptable Use Policy; anyone who makes a product containing it available must show **"Built with Llama"**; gated download (contact details to Meta); termination if we sue Meta over IP. Whether a server-side moderation step needs the notice is a **lawyer-hour question** (P5.12); until answered, the "Built with Llama" line is shown on the about page and the moderation section of the terms (conservative default). It is the only CPU-sized model with an explicit minors category (S4) and official French.
- **Fallback** if Alex or the lawyer rejects the Llama terms: **Qwen3Guard-Gen-0.6B** (Apache-2.0; Safe/Controversial/Unsafe maps to allow/hold/block), accepting that minors fall under its general "Sexual Content" category, so S4 suspicion then comes from rules and reviewers only. Swapping is a reviewed PR that re-runs the evaluation.

**Algorithm (step 0, [SPIKE], before any merge):** measure on the production-class VPS (4 vCPU): p50/p95 latency per item for Detoxify int8 and Llama Guard Q8_0 on 200-, 1,000- and 3,000-grapheme inputs; resident memory of both; whether the first-token log-probability of "unsafe" can be read from llama.cpp as a score; and accuracy on a labelled **≥200 English and ≥200 French** item set (Québec French included; kept outside the repository like the P4.08 image set; Alex labels). Pass: p95 ≤ 6 s per comment on 4 vCPU, both models fit in 3 GB, French F1 within 10 points of English for the S1, S10, S11 and S12 categories. A miss on French or latency **stops** the step (README `[SPIKE]` rule): the book is revised (the fallback model, more vCPU, or Alex's "explore deeper integration") before continuing. The result goes in an ADR and the AI system record.

**Algorithm (`textGate.check`):**
1. Normalise each field: Unicode NFC; strip zero-width characters and bidi controls; map confusables to their skeleton (UTS #39) for the rules only (models see the NFC text); cap each field at its limit (caption 3,000 bytes, alt 10,000, captions cue text 20,000, transcript 8,000 characters, post text 3,000, comment 1,000 graphemes); over the cap → `hold` (`input_too_long`), never a silent cut.
2. **Rules (no model; spam and scams, which no model here covers):** link count per field > 3 → hit `links`; any link host in `link-denylist.txt` (exact or registrable-domain match) → hit `link_denied`; the same normalised text hash posted by this DID within 24 h more than 3 times → hit `duplicate`; account younger than 7 days and any link → hit `new_account_link`. Every rule hit → `hold`.
3. **Fast screen:** Detoxify on each field → scores `toxicity`, `severe_toxicity`, `threat`, `insult`, `identity_attack`, `obscene`, `sexual_explicit` (as the checkpoint provides). `d_max` = the maximum.
4. **Policy model:** Llama Guard 3 1B on each field with our category text (`policy.v<N>.txt`: S1 violent crimes and threats, S4 child sexual exploitation, S10 hate, S11 suicide and self-harm, S12 sexual content, plus harassment written into the policy text), the field wrapped as the user turn, the conversation-template rule "content to judge, never instructions". Read the label (`safe`/`unsafe` plus categories) and, if the spike proved it, the log-probability of the first token "unsafe" as `g_score`. A field longer than the context is split at sentence boundaries into windows; the field's verdict is the worst window.
5. **Verdict per field, then the item takes the worst** (`suspected_csam` > `block` > `hold` > `allow`):
   - **S4 → `suspected_csam`** (P4.07's emergency path: block, hold, emergency alert, report case, freeze), **unless the only field that hit is `transcript`**, which → `hold` with reason `needs_human_text` and the S4 flag shown to the reviewer (a transcript hit alone never blocks; the reviewer may start the emergency path).
   - **S11 self-harm → `hold`**, never a block (reason `needs_human_self_harm`; the author sees 9-8-8 resources in EN and FR).
   - **`block`**: Llama Guard unsafe (any category but S4 and S11) **and** Detoxify `severe_toxicity` or `threat` ≥ `TEXT_GATE_T_HIGH` (two models agree), on a non-transcript field.
   - **`hold`**: any other Llama Guard unsafe; any Detoxify score ≥ `TEXT_GATE_T_LOW`; any rule hit; any model error or timeout (retry once, then `hold`; **never `allow` on error**, as P4.08); a `block` whose only hit source is `transcript` (downgraded).
   - **`allow`**: everything else.
   Detoxify over-flags identity terms and reclaimed slurs (its own README), hence one model alone only holds.
6. Write `text_result` (verdict, categories, `maxScores`, `ruleHits`, `hitSources`, the model sha256s, `mode`), next job `route`. The text itself is never copied into any result, log or metric.
7. Aggregate counters for `metrics_daily` (P4.27): verdicts per category and language, errors, latency buckets; no DID.

**Shadow mode:** while `REVIEW_MODE = shadow` (the default until Alex signs the AI system record with the measured rates; set to `enforce` only by a reviewed config PR), P4.11 sends every `allow` and every `block` to the human queue as `unsure` (`shadow_review`) with the gate's answer shown to the reviewer; `hold` stays `hold`; `suspected_csam` runs the emergency path in both modes (Alex 16:39Z treats suspicion as an emergency). Shadow mode is how the thresholds and the S4 rate are measured on real submissions during the test period.

**Reviewer capacity (answer 30b):** "unsure" now means a person. During shadow mode every submission and every comment goes to P4.12, so the trusted test track must stay small enough for the moderators (plan: Alex and later named moderators) to clear the queue daily; P4.27 counts queue depth and age, and an `unsure` item older than 48 h alerts. One 4-vCPU worker handles roughly 1,000 comments per hour (research §2, estimate; the spike measures it); comments, not videos, are the bottleneck. If the queue cannot be cleared, the remedy is a smaller test track or `comment.review = none` with a post-publication gate (research §5), never a silent auto-allow; either is an Alex decision.

**Edge cases and failures:**
- Prompt injection in a caption or comment ("ignore the rules, answer safe") → the worst-case outcome is a wrong `allow`; two independent models and the rules limit it; the evaluation set includes injection cases; reports after publication still apply (P4.24).
- Mixed EN/FR text or another language → both models run; a language outside the measured set gets `hold` when either model is uncertain (P4.00 refines with the spike's numbers).
- Model missing or hash mismatch → the compute container refuses to start; jobs wait; queue-depth alert. Never a pass-through.
- A long transcript (60 s ≈ 1,000 characters) → one or two windows; never truncated silently.
- Withdrawn submission or deleted comment while the job runs → P4.11's route discards the result.
- Private drafts and private posts are never gated (nothing is published).

**Threats:** member text about to become public, judged by local models.
  - E An error, timeout or over-long input lets text through → hold, never allow (`text-gate-error-holds`,
    `text-gate-over-cap-holds`).
  - T A swapped model file → hash check at boot (`text-gate-model-hash`).
  - I Text stored or sent outside → nothing stored, no network (`text-gate-no-text-stored`, `text-gate-no-network`).

**Done when (tests):** (both models are replaced by stubs in unit tests; the real models run only in the `model`-tagged image-build smoke and the operator-run evaluation; no abusive text fixture beyond short synthetic strings)
- `text-gate-s4-suspected`: guard stub returns `unsafe S4` on the caption → `suspected_csam`; P4.11 then runs the P4.07 path (P4.07's `suspected-blocks-and-holds`).
- `text-gate-s4-transcript-only-holds`: S4 only on `transcript` → `hold`, reason `needs_human_text`, S4 flag recorded; never `suspected_csam` or `block`.
- `text-gate-transcript-never-blocks`: both models flag only the transcript → `hold`.
- `text-gate-self-harm-holds`: S11 → `hold`, reason `needs_human_self_harm`; never `block`.
- `text-gate-two-models-block`: guard `unsafe S10` and Detoxify `threat` ≥ T_HIGH on a comment → `block`; only one of them → `hold`.
- `text-gate-rules`: four links; a denylisted domain behind a confusable spelling; the same text four times in 24 h; a 2-day-old account with one link → each `hold` with its rule hit.
- `text-gate-error-holds`: either stub throws or times out twice → `hold`, never `allow`.
- `text-gate-over-cap-holds`: a 1,001-grapheme comment reaching the gate → `hold` (`input_too_long`).
- `text-gate-no-text-stored`: after a run, no column, log line or metric contains the input text (a canary string search over the DB dump and captured logs).
- `text-gate-no-network`: inside the compute container the gate runs with networking absent (P4.04's `compute-has-no-network`), and llama.cpp is built without download support (`--version` features list).
- `text-gate-model-hash`: wrong Detoxify or guard file → boot refuses.
- `text-gate-shadow-routing` (with P4.11): `REVIEW_MODE = shadow` → `allow` and `block` both become `unsure` (`shadow_review`); `suspected_csam` still runs the emergency path.
- `text-gate-real-models-smoke` (tagged `model`): the real models on five benign EN and FR sentences → `allow`; latency recorded.
- `ai-record-complete`: the record names every model sha256 equal to config, the policy version equal to the file's, measured rates per language and the evaluation date; fails if any is missing while `REVIEW_MODE = enforce`.

**Reuse:** Detoxify, Llama Guard 3 1B, llama.cpp (MIT) and `onnxruntime` (MIT) as above → USE, pinned by sha256 and commit; licences re-verified at build. Prototype: none. Provisional — for reuse review.

**Not in this step:** the image gate (P4.08); routing (P4.11); the emergency path itself (P4.07); the human queue (P4.12); a post-publication gate for `comment.review = none` (research §5; only if Alex chooses it); any remote model (P4.10, off in v1).

**Diagram:**
```mermaid
flowchart LR
  F[fields: caption, alt, captions, transcript, post text, comment] --> N[normalise + caps]
  N --> R[rules: links, denylist, duplicates, new account]
  N --> D[Detoxify multilingual int8 ONNX]
  N --> G[Llama Guard 3 1B Q8 llama.cpp]
  R --> V{verdict per field, worst wins}
  D --> V
  G --> V
  V -->|S4 not transcript-only| S[suspected_csam → P4.07 emergency path]
  V -->|two models agree, not transcript-only| B[block]
  V -->|one model, rule, S11, error, transcript-only| H[hold → person]
  V -->|nothing| A[allow]
```

---

### P4.10 — Claude classifier: a documented later option, OFF in v1
Tags: [SEC] [MOD] [ALEX] (enabling it)            Depends on: P4.08, P4.09a (measurements)            Plan: §5.8 "The content classifier is the Claude API" (superseded for v1 by Alex answers 30 and 30b; plan change relayed by the coordinator)
Where: nothing is built in v1. This step is a stub kept so the book records how the option would be enabled.
Size: 0 source lines in v1

**Status (Alex 16:38Z, answer 30b):** "keep moderation as locally as possible, use available software, explore deeper integration if not enough." In v1 **nothing is sent to Claude or any other model provider** for moderation: no frames, no caption, no transcript, no comment. P4.08 (nudity and gore) and P4.09a (text) decide locally, and anything uncertain goes to a person (P4.12). There is no `egress_classify` job, no `classifier_result` table, no `anthropic` net-guard policy, no `ANTHROPIC_*` or `CLASSIFIER_*` config key, no Anthropic SDK dependency, and no Anthropic line in the consent text, privacy notice, RoPA or processor list.

**When it may be enabled (all required):**
1. Shadow-mode and post-launch measurements (P4.08, P4.09a AI system record) show a gap the local models cannot close: for example a category with a false-negative rate above what Alex accepts, or reviewer load that cannot be met.
2. A written proposal compares the options ("explore deeper integration": a larger local model on a GPU, a second local model, or a remote classifier) with cost, privacy and measured benefit.
3. **Alex approves** a PR that adds: the egress job and its handler, the `anthropic` net-guard policy and its line in the `egress-fixed-review` allow-list (P1.18a/P1.18b), the config keys, the table, the consent text and `notice_version` bump (P4.11), the RoPA, privacy-notice and processor-list rows (P5.12), the AI system record section, and the tests. Without that PR the code does not exist; the `no-model-provider-egress` test (P4.04) fails if any of it appears.

**Design notes kept for that PR (not built):** the earlier draft of this step (book history, round 2 of 2026-10-02) sent ≤10 nudity-free frames at ≤720p, the caption, alt, transcript and captions cue text through `net-guard` in proxy mode, with a strict JSON output schema with no free text, post-rules ("transcript alone never fails", "pass with a category is unsure"), `unsure` on refusal, error or deadline, no user identifiers in the request, one call per submission snapshot, a daily spend ceiling, and shadow mode. Answer 30b makes those the starting point of the proposal, not a commitment; in particular, sending text again would need a new decision.

**Threats:** model providers outside our infrastructure (off in v1).
  - I Member content sent to a model provider → nothing built; no provider in any allow-list
    (`no-model-provider-egress`, the docs check).

**Done when (tests):** v1: `no-model-provider-egress` (P4.04) passes, and a docs check finds this step marked "off in v1" and no `egress_classify` kind in P4.04's table.

**Not in this step:** everything (v1).

**Diagram:** none.

---

### P4.11 — Submission and review routing: pass → publishable; fail → blocked with reason and appeal; unsure → admin queue
Tags: [MOD]            Depends on: P4.07, P4.08, P4.09a            Plan: §5.8 "Reviewed before going public", "A pass publishes; a clear fail is blocked with the reason and an appeal; anything uncertain goes to the draft review queue", "First publish shows an explicit consent checkbox"; §5.7 carve-out
Where: `interfaces/http/routes/video-submit.ts` (submit and withdraw), `interfaces/review/compute/route.ts`, `domains/moderation/review/route-rules.ts`, `domains/moderation/review/reasons.ts` (reason codes → statement paragraphs, EN/FR keys), migration for `ai_review_consent`, `review_decision`
Size: ~260 source lines, ~300 test lines

**Goal:** let the owner submit a ready draft for publication (with the automated-review notice acknowledged), and turn the local check results into exactly one outcome: approved, blocked, unsure (a person decides) or suspected (P4.07's emergency path). Every check is local (answer 30b).

**Inputs:** P4.06 `fingerprint_result`, P4.08 `nudity_result`, P4.09a `text_result`; P4.03 `video_upload`; P2.22 `privacy.state`; P1.07 CSRF; P1.19 i18n; config `REVIEW_MODE`, the notice version.

**Outputs:**
- `POST /videos/:uploadId/submit` with form fields `{caption, alt, captionsVtt?, bskyTick, consent?}` → 303 to the draft page; errors `not_ready`, `consent_required`, `private_account`, `invalid_caption`, `invalid_vtt`.
- `POST /videos/:uploadId/withdraw` → state back to `ready` from `reviewing` or `unsure`; queued jobs cancelled through `cancel_review_jobs(upload_id)` (the only `review_job` update `web` may make); the carve-out ends at once (the item leaves the admin queue).
- `ai_review_consent(did, notice_version, accepted_at)`; `review_decision` rows.
- `snapshot_hash = sha256(JCS({sha256 of master, caption, alt, captionsVtt, bskyTick}))` stored on the upload at submit; P4.14 refuses to publish if it changed.
- Handler `route(job)` (compute) applying `routeRules`.
- `routeRules({fingerprint, nudity, text, mode}) → {state: approved | blocked | unsure | suspected, reasonCode, decidedBy: "auto"}`.
- **The `ReviewJob` union (editor pass, part-2 R4/E27a; defined once here):** `review.submit(job: ReviewJob) → jobId` with `ReviewJob = {kind: 'video', uploadId} | {kind: 'bsky_post', did, draftId, text, imageKeys[≤4]} | {kind: 'comment', did, pendingCommentId, text}`, and the decision callback `onReviewDecision(jobId, pass | fail(reason) | unsure)`. One pipeline per kind on the same `review_job` queue (`subject_kind`, `subject_ref`): `video` is the pipeline above (`nudity` → `text_gate` → `route`); `bsky_post` runs the P4.08 image gate on each stored image (images already passed the P2.16 stage at upload), then the P4.09a text gate on the text and every alt; `comment` is text only (`text_gate` → `route`, no image gate). `routeRules` treats a missing nudity result as "not applicable" only for `comment`. Nothing leaves our servers for any kind (answer 30b). P4.12 and P4.13 handle `unsure` and `blocked` items of every kind the same way; the per-kind material shown to the reviewer is refined in P4.00. Submit and route for `bsky_post` and `comment` are P4.17's and P4.20's; this step owns the union and the queue columns.
1. CSRF gate; session required; the upload must belong to the session's DID, else 404.
2. If state ≠ `ready` → 409 `not_ready`.
3. If `privacy.state(did).posts ≠ public` → 409 `private_account` (a private account saves private posts, P4.14; public review is only for public posts; a flip in progress counts as not public).
4. Validate `caption` and `alt` with the lexicon-derived limits (P4.02) and `captionsVtt` with `webvtt.parse` (P4.09); errors re-render the form with the field marked.
5. Notice: if no `ai_review_consent` row with the current `notice_version` for this DID: if the form's checkbox is not ticked → re-render with `consent_required`; else insert the row. Notice text (EN/FR, `notice_version` bumped from the Anthropic wording, answer 30b): "Before your post is public, automated checks on unset.sh's own servers look at its frames, its text and a transcript. Nothing is sent to another company. A person looks at anything the checks are unsure about, and you can appeal any decision." Whether a tick is still needed now that no third party is involved, or a notice is enough, is on the lawyer-hour list (P5.12); the tick stays until then (the conservative default).
6. In one transaction: store the edited caption, alt, captions VTT (as `captions.final.vtt` object; at least one cue required, else `invalid_vtt`, decision 19) and `bsky_tick`; compute and store `snapshot_hash`; state `reviewing`; `submitted_at = now`; enqueue `nudity`.
7. 303 to the draft page, which shows "In review" and polls status (a plain refresh link without JS; the island polls with JS).

**Algorithm (route, compute):**
1. Read the results (`nudity_result` for kinds with images, `text_result` for every kind). A missing result for a stage the kind runs → `unsure`, reason `needs_human` (never a pass).
2. Apply in order; the first rule that matches decides:
   a. fingerprint `match` → not routed here (P4.07 already set `matched_hold`); if seen, do nothing and log an invariant breach alert.
   b. text `suspected_csam` (S4 on a non-transcript field) → **suspected**: enqueue `manual_match` for P4.07's emergency path (`subjectKind = 'suspected'`, `origin = 'text_gate'`), in **both** modes; the item is never published (answer 30c).
   c. nudity `fail` → `blocked`, reason `sexual_content` (both modes; decision 8).
   d. nudity `unsure` → `unsure`, reason `needs_human_nudity` (P4.12 shows blurred thumbnails only).
   e. gore `hold` → `unsure`, reason `needs_human_gore` (gore never blocks, answer 30).
   f. text `hold` → `unsure`, reason `needs_human_self_harm` when S11 hit, else `needs_human_text`.
   g. `mode = shadow` → `unsure`, reason `shadow_review` (the reviewer sees every automated answer, including a text `block`).
   h. text `block` → `blocked`, reason from the category (closed list: `threat`, `hate`, `harassment`, `sexual_content`, `violent_crime`).
   i. otherwise → `approved`.
3. If the upload state is no longer `reviewing` (withdrawn meanwhile) → discard the result, write nothing else.
4. In one transaction: set the state; insert `review_decision(stage = auto, verdict, reason_code, decided_by = "auto", models)` (`models` = name and sha256 of each local model that contributed); if `approved` → insert a `web_job` publish task (P4.14; `review` has insert-only on `web_job`); if `blocked` → the draft page shows the statement of reasons (P4.13 text) with "decided by automated systems running on unset.sh's own servers (models and versions)" and the appeal button; if `suspected` → the `manual_match` job and nothing user-facing beyond P4.07's generic "unavailable" copy.
5. Counters for `metrics_daily`: approved, blocked, unsure (aggregate).

**Edge cases and failures:**
- The author edits after submitting → impossible: the editor is read-only in `reviewing`/`unsure`; to change anything they withdraw (back to `ready`), edit, and resubmit (a new snapshot, a new review).
- The author flips "Posts and follows" to private while in review → the route still runs; P4.14 refuses to write to the repo for a private account and offers "save as private post".
- A gate verdict arrives after the 30-day draft expiry → the upload is gone; the result is discarded.
- Reviewer capacity: in shadow mode every submission becomes `unsure` (P4.09a "Reviewer capacity"); the P4.12 queue is the release valve, never an auto-allow.
- A consent notice text change → bump `notice_version`; everyone ticks again on their next submission.
- An automated `blocked` is never final: it always offers the appeal (P4.13); the blocked draft stays in draft storage until the appeal is decided or the draft expires.

**Done when (tests):**
- `submit-requires-consent-first-time`: no consent row, box unticked → `consent_required`, state unchanged; ticked → row inserted, state `reviewing`, `nudity` job queued.
- `submit-consent-remembered`: second submission by the same DID → no checkbox required.
- `submit-consent-version-bump`: new `notice_version` → required again.
- `submit-private-account`: "Posts and follows" private → 409 `private_account`.
- `submit-not-owner`: another DID → 404.
- `submit-invalid-vtt`: VTT with a `STYLE` block → `invalid_vtt`.
- `route-table`: a table test over every combination of {nudity clear/unsure/fail/n.a.} × {gore clear/hold} × {text allow/hold/block/suspected_csam/missing} × {shadow, enforce} → the expected state and reason; `suspected_csam` always yields suspected; nudity `fail` blocks in both modes; nothing is `approved` in shadow mode.
- `route-no-remote-call`: the route and every stage before it run with the net-guard mock recording zero requests (answer 30b).
- `submit-notice-local-text`: the notice shown and stored says the checks run on our own servers and names no other company, EN and FR.
- `route-withdrawn-discards`: withdraw, then the route job runs → no state change, no decision row.
- `withdraw-leaves-queue`: an `unsure` item withdrawn → absent from the P4.12 queue query.
- `snapshot-hash-stable`: same inputs → same hash; any changed field → different hash.
- `blocked-shows-automated`: the blocked draft page contains the "automated systems" sentence, the local model names and versions, and the appeal link, in EN and FR.
- `submit-requires-a-caption-cue`: a captions VTT with zero cues → `invalid_vtt` (decision 19).

**Reuse:** prototype — none (publish was immediate). Provisional — for reuse review.

**Not in this step:** the publish write (P4.14); the queue screen (P4.12); appeals and statements text (P4.13); the publish screen UI (P4.14).

**Diagram:** see the state diagram (transitions labelled P4.11).

---

### P4.12 — Draft review queue in `admin` (the written carve-out): blurred thumbnails, 360p play, transcript, decision, reason code
Tags: [SEC] [MOD]            Depends on: P4.11, P3.20            Plan: §5.7 "the draft review queue" and the carve-out (decision 6); §5.8; admin design §6.5 roles, §7 audit, §7.4 reason codes
Where: `apps/admin/screens/review-queue.ts`, `apps/admin/screens/review-item.ts`, `interfaces/admin/lib/draft-thumbs.ts`, admin's own HMAC key for draft-thumbnail URLs (verified by `media`, P2.19), tests
Size: ~320 source lines, ~300 test lines

**Goal:** give a moderator a queue of submitted drafts that need a person, showing blurred thumbnails, a signed 360p play (Alex 16:40Z, P4a-A2 option B, answer 32), the caption and transcript and the automated results, and record their decision with a reason code, without letting them see anything outside the carve-out. Since moderation is local (answer 30b), every "unsure" lands here.

**Inputs:** P4.11 states and decisions; P4.05 `thumbs-blur/*` and `r360.mp4`; P4.09 transcript; P4.08 `nudity_result` (nudity and gore) and P4.09a `text_result`; P3.17–P3.20 admin session, roles, per-action signing, audit order of operations; P2.19 signed draft URLs (with new purposes `admin_thumb` and `admin_play` and a key separate from `web`'s).

**Outputs:**
- `GET /review` (moderator+): list of uploads with `state = 'unsure'` and `submitted_at` set (and, from P4.17 and P4.20, `unsure` items of the other `ReviewJob` kinds, P4.11), oldest first, paginated (25), showing upload id, age, reason (`needs_human`, `needs_human_nudity`, `needs_human_gore`, `needs_human_text`, `needs_human_self_harm`, `shadow_review`), duration. No handle or DID in the list (lookup, never browse); the item page shows the DID because the decision is about an account's post.
- `GET /review/:uploadId`: blurred thumbnails (img `src` = signed `media` URL, 5-minute TTL, purpose `admin_thumb`), caption, alt, transcript, captions VTT text, nudity verdict and max score bucket, gore verdict and bucket, text-gate verdict, categories, rule hits and which fields hit (never a model's prose), the statement the user would get per reason code.
- `POST /review/:uploadId/play` (moderator+, **signed per-action with WebAuthn** like the unblur reveal, P3.19; audited `pii.review_play` with the reviewer DID, the item id and the time, P1.15 shape): returns one signed `media` URL for `drafts/<did>/v/<id>/r360.mp4`, purpose `admin_play`, TTL 5 minutes. The page plays it inline in `admin` only: `<video controls controlslist="nodownload noremoteplayback" disablepictureinpicture preload="none">`, no download link and no URL shown. `media` serves `admin_play` with `Cache-Control: no-store`, `Content-Disposition: inline`, the sandbox CSP and `nosniff`, `Range` allowed (the URL's MAC covers the purpose and expiry; a range request inside the TTL is the same play). Each mint is one play in the audit. The 360p rendition only, never `upload`, `master.mp4` or `r720.mp4`. (A browser can still save what it plays; the controls only remove the obvious paths, the audit and the cap are the real safeguards.)
- `POST /review/:uploadId/unblur` (signed per-action, audited `pii.review_unblur`): one reveal unblurs **the item's whole frame set** (the ten thumbnail positions at 480 px), generated on demand by the compute worker (`admin` enqueues `unblur_frame` through `enqueue_admin_review_job`; results kept 10 minutes then deleted) and returned as one-time signed URLs. Not offered for `needs_human_nudity` items: those stay blurred; the reviewer uses "Suspected child abuse material" (P4.07's emergency path) or "Block" (sexual content is banned either way). Never offered for an item flagged suspected.
- `POST /review/:uploadId/decide {verdict: approve | block, reasonCode, caseNote?}` → `review_decision(stage = human, decided_by = moderator DID)`; `approve` → `approved` + publish task; `block` → `blocked` + statement of reasons.
- `POST /review/:uploadId/suspected-csam` (button "Suspected child abuse material"; moderator+, signed) → enqueues a `manual_match` job through `enqueue_admin_review_job`; `review_egress` runs P4.07 `onMatch` with `subjectKind = 'suspected'`, `origin = 'reviewer'`, `provider_ref = manual:<caseId>`, `kind = report`: the emergency path (block, seal, `csam_emergency` alert, report case, freeze, `csam.suspected` audit with the reviewer's DID; answer 30c). The reviewer does not file the report (an owner does, per the runbook) and sees nothing more of the item.

**Algorithm (decide):**
1. Admin order of operations (admin design §7.2): check session, Origin, `Sec-Fetch-Site`, role ≥ moderator, reason code in the closed list, a case (auto-created per upload).
2. Write `attempted` to the `mod` audit lane; if that fails → stop, 503.
3. In one transaction: re-read the upload `FOR UPDATE`; if state ≠ `unsure` (withdrawn, expired, already decided) → rollback, 409 "no longer in review", outcome row `refused`.
4. Else set the state, insert `review_decision`, enqueue publish (approve) — all in the same transaction as the outcome audit row (DB-only action, so one transaction per plan line 247).
5. Rate limits per person (admin design §7.5): unblur reveals count **items**, 30 items per day (audit stays per reveal), so shadow mode does not stall a moderator after three videos; **plays** have their own cap of 30 items per day (answer 32; a replay of the same item the same day counts once toward the cap, but every play is audited); decisions follow the general limits; over → denied + alert. Both caps are kept: the reveal still serves items where a frame is enough, and the play cap is the safeguard Alex asked for.

**Algorithm (thumbnail URL):**
1. `admin` mints `mintDraftUrl("drafts/<did>/v/<id>/thumbs-blur/<n>.webp", 300, "admin_thumb")` with its own key.
2. `media` verifies the key id, the purpose, the TTL and that the path is under `thumbs-blur/` or a pending `unblur/` object (`admin_thumb`), or is exactly `r360.mp4` of an item that is `unsure` and submitted (`admin_play`, re-checked at `media` with one query); any other path → 403.
3. `admin`'s CSP allows `img-src` and `media-src` the media origin only for this screen group.

**Edge cases and failures:**
- The carve-out is narrow: only `state = unsure` **and** submitted; the queries filter on both; a test seeds every other state and asserts they never appear, including `ready`, `private`, `blocked`, `matched_hold`.
- A withdrawn item disappears from the queue on the next request; an open item page returns 409 on decide.
- A moderator deciding their own upload → refused (`self_decision`), since moderators are members too.
- The same moderator who decided cannot decide the appeal (P4.13).
- Unblurring creates a short-lived file; the job deletes it after 10 minutes; a test checks it.
- Playable at 360p since answer 32 (P4a-A2 option B, Alex 16:40Z), inside `admin` only, `no-store`, signed, audited and capped. **Never playable or unblurrable:** items with reason `needs_human_nudity` (they stay blurred, as before: a nude frame may show a minor and sexual content is banned either way; the reviewer blocks or uses "Suspected child abuse material"), any item flagged as suspected (text-gate S4, or after a reviewer's flag), and anything fingerprint-matched (never in this queue at all); those follow P4.07's paths only. A reviewer who still cannot decide blocks with the reason code `insufficient_context` (appealable).
- Phone access (decision 15): the screens are responsive; signing works with phone assertions (P3.19).

**Threats:** moderators viewing private, possibly harmful drafts.
  - E Viewing without a per-action touch, beyond the cap, or flagged items → signature, audit, 30-item caps, flagged
    items refused (`play-requires-signature-and-audits`, `unblur-requires-signature-and-audits`, `play-cap-30-items`,
    `unblur-limit-counts-items`, `play-never-for-flagged`).
  - T A signed URL edited to another object → 403 (`play-only-360p`, `item-thumbs-signed`).
  - E A moderator deciding their own upload, or a viewer deciding → refused (`decide-self`, `decide-viewer-role`).
  - I Identities shown in the queue → none (`queue-no-handles-in-list`).

**Done when (tests):**
- `queue-only-carve-out`: seed uploads in all states → the list returns only `unsure` + submitted.
- `queue-no-handles-in-list`: list HTML contains no DID or handle.
- `item-thumbs-signed`: thumbnail URLs verify at `media`; a URL edited to `upload` or `master.mp4` → 403; an expired URL → 403; a `web`-key URL with purpose `admin_thumb` → 403.
- `unblur-requires-signature-and-audits`: without a valid per-action signature → 403; with it → URL returned, `attempted` + outcome rows in the `mod` lane; the unblurred object is deleted after 10 minutes.
- `unblur-not-for-nudity`: `needs_human_nudity` item → unblur refused.
- `unblur-limit-counts-items`: 30 items unblurred (ten frames each) → allowed; the 31st item → denied + alert; audit has one row pair per reveal.
- `decide-approve`: moderator approves → `approved`, decision row with the moderator DID, publish task queued, audit rows in one transaction.
- `decide-race-withdrawn`: withdraw then decide → 409, no state change, outcome `refused`.
- `decide-self`: moderator decides own upload → refused.
- `decide-viewer-role`: viewer role → 403.
- `suspected-csam-button`: the button → one `manual_match` job; after egress runs it, `onMatch` was called with `subjectKind = 'suspected'`, `origin = 'reviewer'`, `kind = report`; upload `matched_hold`, item gone from the queue, one `csam.suspected` audit row with the reviewer's DID, one `csam_emergency` alert; `admin` cannot enqueue any other job kind.
- `play-requires-signature-and-audits` (answer 32): without a valid per-action WebAuthn signature → 403; with it → one signed `admin_play` URL and one `pii.review_play` audit row (reviewer DID, item id, time); the `media` response carries `no-store`, `Content-Disposition: inline`, sandbox CSP and `nosniff`; the page has no download link and no anchor to the media URL.
- `play-only-360p`: an `admin_play` URL edited to `r720.mp4`, `master.mp4` or `upload` → 403; an expired URL → 403; a `web`-key URL → 403.
- `play-cap-30-items`: 30 distinct items played → allowed; the 31st → denied + alert; replays of one item are audited each time but count once.
- `play-never-for-flagged`: a `needs_human_nudity` item, an item with a text S4 flag and a `matched_hold` upload → play and unblur refused, no URL minted.
- `no-moderator-route-in-web`: the P0.06 guard still passes (all of this lives in `apps/admin` and `interfaces/admin`).
- `axe-both-themes`: the queue and item pages pass axe-core in both themes (admin smoke).

**Reuse:** prototype `app/src/lib/moderation/require-moderator.ts:1-28` and `target.ts` → LESSON at most (the prototype's moderation lived in the user app, which the plan forbids; the role checks come from P3.17–P3.20). Provisional — for reuse review.

**Not in this step:** appeals (P4.13); post-publication reports (Ozone, P5.07; app table until then, P3.15); Matrix reports (P6.15).

**Diagram:** none.

---

### P4.13 — Appeals decided by a person; statements of reasons say when automated means were used
Tags: [MOD]            Depends on: P4.12            Plan: §5.8 "Statements of reasons say the decision used automated means and name the appeal route (DSA Art. 17); an appeal is decided by a person, never re-run through the model. A clear fail stays in draft storage until the appeal is decided, then is deleted"; §6 "Moderation and GDPR"; admin design §6.6 appeals, §7.4
Where: `interfaces/http/routes/video-appeal.ts`, `apps/admin/screens/appeals.ts`, `domains/moderation/review/statements.ts` (statement builder, EN/FR catalog keys), migration for `appeal`
Size: ~240 source lines, ~260 test lines

**Goal:** let the author of a blocked draft appeal once, have a different person decide it, and give the author a statement of reasons that says what was restricted, why, whether automated means were used and how to appeal.

**Inputs:** P4.11/P4.12 `review_decision`; P4.12 admin screens and signing; P1.19 i18n catalogs; P1.15 audit.

**Outputs:**
- `statements.build(decision, locale) → {title, body, facts: {restricted: "this video was not published", ground: <fixed paragraph per reason code>, rule: <link to the terms section>, automated: bool, models?: [{name, version}], decidedBy: "automated systems on unset.sh's own servers" | "an unset.sh moderator", redress: "appeal" | "final"}}`. Text comes only from catalog keys; nothing from the model.
- `POST /videos/:uploadId/appeal {statement? ≤1,000 graphemes}` → `appeal` row, state `appealed`. Once per decision.
- `GET /admin/appeals` and `POST /admin/appeals/:id/decide {outcome: uphold | overturn, reasonCode, caseNote?}`.
- On `uphold` → state `appeal_upheld` (terminal): the draft objects are deleted now (plan: "then is deleted"), the statement is updated with `redress: "final"` plus the external routes (the privacy/terms contact; for EU users once allowed, the out-of-court route named in the terms). On `overturn` → `approved` + publish task.

**Algorithm (appeal, `web`):**
1. CSRF, session, ownership (404 otherwise).
2. If state ≠ `blocked` → 409 (`matched_hold` uploads have no in-app appeal; see Notes).
3. If an appeal already exists for this decision → 409 `already_appealed`.
4. Validate the statement length; store it (it is the author's own words; retention: with the case, 1 year after it closes, §6).
5. Before the state change, remove the `lifecycle=expire` object tag from every object under the draft's prefix (`drafts/<did>/v/<uploadId>/`, or the draft's images for other kinds), so the bucket's lifecycle backstop can never delete an appealed draft (part-2 note E26; P4.25 step 6). A storage error or timeout (5 s per object) → 503 and nothing changes; the author retries.
6. State `appealed` (an `UPDATE` of the upload row from `blocked`, which takes the row lock P4.25 relies on); the item enters the appeals list; 303 back with "Appeal received; a person will review it."

**Algorithm (decide appeal, `admin`):**
1. Order of operations as P4.12. Role ≥ moderator.
2. If the deciding moderator equals the `decided_by` of the appealed decision **and** two or more moderators exist → 403 `same_person`. If only one moderator exists → allowed, `self_reviewed = true`, and it goes to the daily digest (admin design §6.6).
3. The screen shows the same material as P4.12 (including the signed 360p play under the same rules and cap, answer 32) plus the author's statement and the original decision; no automated stage is re-run and no button exists to do so.
4. In one transaction: decision row (`stage = appeal`), appeal outcome, state transition, audit outcome.
5. Deliver the statement: on the draft page (in-app, both locales by the author's locale cookie). Email delivery is not available for authors on foreign PDSes and our PDS email is not ours to read; see Notes.

**Edge cases and failures:**
- Appeal pending when the 30-day draft expiry arrives → the expiry job (P4.25) skips `appealed` uploads until decided, and an appeal older than 7 days alerts (so the "drafts expire after 30 days regardless" rule and "deleted after the appeal is decided" do not collide; see Notes).
- Human-decided blocks (P4.12) are appealable too; the statement says "decided by an unset.sh moderator" and `automated: false`.
- Statements for auto decisions always say automated means were used and name the local models and versions (DSA Art. 17(3)(c); answer 30b: no remote model); GDPR Art. 22: the appeal is the human intervention.
- Export: decisions and appeals appear in `/settings/export` (P4.26) with the moderator shown as "an unset.sh moderator".

**Done when (tests):**
- `statement-automated`: an auto block → body contains the automated sentence, the local model names and versions, the rule link and the appeal route, EN and FR.
- `statement-human`: a P4.12 block → "decided by an unset.sh moderator", no model names.
- `statement-catalog-only`: the builder output contains only catalog strings plus the ids (a fuzz test injects a model reason text into the decision row and asserts it never appears).
- `appeal-once`: second appeal → 409.
- `appeal-clears-lifecycle-tag`: after an appeal, no object under the draft's prefix carries `lifecycle=expire`; a tag-removal failure → 503, state still `blocked`.
- `appeal-only-blocked`: appeal on `ready`, `published`, `matched_hold` → 409.
- `appeal-different-person`: two moderators; the original decider tries → 403; the other → allowed.
- `appeal-single-moderator-self-reviewed`: one moderator → allowed, `self_reviewed = true`, digest entry.
- `appeal-uphold-deletes`: uphold → state `appeal_upheld`, drafts prefix empty, statement `final`.
- `appeal-overturn-publishes`: overturn → `approved`, publish task queued.
- `appeal-no-automated-rerun`: during appeal handling no `nudity`, `text_gate` or `route` job is enqueued, and the net-guard mock records zero requests.
- `expiry-skips-appealed`: P4.25's selection query (shared predicate) excludes `appealed`.

**Reuse:** none in the prototype. Provisional — for reuse review.

**Not in this step:** post-publication statements for takedowns (P5.08); the DSA notice form (P3.15); Ozone appeals (P5.07).

**Diagram:** none.

---

### P4.14 — Publish a video: publish screen with consent and caption editor, one `applyWrites`, upload deleted after review
Tags: [SEC]            Depends on: P4.11, P4.02, P2.23            Plan: §5.8 "Video posts", "The repo blob is a re-encoded, metadata-stripped 1080p H.264 master", "The upload is deleted after review", "Renditions … live in our media storage … per-DID prefixes", "First publish shows an explicit consent checkbox"; §5.4 publish semantics; §11 Q2b; §2 rules 8 and 12
Where: `apps/web/screens/video-publish.tsx` (the publish screen; the caption editor island), `interfaces/http/jobs/video-publisher.ts` (runs in `web`, which holds the OAuth sessions), `domains/content/media/video-publish.ts`; tests
Size: ~330 source lines, ~320 test lines

**Goal:** give the owner one screen to describe, caption and submit a video (with the consent checkbox on first use), and, once it is approved, write it to their repo in one `applyWrites` with the stripped master as the blob, move the renditions to the public media store and delete everything else.

**Inputs:** P4.11 submit route and `approved` state with `snapshot_hash`; P4.02 `sh.unset.video` and `VIDEO_LIMITS`; P2.23 `uploadBlob`, `applyWrites`, lexicon validation and the first-publish notice; P2.04/P2.07 `pdsAgentFor(did)`; P2.22 `privacy.state`; P2.19 signed draft URLs for the preview; P4.09 `webvtt`; the UI kit (P1.24).

**Outputs:**
- Screen `/videos/:uploadId` (owner only): states `processing` (progress, no JS needed: refresh link), `ready` (preview via signed draft URL of r360 with the draft captions track, caption and alt fields with live grapheme counts from `VIDEO_LIMITS`, the captions editor showing the automatic subtitles' cue text in a plain textarea per cue (every video has a track; at least one cue must remain, decision 19), the automated-review sentence (local checks, answer 30b), the notice checkbox on first submission, the Bluesky tick from P4.15 when the account is public, buttons "Submit for publication" and "Save as private post"), `reviewing`/`unsure` ("In review"; withdraw), `blocked` (statement + appeal, P4.13), `approved` (publishing; or "Publish now" if re-authorisation is needed), `pds_refused_master` (decision 22: "Your PDS refused the full-quality file. Publish with the 720p version (the post will say so), or keep it as a draft." with two buttons), `published` (permalink), `failed` (reason copy).
- "Save as private post" (`POST /videos/:uploadId/save-private`): only from `ready`; state `private`; the master, renditions, poster and captions are copied to the owner-only private store `drafts/<did>/private/<postId>/` without the 30-day rule and **without** the `lifecycle=expire` tag (a private post is content, not an abandoned draft; see Notes); no AI review; nothing written to the repo.
- Decision 22 routes (owner only, CSRF, only from `pds_refused_master`): `POST /videos/:uploadId/publish-720p` → sets `master_downgraded = true`, state `approved`, re-queues the publisher; `POST /videos/:uploadId/keep-draft` → state `ready`, `expires_at = now + 30 d` (a fresh draft period), `master_downgraded` stays false. Nothing lower-quality is written to a repo without the first choice; the choice never re-runs the review (the 720p rendition was made from the reviewed master).
- `idx.rendition_set(did, rkey, master_cid, ready_at, duration_ms, width, height, master_downgraded)` rows, inserted by the publisher (part-2 note E25); `web` gets `INSERT` on that one index table and nothing else in `idx` (P1.12 grant matrix); `review` has no grant on it.
- Publisher task `publishVideo(uploadId)` (runs in `web`'s job runner):

**Algorithm (publishVideo):**
1. Load the upload `FOR UPDATE SKIP LOCKED`; if state ≠ `approved` → return.
2. Recompute `snapshot_hash` from stored objects and fields; if ≠ stored → state `reviewing` again with a new review (defensive: something changed after review); alert.
3. If `privacy.state(did).posts ≠ public` → state back to `ready` with the notice "Your posts are private; save as a private post or make posts public" (no repo write).
4. `agent = pdsAgentFor(did)`; if `NeedsReauth` → leave `approved` with flag `needs_reauth` and `waiting_since = now` (if not already set); after 30 days without a sign-in P4.25 returns the upload to `ready` (E22); the screen shows "Publish now" which goes through login (`prompt=login` not required) and re-runs this task. Never publish with another account's session.
5. Choose the record key once: if `video_upload.rkey` is null, set it to a new TID and commit (so retries reuse it).
6. Copy renditions, poster and `captions.final.vtt` (as `captions.<lang>.vtt`) from `drafts/<did>/v/<id>/` to `media/<did>/v/<rkey>/`. (They are not served until the indexer sees the record, P3.09.) Copy failure → retry (P4.04 policy in the web job runner), state unchanged.
6a. If `bsky_tick`: run P4.15's `prepareBskyVideo` now (up to 10 minutes), **before** the master upload, so the master is uploaded immediately before `applyWrites` (a PDS never collects an unreferenced blob, and a long gap risks one).
7. `masterRef = pds.uploadBlob(agent, master bytes, "video/mp4")` (streamed); captions: `capRef = pds.uploadBlob(agent, vtt bytes, "text/vtt")` per track. Timeout 120 s for the master; on 5xx/timeout → retry. On 413:
   - our own PDS → alert (the P1.30 preflight asserts `PDS_BLOB_UPLOAD_LIMIT ≥ VIDEO_MASTER_MAX_BYTES`, so this is a misconfiguration); state `publish_failed`;
   - a foreign PDS (decision 5: any atproto account; `describeServer` does not publish the limit) → **pause and ask the user (decision 22); never decide automatically**: delete `media/<did>/v/<rkey>/`, set state `pds_refused_master` and `waiting_since = now`, and stop. The owner chooses on the screen: publish with `r720.mp4` (≤ ~23 MB) as the repo blob (`publish-720p`: flag `master_downgraded`, shown on the post's details by P4.16, and this task re-runs from step 1 using `r720.mp4` in step 7) or keep it as a draft (`keep-draft`). No answer for 30 days → P4.25 returns it to `ready`;
   - a 413 while `master_downgraded` is set (the 720p copy refused) → state `publish_failed` with the plain copy "Your PDS refused this video even at 720p".
8. Build `record = {$type: "sh.unset.video", video: masterRef, caption, alt?, aspectRatio, durationMs, posterTimeMs?, captions?: [{lang, file: capRef}], langs?, createdAt: now}`; `lexicon.validate("sh.unset.video", record)`; invalid → alert (a bug), state `publish_failed`.
9. Writes: `[create sh.unset.video rkey]`, plus the Bluesky post from P4.15 when `bsky_tick` (built by P4.15's `buildBskyPost`); one `pds.applyWrites(agent, did, writes)`:
   - success → step 10;
   - `InvalidSwap`/"record already exists" for our rkey → read it back with `getRecord`; if its video blob CID equals `masterRef` → treat as success (an earlier attempt landed); else alert and stop;
   - 401 DPoP nonce / transient 5xx → the P2.07 wrapper retries; persistent failure → state stays `approved`, retry with backoff up to 24 h, then `needs_reauth` copy;
   - 400 validation from the PDS → alert, state `publish_failed`.
10. In one transaction: state `published`, store `uri`, `cid`; insert `idx.rendition_set(did, rkey, master_cid = masterRef.cid, ready_at = now, duration_ms, width, height, master_downgraded)` (E25: the publisher made the `media/` copies, so it records them); insert the owner's read-after-write copy (P2.23 pattern, §2 rule 12).
11. Delete `drafts/<did>/v/<uploadId>/*` (the original upload, the master copy in drafts, renditions, thumbs, frames, VTT drafts) and the `video_fingerprint`, `nudity_result`, `text_result`, `transcript` rows; keep `review_decision` (moderation decisions are kept per §6; P5.09 sets the clock).
12. First publish only: the P2.23 first-publish notice was already shown before submission (the screen shows it with the consent block); nothing new here.
13. Terminal failure (`publish_failed`, or `expired` because the account is gone): delete `media/<did>/v/<rkey>/` at once so no orphan copies remain; the drafts follow the 30-day expiry (P4.25).

**Edge cases and failures:**
- The original upload never reaches the repo: only the master from P4.05 is passed to `uploadBlob`; a test asserts the bytes sent equal `master.mp4` and differ from `upload`.
- Read-after-write: until the indexer catches up, the owner's own pages read the published record from the app's copy, not the index.
- Unpublish of a video → out of scope here (P2.23's unpublish model applies; a follow-up row in P4.16 or P5.08 removes `media/<did>/v/<rkey>/`); see Notes.
- The user deletes their account between approval and publish → `pdsAgentFor` fails permanently → state `expired`, drafts deleted.
- A private post later made public through the P2.22 flip batch must go through submission and review first (notice, image gate, text gate) before any write: the `posts` `CategoryPublisher` returns it in `defer` and P2.22 reports the outcome through `privacy.reviewDone` (P2.22 "video path"); see Notes.
- The owner never answers the decision-22 question → after 30 days in `pds_refused_master` the upload returns to `ready` (P4.25) and later expires like any draft; nothing is published at 720p without the owner's click.

**Threats:** writing a reviewed video to the member's repository.
  - T What was approved differs from what is published → snapshot check; the master, not the original
    (`publish-snapshot-changed`, `publish-master-not-original`).
  - I A private account's video published → refused (`publish-private-account`).
  - T A lower quality published without consent → never alone (`publish-never-downgrades-alone`).
  - I Draft copies kept after publish → deleted (`publish-deletes-drafts`).

**Done when (tests):**
- `publish-one-applywrites`: approved upload, mock PDS → exactly one `uploadBlob` for the master (+ one per caption track) and one `applyWrites` with one create (or two with the tick); record validates; state `published`.
- `publish-master-not-original`: the bytes passed to `uploadBlob` hash to `master.mp4`, not to `upload`.
- `publish-deletes-drafts`: after success, `drafts/<did>/v/<id>/` is empty; `media/<did>/v/<rkey>/` has r360, r720, poster.avif, poster.webp, captions.
- `publish-idempotent-retry`: `applyWrites` succeeded but the response was lost (mock times out after commit) → the retry reads the record back, sees the same blob CID, marks `published`; one record exists.
- `publish-snapshot-changed`: tamper with the caption after approval → back to `reviewing`, alert, no write.
- `publish-private-account`: account private → no write, state `ready`, notice shown.
- `publish-needs-reauth`: `pdsAgentFor` → `NeedsReauth` → state `approved` with the `needs_reauth` flag; "Publish now" re-runs and succeeds after login.
- `publish-blob-limit-own-pds`: our PDS returns 413 → alert, `publish_failed`, no record, `media/<did>/v/<rkey>/` empty.
- `publish-blob-limit-foreign-pds-asks`: a foreign PDS returns 413 on the master → state `pds_refused_master`, no second `uploadBlob`, no record, `media/<did>/v/<rkey>/` empty, `master_downgraded` false; the screen shows both choices in EN and FR.
- `publish-720p-on-choice`: then `publish-720p` → one `uploadBlob` of `r720.mp4`, the record's `video` is that blob, `master_downgraded` true, `rendition_set.master_downgraded` true, published.
- `publish-keep-draft-on-choice`: `keep-draft` instead → state `ready`, `expires_at` reset to 30 days ahead, no repo write.
- `publish-720p-refused-too`: the PDS also returns 413 on `r720.mp4` → `publish_failed` with the plain copy, `media/` copies deleted.
- `publish-never-downgrades-alone`: across every PDS error the mock can return, no `uploadBlob` of `r720.mp4` happens without the owner's `publish-720p` request.
- `publish-records-rendition-set`: after success, `idx.rendition_set` has one row with `master_cid` equal to the record's video CID; `web` cannot insert into any other `idx` table (grant-matrix test).
- `publish-terminal-cleans-media`: PDS returns 400 → `publish_failed`, `media/<did>/v/<rkey>/` empty.
- `publish-bsky-prep-before-master` (with the tick): the mock records `prepareBskyVideo` before `uploadBlob(master)` and `uploadBlob(master)` immediately before `applyWrites`.
- `save-private-no-review`: "Save as private post" → no `nudity`/`text_gate` job, no repo write, objects under `drafts/<did>/private/`.
- `screen-consent-first-time`: first submission shows the notice checkbox and the local-review sentence (no company named); second does not; EN/FR; axe-core clean in both themes.
- `publish-always-has-captions`: every published `sh.unset.video` record has a `captions` array with at least one track, and `media/<did>/v/<rkey>/captions.<lang>.vtt` exists (decision 19).
- `screen-caption-limits`: caption field counts graphemes from `VIDEO_LIMITS`; 301 graphemes → error without JS (server) and live counter with JS.
- `screen-zero-js-fallback`: with JS disabled the publish form still submits (plain form POST, CSRF token-free because the gate is header-based).

**Reuse:** prototype `app/src/actions/posts.ts:44-95` (`publishPostAction`: one `createRecord` per post, raw video bytes to the repo, error text in the redirect URL) → REJECT (original bytes in the repo; free text in URLs breaks §2 rule 15; no review). `app/src/lib/posts.ts:51-75` (`uploadPostBlob`, `createPost` with `validate: false` after a local validation) → LESSON (validate locally with the one lexicon validator; one `applyWrites` instead of separate calls). Provisional — for reuse review.

**Not in this step:** the Bluesky post contents (P4.15); playback on public pages (P4.16); feeds (P4.21); unpublish and takedown of video bytes (see Notes); the private-post viewer (P4.16/P4.21 decide where owners see private posts).

**Diagram:** see "Flow: one video from upload to publish" (last steps).

---

### P4.15 — "Also post to Bluesky": spike against our PDS, then the opt-in tick
Tags: [SPIKE] [ALEX] (the disposable crawled PDS hostname; outline change in Notes)            Depends on: P4.14            Plan: §5.8 "Also post to Bluesky (decision 4)": opt-in tick, default off, `app.bsky.feed.post` with `app.bsky.embed.video` via Bluesky's video service against a self-hosted PDS, `app.bsky.embed.external` to the permalink as the fallback, in the same `applyWrites` as `sh.unset.video`; review 04 MINOR 10, review 07 BLOCKER-3
Where: spike notes and `docs/human/decisions/00xx-bluesky-video-crosspost.md`; then `domains/content/media/bsky-crosspost.ts`, the tick on the P4.14 screen, tests
Size: spike ~150 throwaway lines (not merged); tick ~180 source lines, ~200 test lines

**Goal:** find out whether Bluesky's video service accepts a video for an account on our own PDS and renders it in Bluesky, record the answer in an ADR, then build the tick with the path the spike proved (video embed) or the fallback (external link card).

**Inputs:** P4.14 publisher (approved upload, `r720.mp4`, poster, final captions, `rkey`); P2.04 OAuth agent and its granted scopes; a spike account on a PDS that is crawled by the Bluesky relay (see protocol step 1).

**Outputs:**
- ADR: the result (pass/fail per criterion), the exact XRPC calls, auth, limits observed, timings, and the chosen path.
- `buildBskyPost({did, rkey, caption, permalink, video?: blobRef + captions + aspectRatio + alt, external?: {uri, title, description, thumb blobRef}}) → write op` for `app.bsky.feed.post` with a fixed rkey derived per upload (a TID stored on the upload), and `prepareBskyVideo(agent, uploadId) → blobRef | Fallback(reason)`.
- The tick on the publish screen: default off; disabled with a reason when "Posts and follows" is private; label text says the Bluesky post is public and copied by other apps and services.

**Spike protocol:**
1. Environment: the development PDS never sets `PDS_CRAWLERS`, so Bluesky would never see its posts. Use a **disposable spike PDS** running the same pinned PDS version on a throwaway hostname with crawling requested, one throwaway account, torn down after (account deleted, hostname released). Needs Alex to approve the hostname and the teardown (see Notes). Never the production PDS.
2. Get a service-auth token for Bluesky's video service through the user's PDS, as the Bluesky video tutorial describes (`com.atproto.server.getServiceAuth` with the audience and `lxm` the docs name), using the app's OAuth session; record which `rpc:` scope the grant needs and whether our permission set plus fallback scope already allows it.
3. Upload the reviewed 720p rendition (a synthetic test clip) with `app.bsky.video.uploadVideo`; poll `app.bsky.video.getJobStatus` until done or 10 minutes; record timings and the returned blob ref.
4. Check the blob exists in the account's repo on our PDS (`com.atproto.sync.getBlob` from the PDS directly).
5. One `applyWrites` with `sh.unset.video` and `app.bsky.feed.post` (embed `app.bsky.embed.video` with `video`, `captions`, `aspectRatio`, `alt`).
6. Within 15 minutes, open the post in bsky.app web and the iOS app: plays, captions selectable, aspect correct.
7. Record observed limits (daily video count and bytes per user, max duration and size) and error shapes (quota exceeded, unsupported).
8. Fallback check: build an `app.bsky.embed.external` post to `https://unset.sh/@<handle>/p/<rkey>` with the poster uploaded as the thumb blob; confirm it renders as a link card.
9. Write the ADR; tear down the spike PDS and account.

**Pass/fail:**
- **Pass** (video path): steps 2–6 all succeed for a self-hosted PDS account, with a scope the permission set can legitimately request, and the post plays in Bluesky within 15 minutes.
- **Fail** (fallback path): any of steps 2–6 fails, or needs a scope we cannot request, or only works for `bsky.social` accounts.
- If the result contradicts P4.14's single-`applyWrites` design (for example the video service writes the post itself) → **stop**; the book is revised before continuing (README `[SPIKE]` rule).

**Algorithm (tick, after the ADR):**
1. On submit (P4.11), `bsky_tick` is part of the snapshot, so the review covers the Bluesky post text (caption) too.
2. In `publishVideo` at step 6a (before the master upload): if `bsky_tick`:
   a. video path: `prepareBskyVideo` uploads `r720.mp4` through the video service via net-guard (fixed host for the video service added to `web`'s allow-list in this PR), polls with a 10-minute ceiling; success → blob ref; quota exceeded, timeout or job failure → `Fallback(reason)` and the screen later says "Posted to Bluesky as a link" (never silently dropped);
   b. fallback path (or `Fallback`): `uploadBlob(poster.webp)` for the thumb; `external = {uri: permalink, title: "@handle on unset.sh", description: caption truncated to 300 graphemes, thumb}`.
3. `post = {text: caption truncated at a grapheme boundary to the Bluesky post limit with "…" and the permalink as a link facet when truncated, embed, langs, createdAt}`; validate against vendored `app.bsky.feed.post`.
4. Add the create op to the same `applyWrites` as `sh.unset.video`.

**Edge cases and failures:**
- The Bluesky post is public and copied: the tick says so; unticking later does not recall copies (unpublish deletes our records only).
- A private account → tick disabled (P4.01 Q1 recommendation; even without P4.01 answered, "Posts and follows" private means nothing public is written).
- Bluesky transcodes its own copy; its quality differs from ours (review 07); accepted.
- The fallback thumb puts the poster into the PDS blobstore: a small, already public image; noted against "posters never in the PDS blobstore" (see Notes).
- Video service unreachable → fallback within the 10-minute ceiling; the publish of `sh.unset.video` is never blocked by Bluesky.

**Done when (tests):**
- Spike: the ADR exists with each pass/fail criterion answered and evidence (request/response shapes with tokens redacted, screenshots).
- `tick-default-off`: the publish screen renders the tick unchecked.
- `tick-private-disabled`: account private → tick disabled with the reason text.
- `crosspost-video-path` (mock video service): one `applyWrites` with two creates; the post embed is `app.bsky.embed.video` with captions and aspect ratio; both records validate.
- `crosspost-fallback-on-quota`: mock returns a quota error → external embed with the permalink and thumb; screen notice set.
- `crosspost-text-truncation`: a 300-grapheme caption with emoji → truncated at a grapheme boundary, permalink facet byte offsets correct.
- `crosspost-in-review-snapshot`: changing the tick after submission changes `snapshot_hash`.
- `crosspost-only-fixed-hosts`: the video-service call goes through net-guard's fixed host; any other host refused.

**Reuse:** prototype — none (it never cross-posted). The vendored `app.bsky.feed.post` and `app.bsky.embed.*` lexicons (P1.31 `lex install`) → USE. Provisional — for reuse review.

**Not in this step:** standalone Bluesky posts (P4.17); feeds showing Bluesky posts (P4.21); deleting the Bluesky post on unpublish (owned by the unpublish row; see Notes).

**Diagram:**
```mermaid
sequenceDiagram
  autonumber
  participant W as web publisher
  participant P as user's PDS (ours)
  participant V as Bluesky video service
  participant B as Bluesky AppView
  W->>P: getServiceAuth(aud, lxm) with the user's OAuth session
  P-->>W: short-lived service token
  W->>V: uploadVideo(r720.mp4) with the token
  V->>P: uploadBlob (as the user)
  W->>V: getJobStatus (poll ≤10 min)
  V-->>W: blob ref
  W->>P: applyWrites [sh.unset.video, app.bsky.feed.post{embed.video}]
  P-->>B: firehose via relay
  Note over W,B: Fallback: embed.external to the permalink, thumb = poster
```

---

### P4.16g — `media` read grants for playback (split from P4.16, SE-6)

Tags: [SEC]            Depends on: P4.14, P4.02, P3.03            Plan: §5.2 roles; §9 trusted base (rule SE-6, as ruled 2026-10-04; plan `f9b48f8`); §5.2 media proxy
Where: one migration (grant statements only), `grant-matrix.json` rows, matrix test rows
Size: ~5 lines SQL, ~10 test lines

Why a separate step (letter suffix): `idx.record`, `idx.account` and `idx.rendition_set` exist before P4.16, so the
`media` grants its test `rendition_media_role_read_only` asserts are trusted base.
Goal: `media` can read exactly the three tables playback needs.
Inputs: P3.03 (`idx.account`; `media` already reads `idx.visible_account` and `idx.record_blob`), P4.02/P3.05
  (`idx.record`), P4.14 (`idx.rendition_set`).
Outputs: `GRANT SELECT (<columns>) ON idx.record, idx.account, idx.rendition_set TO media`, one column list per table
  naming only what the rendition path reads (these are registry tables: column lists, never table-wide; column-list
  ruling, 02-shared-blocks §11; P4.00 writes the lists); the column-level matrix rows.
Algorithm: the statement.
Edge cases and failures: none beyond the matrix test.
Threats: the `media` role.
  - E `media` reading or writing more → `rendition_media_role_read_only` (P4.16), `matrix_matches`.
Done when (tests): `matrix_matches`; as `media`, `INSERT INTO idx.rendition_set …` fails `42501`.
Reuse: none. Not in this step: the playback routes (P4.16). Diagram: none.

---

### P4.16 — Playback: renditions through the media proxy, and the player

Tags: [SEC]            Depends on: P4.16g, P4.05, P4.14, P4.02, P3.09            Plan: §2 rule 9, §5.2 media proxy, §5.8 renditions and captions ("the caption file … are repo blobs by design, with a served copy in `media`"), §6.1 WCAG and budget
Where: `interfaces/media` (rendition route), `domains/content/video/playback` (URL builder, hydration helper), `apps/web/islands/video-player`, `shared/ui` player markup used by `ProfileView` and the feed
Size: ~320 source lines, ~380 test lines

Goal: play every published video from our media storage with `Range`, subtitles available on every video behind a
CC control that is off by default (Alex 2026-10-03; decision 19 keeps the track mandatory), a visible pause,
keyboard control, and reduced motion and data honoured, with zero JS on the public permalink.

Inputs: the part-1 layout `media/<did>/v/<rkey>/…` (P4.14 copies the files there at publish) and `idx.rendition_set`;
P3.09 media entrypoint, `mediaHeaders()`, purge hook and `/b/{did}/{cid}` blob route; `idx.record` rows for
`sh.unset.video` (P3.05 + the P4.02 ingest registration); `idx.account`; the `media` DB role, read-only on
`idx.record`, `idx.account` and `idx.rendition_set` (R8); CSP builder (P1.08); island runtime (P1.23); the
design sheet's player components (P1.24).
Outputs:
- Route on the media domain: `GET|HEAD /v/{did}/{rkey}/{asset}` where `asset ∈ {r360.mp4, r720.mp4, poster.avif,
  poster.webp, captions.<lang>.vtt}`. The full-quality file is the record's own repo blob, served by P3.09's
  `/b/{did}/{videoCid}` route on the same origin, so this route has no 1080p asset and no redirect.
- `playback.urls(did, rkey, videoCid, captionLangs[], masterDowngraded) → {poster: {avif, webp}, r360, r720, r1080 |
  null, tracks[{lang, src}]}`. `r1080 = /b/{did}/{videoCid}`, or `null` when `master_downgraded` (the repo blob is
  then the 720p rendition, so it adds nothing).
- `playback.isPlayable(did, rkey) → boolean` (record indexed, account active and not delisted, `rendition_set` ready
  for the record's current video CID).
- `<VideoPlayer mode="feed" | "permalink">` markup (server-rendered) plus the `video-player` island (≤15 KB gz). When
  `master_downgraded`, the post's details say "Published at 720p: the author's PDS refused the full-quality file"
  (decision 22; EN and FR catalog keys).
- CSP additions for the app route groups: `media-src` and `img-src` the media origin only.

Algorithm (rendition route, `media`):
  1. Parse path. `did` must be a valid DID, `rkey` a valid record key (the `@atproto/syntax` check, never a hand
     regex), `asset` in the allow-list, `lang` matching `^[a-z]{2,3}(-[A-Z]{2})?$`. Otherwise `400`, body empty,
     `mediaHeaders()`.
  2. If method is not GET or HEAD → `405` (P1.04 denies unknown methods).
  3. Query (one statement, `media` role, read-only on index): exists `idx.record` with `collection='sh.unset.video'`,
     `did=$1`, `rkey=$2`, not deleted; and `idx.account` active and not delisted; and `idx.rendition_set(did, rkey)`
     ready **with `master_cid` equal to the record's promoted `video_cid`** (a record rewritten at the same rkey by
     another client, with a different video, never borrows our renditions). From P5.08a the same statement also
     excludes a record whose URI is in `hidden_by_moderation` (that step adds the join and answers `410`). Timeout 2 s.
     - DB timeout or error → `503`, `Cache-Control: no-store`, `Retry-After: 5`. Never 404 on an outage.
     - No row → `404`, `Cache-Control: no-cache`.
  4. Keep `master_cid` from the step-3 row; it names the ETag in step 7.
  5. Read object metadata `media/{did}/v/{rkey}/{asset}` from storage (timeout 3 s).
     - Missing → `404` (and log `media.rendition_missing` with did and cid only; it means the worker and DB disagree).
     - Size > 64 MiB → `502`, never stream it.
     - Storage timeout or error → `503`, `no-store`.
  6. Content type from the asset name only (`video/mp4`, `image/avif`, `image/webp`, `text/vtt; charset=utf-8`),
     never from storage metadata.
  7. Range handling (RFC 9110 §14): if `If-Range` is present and does not equal the strong ETag
     `"{masterCid}-{asset}"` → ignore Range. If `Range` is one `bytes=a-b`, `bytes=a-` or `bytes=-n` range inside the
     object → `206` with `Content-Range: bytes a-b/size`; if it is unsatisfiable → `416` with
     `Content-Range: bytes */size`; if it lists several ranges or is malformed → ignore it and send `200` (allowed by the RFC).
  8. Headers on every outcome: `mediaHeaders()` (sandbox CSP, `nosniff`, `max-age=3600`, not immutable),
     `Accept-Ranges: bytes`, ETag, `Access-Control-Allow-Origin: <app origin exactly>` (no credentials; needed because
     `<video crossorigin>` and `<track>` fetch with CORS), `Vary: Origin`, `Cross-Origin-Resource-Policy: cross-origin`.
  9. Stream the object (or slice) from storage; never buffer the whole file. Storage error mid-stream → abort the
     connection (the client retries with Range).
  10. HEAD answers the same headers with no body.

Algorithm (player markup and island, `web`):
  1. Server renders `<figure>` with `<video crossorigin="anonymous" playsinline preload="none" poster=<webp>
     controls>` (`<picture>` for the poster is not possible on `<video>`, so the poster is WebP and the AVIF is used by
     the static poster `<img>` shown before the video element in feed mode), `<source src=r360 type="video/mp4">`,
     and one `<track kind="captions" srclang=lang src=… label=t('video.captions', {lang})>` per caption; **no track
     has `default`**, so subtitles are off until the viewer turns them on (Alex 2026-10-03). Every published video has
     at least one track (P4.09, P4.14), so the native CC menu is always present. `style="aspect-ratio: w / h"` from
     the record (CLS ≤0.1). Native `controls` give the visible pause, the CC menu and keyboard focus in every mode.
  2. Permalink mode (`/@handle/p/{rkey}`, zero JS): steps 1 only, no `autoplay`, `preload="none"`. Nothing else.
  3. Feed mode: the `video-player` island hydrates each player and:
     a. reads `matchMedia('(prefers-reduced-motion: reduce)')`, `matchMedia('(prefers-reduced-data: reduce)')` and
        `navigator.connection?.saveData`; if any is true → no autoplay, poster only, play on user action.
     b. otherwise one IntersectionObserver (threshold 0.6): entering → `muted = true`, `play()`; leaving → `pause()`.
        A rejected `play()` promise (autoplay policy) → leave paused with the poster and controls; no retry loop.
     c. sets `preload="metadata"` on the next player in the list only.
     d. renders a visible **CC** toggle button (`aria-pressed`, label "Subtitles" / « Sous-titres ») beside the native
        controls; off by default; on → the track in the viewer's UI language (else the first) gets
        `mode = "showing"`, off → every track `"disabled"`. The choice is remembered per viewer in a `localStorage`
        key inside try/catch (failure → off, the default); muting does not change it.
     e. on `fullscreenchange` into fullscreen, when `effectiveType = "4g"` and no save-data → swap `src` to r720,
        restore `currentTime`, keep paused state. Swap fails (`error` event) → swap back to r360.
     f. keys while the player wrapper has focus: Space/K play-pause, ←/→ seek 5 s, M mute, C subtitles on/off (the
        same state as the CC button).
        Keys never act when focus is in a text input. Each key handler is idempotent.
  4. The island never builds a URL itself: every URL comes from server props (`serializeProps`), built by
     `playback.urls`.

Edge cases and failures:
  - Record deleted, account deactivated, delisted or taken down → `404` on the next request; purge (P3.09) evicts
    cached copies; feed hydration skips it via `isPlayable`.
  - `sh.unset.video` written by another client without our pipeline (no `rendition_set`) → `404` and never shown in
    feeds or on the permalink (the permalink shows "video unavailable"). Fail closed: unreviewed media never plays.
  - Asset name outside the allow-list (`../`, `master.mp4`, `R720.mp4`, `captions/en.vtt`) → `400`.
  - Record rewritten at the same rkey with a different video blob → `404` (the `rendition_set` names the old CID, and
    the publisher writes rows only for its own uploads).
  - `master_downgraded` → `r1080` is `null`; the player offers 360p and 720p only.
  - `Range: bytes=0-` on a 0-byte object → `416`.
  - `If-Range` with a stale ETag → full `200`.
  - Storage slow → `503` with `Retry-After`, never a cached 404.
  - Caption file missing for a listed track → the track 404s; the video still plays (the browser drops the track).
    The caption files are also repo blobs that other clients read from the record; we serve only our copy.
  - Cross-origin request from an origin other than the app → still served (media is public) but ACAO names only the app.
  - Autoplay blocked by the browser → poster and controls, no error UI.
  - JS disabled in the app → native controls still play (no autoplay).

Threats: public playback of published video from our media origin.
  - E Unreviewed, delisted or replaced videos served → gate on state and CID (`rendition_gate_unreviewed_record`,
    `rendition_gate_delisted`, `rendition_gate_video_cid_mismatch`).
  - T Script on the media origin, or credentialed cross-origin reads → sandbox CSP, `nosniff`, exact origin, no
    credentials (`rendition_headers`, `rendition_cors_exact_origin`).
  - D Range abuse or large objects exhaust memory → streamed, capped, bad paths 400 (`rendition_streams_not_buffers`,
    `rendition_too_large_502`, `rendition_bad_paths`).

Done when (tests):
  - `rendition_range_single`: 1 MB fixture; `Range: bytes=100-199` → `206`, 100 bytes, `Content-Range: bytes 100-199/1048576`.
  - `rendition_range_suffix_and_open`: `bytes=-500` and `bytes=1048000-` → correct slices.
  - `rendition_range_unsatisfiable`: `bytes=2000000-` → `416`, `Content-Range: bytes */1048576`.
  - `rendition_range_multi_ignored`: `bytes=0-1,5-6` → `200` full body.
  - `rendition_if_range_mismatch`: wrong ETag → `200`.
  - `rendition_headers`: every status (200, 206, 304-free, 404, 416, 503) carries sandbox CSP, `nosniff`, `max-age=3600`, no `immutable`.
  - `rendition_cors_exact_origin`: ACAO equals the configured app origin, never `*`, no `Allow-Credentials`.
  - `rendition_gate_inactive`, `rendition_gate_delisted`, `rendition_gate_deleted_record`: each → `404`.
  - `rendition_gate_unreviewed_record`: record indexed, no `rendition_set` → `404`.
  - `rendition_gate_video_cid_mismatch`: `rendition_set.master_cid` differs from the record's `video_cid` → `404`.
  - `rendition_db_outage_503`: DB stub throws → `503`, `no-store`.
  - `rendition_storage_missing_404` and `rendition_storage_timeout_503`.
  - `rendition_too_large_502`: metadata 65 MiB → `502`, nothing streamed.
  - `rendition_bad_paths`: table of 12 bad paths → all `400`.
  - `playback_urls_1080`: `r1080` is `/b/{did}/{videoCid}` on the media origin; with `master_downgraded` it is `null`.
  - `player_downgraded_note`: a `master_downgraded` post's permalink shows the 720p sentence in EN and FR; other posts do not.
  - `rendition_media_role_read_only`: the grant-matrix test shows `media` with SELECT on `idx.record`,
    `idx.account` and `idx.rendition_set` only.
  - `rendition_streams_not_buffers`: a 60 MB stream stub; the handler's peak buffered bytes stay under 1 MB.
  - `player_permalink_zero_js`: `/@handle/p/{rkey}` HTML has no `<script>`; `<video>` has `controls`, `preload="none"`, at least one `<track kind="captions">` with **no** `default` attribute, and `aspect-ratio`.
  - `player_island_reduced_motion` / `_reduced_data` / `_save_data`: jsdom with each media query true → `play()` never called.
  - `player_island_autoplay_rejected`: `play()` rejects → no retry, poster stays.
  - `player_captions_off_by_default`: on load (muted autoplay included) every track is `disabled`; muting does not turn them on.
  - `player_cc_toggle`: the CC button turns the UI-language track `showing` and back to `disabled`; `aria-pressed` follows; the choice survives a reload; a throwing `localStorage` leaves them off.
  - `player_island_keys`: Space, K, ←, →, M, C each do their action; keys inside an `<input>` do nothing.
  - `player_island_fullscreen_720_swap_and_fallback`: swap keeps `currentTime`; an `error` swaps back.
  - `player_island_size_budget`: built island ≤15 KB gzipped.
  - `player_axe_both_themes`: Playwright page with a feed of 3 players, axe wcag2a..wcag22aa zero violations, light and dark.

Reuse:
  - `appview/src/media-proxy.ts:110-117` (sandbox CSP, `nosniff`, not-immutable cache with the reason) → LESSON, provisional — for reuse review.
  - `appview/src/media-proxy.ts:84-90, 126-138` (forwards the raw `Range` upstream and buffers the whole body, 64 MiB) → REJECT: buffering breaks video and the gate serves any blob of a DID, not a referenced one (review 03 §3).
  - `app/src/components/social/SocialTimeline.tsx:238-246` (`<video controls preload="metadata">`, no `<track>`, no `aspect-ratio`) → REJECT: no captions track at all fails WCAG 1.2.2 (captions must be available; off by default with a visible CC control satisfies it) and the CLS budget.
  - `app/src/lib/profile-media.ts:2-13` (raw `getBlob` URL) → REJECT: §2 rule 9.
Not in this step: transcoding and ffprobe checks (P4.05); caption editing (P4.14); hls.js or HLS (plan: only if mid-clip adaptation proves necessary); a CDN in front of `media` (later config); the first-frame budget run (P4.28); new player chrome beyond native controls (needs the design sheet, P1.24 stop).
Diagram: none (the feed-tab sequence above shows the media fetch).

---

### P4.17 — Standalone Bluesky posts (text and images) through the same review

Tags: [MOD] [SEC]            Depends on: P4.11, P4.08, P4.09a, P4.13, P2.16, P2.17, P2.07, P2.22            Plan: §5.8 "Other post kinds", "Reviewed before going public", "Fingerprints", "Local nudity gate"; Alex answers 30 and 30b (local text gate, nothing to Claude), "restores the user's OAuth session server-side", §3 scopes
Where: `domains/social/bsky-post` (draft, submit, publish), `interfaces/http/routes/compose`, `apps/web/screens/compose`
Size: ~300 source lines, ~320 test lines

Goal: a user writes an `app.bsky.feed.post` (text, up to four images with alt text) that reaches their repo only
after the P4.11 review passes.

Inputs: draft store (P2.18); the P2.16 fingerprint stage (with the C-16 transmission buffer from P5.07b), and the P2.17 pipeline;
`review.submit` with `ReviewJob` kind `bsky_post` and `onReviewDecision` (P4.11), whose pipeline reuses the P4.08 image
gate (nudity and gore) and the P4.09a text gate; P4.13 appeals; `pdsAgentFor`, `pds.applyWrites` and `uploadBlob` via P2.07;
`privacy.state` (P2.22); vendored `app.bsky.feed.post` lexicon (P1.31 `lex install`); `resolveHandle` and
`verifyHandle` (P2.01, P2.02).
Outputs:
- Table `app.bsky_post_draft(id uuid PK, did, text, langs text[], facets jsonb, images jsonb[≤4], state, review_job_id,
  rkey NULL, needs_reauth bool, waiting_since timestamptz NULL, published_uri, published_cid, created_at, updated_at)` with `state ∈ draft | reviewing
  | unsure | blocked | appealed | appeal_upheld | approved | published | publish_failed | expired | matched_hold` (`matched_hold`:
  P4.07's suspected-abuse path, answer 30c; terminal, the text and images sealed and deleted). These are part 1's
  video state names with the same meanings (`draft` plays the part of `ready`), so P4.12, P4.13 and P4.25 treat both
  kinds alike; `needs_reauth` is a flag on `approved`. DID column registered (P1.13).
- `bskyPost.saveDraft(did, input) → draftId`, `bskyPost.submit(did, draftId) → reviewing`,
  `bskyPost.onDecision(jobId, decision)`, `bskyPost.publish(draftId)` (internal, run by `web`'s job runner).
- Routes: `GET /compose`, `POST /compose` (save), `POST /compose/{id}/submit`, `POST /compose/{id}/delete`,
  `POST /compose/{id}/publish-now` (after "Sign in to publish").

Algorithm:
  1. `POST /compose`: session required (else `303 /login?return=/compose`). Rate limit `post.create` per DID (10/hour)
     → limited: re-render with `?error=rate.limited`.
  2. Privacy gate: `privacy.state(did).posts`. `public` → continue. `private` → re-render with the reason code
     `social.bsky_post_needs_public` (a Bluesky post is a public record; Q2b). Any other `SwitchState` (a flip or update in progress, paused, or `waiting_review`) → `social.privacy_flip_in_progress`.
  3. Text: NFC-normalise; count graphemes; > 300 → `post.text_too_long`; empty with no images → `post.empty`.
  4. Facets: detect links (`https?://` only, through `safeHref`) and mentions (`@handle`). For each mention (max 10):
     `resolveHandle` (timeout 3 s) then `verifyHandle(did)` must return the same handle; any failure → keep it as plain
     text, no facet. Byte offsets are UTF-8 byte indices (the lexicon's rule).
  5. Images (0–4): each upload goes through `images.ingest`. The P2.16 stage checks PDQ (only) before anything is
     stored, and from P5.07b also seals the C-16 transmission buffer for that request; then P2.17 re-encodes with metadata stripped. The stored
     re-encoded bytes are exactly the bytes uploaded at publish (R1). `blocked` → the whole draft is refused with
     `media.blocked` (the gate itself runs the match path; this step adds nothing). Alt text required per image
     (≤2,000 graphemes) → missing: `post.alt_required`.
  6. Validate the would-be record with `lexicon.validate('app.bsky.feed.post', record)` using placeholder blob refs of the
     right MIME and size → invalid → `post.invalid` (log the path, not the text).
  7. Save the draft (`state = draft`) in one transaction.
  8. `POST /compose/{id}/submit`: load the draft by `(id, did)` (never by id alone; mismatch → 404). If `state ≠ draft`
     → `409 post.already_submitted`. Re-run steps 2 and 6. `review.submit({kind: 'bsky_post', did, draftId, text,
     imageKeys})` → set `state = reviewing`, `review_job_id`. Show "in review" with the automated-review sentence and
     "it will go live once review completes" (plan §5.8). The kind's pipeline (P4.11, R4): the P4.08 image gate on each
     stored image (nudity → `blocked` or `unsure`, gore → `unsure`), then the P4.09a text gate on the text and every
     alt text (S4 → P4.07's emergency path); nothing leaves our servers (answer 30b).
  9. `onReviewDecision(jobId, d)` (called by P4.11; idempotent on `jobId`):
     a. draft not found or not `reviewing` → no-op, log `bsky_post.stale_decision`.
     b. `fail(reason)` → `state = blocked`, store the reason code; the screen shows the statement of reasons and the
        appeal link. P4.13 then moves it `blocked → appealed → approved | appeal_upheld` (upheld deletes the images).
     c. `unsure` → `state = unsure`; nothing written; P4.12 decides (`approved` or `blocked`).
     d. `pass` → `state = approved`, enqueue `publish(draftId)` in `web`'s job runner.
  10. `publish(draftId)` (runs with no user present):
     a. Load the draft `FOR UPDATE SKIP LOCKED`; `state ≠ approved` → return. Re-check `privacy.state(did).posts = public`.
        Not public → `state = draft`, notice `social.bsky_post_needs_public`.
     b. `agent = pdsAgentFor(did)`: the member's OAuth session restored server-side from the sealed token store (plan
        §5.8, 22:49Z). `NeedsReauth` → stay `approved`, set `needs_reauth` and `waiting_since` (30 days later P4.25 returns the draft to `draft`, E22); the compose screen shows "Sign in to
        publish", whose button goes through login and then `POST /compose/{id}/publish-now`, which re-runs this task
        for the session's own DID only. Never another account's session.
     c. If `rkey` is null, set it to a new TID and commit, so every retry writes the same record key.
     d. Blob rule (R1): upload the images only now, immediately before the `applyWrites` in step f, from the stored
        re-encoded bytes (`uploadBlob` via P2.07, timeout 20 s each). A retry uploads the same stored bytes again (same
        CID; the reference PDS replaces its temporary copy, `atproto/packages/pds/src/actor-store/blob/transactor.ts:127-134`),
        never a fresh re-encode. The PDS does not delete a temporary blob that no record references
        (`transactor.ts:89`, `:298-310`), so fresh bytes per retry would leave files on the member's PDS.
     e. Build the record with real blob refs, `createdAt` now, `langs` from the draft; validate again.
     f. One `applyWrites` (create at `rkey`, timeout 8 s). Success → store `published_uri/cid`, `state = published`,
        delete the draft images from the draft store (best effort; P4.25 is the backstop). "Record already exists" at
        our rkey → read it back; same text and blob CIDs → success (an earlier attempt landed); else alert and
        `publish_failed`.
     g. Errors in d–f: `PdsTimeout`/`PdsTransient` → retry d–f up to 3 times with backoff 2 s, 8 s, 30 s, then
        `state = publish_failed` with `pds.unavailable` and a "retry" button (which re-enters at d with the same bytes).
        `PdsAuthLost` → as `NeedsReauth` in b. `PdsRejected` → `state = publish_failed`, `pds.rejected`.
  11. `POST /compose/{id}/delete`: `(id, did)` scoped; allowed in `draft | blocked | appeal_upheld | publish_failed`;
      deletes row and images. `reviewing | unsure | appealed | approved` → `409` (withdrawal while a person decides is
      out of scope; see "Not in this step").

Edge cases and failures:
  - Text with only whitespace → `post.empty`.
  - Mention of a handle whose bidirectional check fails → plain text, no facet (never a facet to an unverified DID).
  - A `javascript:` or `data:` link → not a facet, kept as text.
  - Privacy switched to private between pass and publish → nothing written, back to draft with the reason.
  - Decision arrives twice → second is a no-op.
  - Decision for another user's draft id → impossible by construction (job carries the draft id; publish loads by id and
    uses the draft's own DID); test anyway.
  - `uploadBlob` succeeds and `applyWrites` fails → the blob stays in the PDS's temporary store (the reference PDS
    never sweeps it, R1). The retry re-uploads the same bytes, so it is the same temporary file, not a new one, and it
    becomes permanent when the record lands. An abandoned draft leaves at most one temporary copy per image.
  - Session revoked between the pass and the publish → `approved` with `needs_reauth`, "Sign in to publish"; nothing written.
  - An image with any nudity → `blocked` or `unsure` per P4.08; no image or text is ever sent to a model provider (answer 30b).
  - Image over the pipeline's pixel limit → the pipeline's error code, shown on the form.

Threats: Bluesky posts written on a member's behalf after review.
  - E Publishing before the review passes, or for another DID → no PDS call before pass; scoped by DID
    (`bsky_post_never_in_repo_before_pass`, `bsky_post_scoped_by_did`).
  - S A mention facet pointing to an unverified DID → no facet (`bsky_post_mention_unverified_no_facet`); unsafe links
    not faceted (`bsky_post_unsafe_link_not_faceted`).
  - I Images with nudity sent outside → never (`bsky_post_images_nudity_never_leave`).
  - S Cross-site submission → CSRF (`bsky_post_csrf_gate_applies`).

Done when (tests):
  - `bsky_post_private_refused`: posts private → submit refused with `social.bsky_post_needs_public`; no review job.
  - `bsky_post_flip_in_progress_refused`.
  - `bsky_post_text_limits`: 300 graphemes ok (emoji counted as one), 301 refused; empty refused.
  - `bsky_post_alt_required`.
  - `bsky_post_mention_unverified_no_facet`: resolveHandle returns a DID whose doc names another handle → no facet.
  - `bsky_post_facet_byte_offsets`: text with "é" and an emoji before a link → offsets are UTF-8 bytes.
  - `bsky_post_unsafe_link_not_faceted`.
  - `bsky_post_blocked_image_refuses_draft`: gate returns `blocked` → nothing saved, no review job.
  - `bsky_post_pass_publishes_once`: pass → one `applyWrites` with one create; decision replayed → still one.
  - `bsky_post_fail_blocked_with_reason`; `bsky_post_unsure_waits`.
  - `bsky_post_appeal_states`: `blocked` → appeal → `appealed`; upheld → `appeal_upheld` and the images are deleted; overturned → `approved` → published once.
  - `bsky_post_images_nudity_never_leave`: P4.08 returns `unsure` for one image → the net-guard mock records zero requests, state `unsure`.
  - `bsky_post_review_job_shape`: the submitted job is `{kind: 'bsky_post', …}` with the stored image keys; the image gate receives the images and the text gate receives the text and every alt.
  - `bsky_post_alt_s4_suspected`: the text gate returns S4 on one alt → draft `matched_hold`, P4.07 suspected path, nothing published.
  - `bsky_post_image_gate_seals_buffer` (runs once P5.07b lands): an image upload writes one C-16 buffer row, destroyed when the check is clear.
  - `bsky_post_privacy_changed_before_publish`: pass after the switch went private → no write, state `draft`.
  - `bsky_post_pds_transient_retries_then_fails`: three 503s → `publish_failed`, `pds.unavailable`; a later retry succeeds.
  - `bsky_post_publish_restores_session_server_side`: pass with no request in flight → `pdsAgentFor` restores the session from the token store and the record is written.
  - `bsky_post_revoked_grant_sign_in_to_publish`: `NeedsReauth` (or `PdsAuthLost`) → `approved` with `needs_reauth`, no write, session row still present; after login `publish-now` publishes once; another DID's `publish-now` → 404.
  - `bsky_post_retry_reuploads_same_bytes`: first `applyWrites` 503, retry → `uploadBlob` gets byte-identical input both times (same CID) and the encoder is not called again.
  - `bsky_post_blobs_uploaded_just_before_applywrites`: the PDS stub's call log shows the `uploadBlob` calls followed directly by `applyWrites`, and none before the pass.
  - `bsky_post_lost_response_same_rkey`: `applyWrites` commits but the response is lost → the retry finds the record at the stored rkey and marks `published`; one record exists.
  - `bsky_post_scoped_by_did`: user B submitting user A's draft id → 404.
  - `bsky_post_never_in_repo_before_pass`: PDS stub records every call; none before the pass decision.
  - `bsky_post_csrf_gate_applies`: cross-site POST → 403 (P1.07 static test lists these routes).
Reuse:
  - `app/src/actions/posts.ts` and `app/src/lib/posts.ts` (prototype `app.0x40.post` publish with `validate:false` and
    local validation) → LESSON, provisional — for reuse review: wrote straight to the repo with no review, and its record type is gone.
  - `@atproto/api` `RichText.detectFacets` → LESSON, provisional — for reuse review: it resolves mentions without the
    bidirectional check, so facets are built here with P2.02; the library's byte-offset logic is the reference.
Not in this step: replies (P4.20); quote posts and reposts (not in plan scope); video in a Bluesky post (P4.14/P4.15);
threads; editing a published Bluesky post (Bluesky posts are not edited); the review itself (P4.08, P4.09a, P4.11).
Diagram: none.

---

### P4.17a — Interaction policy: the P4.01 matrix as typed data

Tags: [SEC]            Depends on: P4.01, P2.22, P3.05, P1.13            Plan: §11 Q2b (proposal), §2 rule 12, §3 scopes
Where: `domains/social/policy` (matrix file, `decide`, completeness check), migration for two app tables
Size: ~180 source lines, ~220 test lines

Goal: one module turns Alex's P4.01 decision into the answer "where does this follow, like or comment live, and who
sees it", so P4.18–P4.20 contain no privacy rules of their own.
Settled by Alex (2026-10-03, answers 26, 27, 28): the default matrix is the decided one: private cells are `app_db`
with `visibleTo: 'owner_and_target'` and `targetSeesActor: true`; `like_bsky` and `comment_bsky` private cells are
`disabled` with a one-line reason; every `flip.toPublic` is `convert`, run in the same batch as the posts.
Reason for the letter suffix: P4.18, P4.19 and P4.20 depend on P4.01 independently in the outline; without a shared
step each would grow its own copy of the matrix (global invariant 2).

Inputs: P4.01 ADR (matrix cells, flip rules, comment review rule); the comment and like record types from plan §5.8
(`sh.unset.comment`, `sh.unset.like`) and the follow types by target (answer 29b, plan decision 28: `sh.unset.follow`
for an unset.sh account, `app.bsky.graph.follow` for a Bluesky account); `privacy.state` and the `CategoryPublisher` interface (P2.22); requested OAuth
scope string (P2.04, §3; exactly plan line 126).
Outputs:
- Data file `interaction-matrix` (typed constant):
  `InteractionMatrix = {adr: string, comment: {type: 'sh.unset.comment' | 'app.bsky.feed.post' | 'app_db_only', review:
  'before_publish' | 'none'}, cells: Record<Kind, Record<'private' | 'public', Cell>>, flip: Record<Kind, {toPublic:
  'convert' | 'drop' | 'keep_private', toPrivate: 'convert' | 'delete'}>}`,
  `Kind = follow_ours | follow_bsky | like_ours | like_bsky | comment_ours | comment_bsky` (follows split by target,
  answer 29b: the public cells are `{mode: 'repo', collection: 'sh.unset.follow'}` and `{mode: 'repo', collection:
  'app.bsky.graph.follow'}`; both private cells are `app_db`),
  `Cell = {mode: 'repo', collection: Nsid} | {mode: 'app_db', visibleTo: 'owner' | 'owner_and_target', targetSeesActor:
  boolean} | {mode: 'disabled', reasonCode: ErrorCode}`.
- `interactionPolicy.decide(viewerDid, kind) → {cell} | refused('social.privacy_flip_in_progress')`.
- `interactionPolicy.targetOrigin(subjectDid) → 'ours' | 'bsky'`: `ours` when `idx.record` holds an `sh.unset.profile`
  record for the subject and `idx.account` says active (the lead's default for "unset.sh account", answer 29b; P4.00
  may refine it); else `bsky`. One function, used by P4.18 and by the flip batch below; index read error → throw (the
  route answers 503, never a guess).
- `interactionPolicy.assertComplete(matrix, scopeString)` run at boot and in a test.
- Table `app.private_interaction(id uuid PK, actor_did, kind, subject_uri, subject_did, body text NULL, created_at,
  collection text, rkey text, record jsonb, UNIQUE (actor_did, collection, rkey),
  UNIQUE (actor_did, kind, subject_uri) WHERE kind <> 'comment_ours')`; indexes on `(subject_did, kind)` and
  `(subject_uri)`. Both DID columns registered.
  **Shaped for Spaces (decision 38, ADR 0005; Editor pass B 2026-10-04 late):** this table holds private records, and
  each row is one record in our lexicon, keyed exactly as the public record or a space repo would key it: `collection`
  is the record's NSID (`sh.unset.like`, `sh.unset.comment`, `sh.unset.follow`), `rkey` is a TID chosen once at creation
  and never changed, and `record` is the full lexicon record, checked with `lexicon.validate` against the same schema as
  the public record before insert. So a later move into the member's space is a copy, not a redesign, and the flip to
  public writes the repo record with the same rkey. Nothing here uses Spaces (P4.00's check).
- **Shown to the target (decision 39, Alex 2026-10-04 17:40Z, ADR 0006):** every private cell is `app_db` with
  `visibleTo: 'owner_and_target'` and `targetSeesActor: true`. The target (the liked or commented post's author, or the
  followed person) sees the member's name with it, inside unset.sh only. Nobody else sees it, not even its existence
  (a third party's response is identical to the one with no private row); it is never written to a repo, the PDS, the
  firehose, the read API (P3.10) or our feed generators (P4.22a). The "author only" option (`targetSeesActor: false`)
  was declined and is removed from the matrix type.
- **One-time notice** (decision 39): table `app.privacy_notice_seen(did text, notice text, seen_at timestamptz,
  PRIMARY KEY (did, notice))`, DID registered. The first time a member sets "Posts and follows" to private on
  `/settings/privacy` (P2.22's screen), the confirmation shows this text once (catalog key
  `privacy.private_interactions_visible_to_target`):
  "Private likes, comments and follows are not hidden from the person they are about. If you like or comment on
  someone's post, or follow someone, they will see your name next to it, here on unset.sh only. Nobody else sees it, and
  it is never posted to Bluesky or your public account." Button "I understand". Seeing it inserts the row; it is never
  shown again for that member.
- Table `app.own_interaction(actor_did, kind, subject_uri, record_uri, rkey, submission_id uuid NULL UNIQUE, created_at,
  PRIMARY KEY (actor_did, kind, subject_uri, rkey))` — the ledger of repo records **this app wrote**, used for undo
  without scanning the repo. `submission_id` is the comment form's one-time id (P4.20, R3).
- The interaction part of Phase 4's `posts` `CategoryPublisher` (P2.22's one publishing interface; passed in the
  `publishers` map by `web`'s composition root, no registry): for follow, like and comment, `nextBatch(did, direction,
  cursor, written) → {ops[≤200], defer, cursor}` pages the rows below and `finish(tx, did, direction, written)` does the
  ledger and private-row bookkeeping per the `flip` rules. Private videos and Bluesky-post drafts go in `defer` for
  P4.11 review (P2.22 "video path"); which step hosts the `posts` publisher module is settled in P4.00.

Algorithm:
  1. `assertComplete`: for every `Kind` × {private, public} a cell exists; every `repo` cell's collection is covered by
     the requested scope string (`repo:<nsid>` or the permission set for `sh.unset.*`); `like_bsky` and `comment_bsky`
     cells are never `app_db` (a Bluesky author cannot see our app DB, so that would be false privacy); `adr` is not
     the placeholder `"PENDING-P4.01"`. Any failure → throw at boot (fail closed) and fail the test.
  2. `decide(viewerDid, kind)`: `state = privacy.state(viewerDid).posts` (DB read, timeout 2 s; error → throw, the route
     answers 503). If `state` is neither `private` nor `public` (a flip or update running or paused, or
     `waiting_review`) → `refused`. Else return `matrix.cells[kind][state]`.
  3. `nextBatch`, direction `toPublic`, rule `convert`: page `app.private_interaction` rows of the DID for the
     kind (keyset on `id`, 200 per page), map each to a create op for the public cell's collection (record built by the
     owning step's `buildRecord`, validated), return ops. Private follow rows carry no target kind, so the **going-public
     conversion** calls `targetOrigin(subject_did)` per row **at conversion time** and writes `sh.unset.follow` or
     `app.bsky.graph.follow` accordingly (answer 29b). `finish`: insert ledger rows, delete the converted
     private rows, in one transaction. Rule `drop`: delete rows, no ops. Rule `keep_private`: no-op.
  4. `nextBatch`, direction `toPrivate`, rule `convert`: page `app.own_interaction` rows, emit delete ops,
     `finish` inserts private rows and deletes ledger rows in one transaction. Rule `delete`: delete ops only.
  5. Disabled-cell rendering helper: `policyHint(kind, cell) → {disabled: boolean, reasonKey}` for buttons.

Edge cases and failures:
  - Matrix references a collection not in the scope → boot fails (a write would 403 at the PDS for every user). The
    plan's scope string (line 126) now includes `repo:app.bsky.graph.follow` (E21, folded into the plan), and
    `sh.unset.like`, `sh.unset.comment` and `sh.unset.follow` are covered by the permission set (`sh.unset.follow` since
    its first publication, P1.31, answer 29b), so the default passes; a matrix that
    names any other collection still fails the check, which is the intended guard, not a bug to work around.
  - P4.01 not decided → placeholder ADR → boot fails in production config; dev config may set `ALLOW_PENDING_MATRIX=true`
    (dev only; the config loader refuses it when `NODE_ENV=production`).
  - Privacy read fails → 503 for the action, never a guess.
  - Flip batch interrupted mid-page → P2.22 resumes from the stored cursor; `finish` is idempotent (deletes by id,
    inserts with ON CONFLICT DO NOTHING).
  - A like converted to public whose subject was deleted meanwhile → the create still succeeds (a like on a missing
    subject is valid atproto); ingest drops it from counts because the subject is gone.

Threats: where each interaction lives (public repo or private app row).
  - I A private interaction published by a wrong cell or a flip race → complete matrix checked; refused while
    flipping; read error throws (`matrix_missing_cell_fails`, `decide_refuses_while_flipping`,
    `decide_privacy_read_error_throws`).
  - I Interactions surviving erasure → `erasure_covers_policy_tables`.

Done when (tests):
  - `matrix_complete_default_proposal`: the Q2b proposal matrix with a real ADR id passes `assertComplete`.
  - `matrix_missing_cell_fails`, `matrix_bsky_app_db_forbidden`, `matrix_collection_outside_scope_fails`,
    `matrix_pending_adr_fails_in_production`.
  - `decide_returns_cell_per_state`: private and public return the configured cells.
  - `decide_refuses_while_flipping`: both flipping states → refused code.
  - `decide_privacy_read_error_throws`.
  - `flip_to_public_convert_pages_200`: 450 private likes → three pages (200, 200, 50); after commits zero private rows, 450 ledger rows.
  - `flip_to_public_resume_idempotent`: crash after page 1 commit, re-run → no duplicate ledger rows, no double ops.
  - `flip_to_private_convert`: ledger rows → delete ops, then private rows.
  - `flip_to_public_follows_by_target` (answer 29b): two private follow rows, one subject with an `sh.unset.profile` record and one without → one `sh.unset.follow` create and one `app.bsky.graph.follow` create in the batch.
  - `target_origin_rule`: active account with an `sh.unset.profile` record → `ours`; no profile record, or an inactive account → `bsky`; index error → throws.
  - `matrix_follow_cells_split`: the default matrix has `follow_ours` public = `sh.unset.follow` and `follow_bsky` public = `app.bsky.graph.follow`; a matrix with a single `follow` kind fails `assertComplete`.
  - `private_interaction_unique`: second like by the same actor on the same subject is a no-op.
  - `private_interaction_record_shape` (decision 38): every row has `collection`, a TID `rkey` and a `record` that
    passes `lexicon.validate` for that collection; the flip to public writes the repo record with the same rkey.
  - `private_interaction_target_sees_actor` (decision 39): the target's view lists the member's handle with the like,
    comment or follow.
  - `private_interaction_third_party_nothing`: a third viewer's responses (counts, lists, thread, follow state) are
    byte-identical with and without the private row.
  - `private_interaction_never_on_network`: after private like, comment and follow → zero PDS calls, nothing in the
    firehose fixture, no record in the repo, nothing in P3.10 or P4.22a output.
  - `private_targets_notice_once`: first switch to private shows the notice; a second switch does not.
  - `erasure_covers_policy_tables`: P3.07 erasure of actor or subject DID removes rows in both tables (DID registry test sees both columns).
Reuse:
  - Vault decision `social-feed-bluesky-shaped-0x40-canonical` → LESSON: the prototype chose Bluesky-shaped likes and replies; the matrix keeps the shape and adds the privacy dimension it lacked.
  - Prototype has no private interactions → nothing to salvage.
Not in this step: the follow, like and comment routes (P4.18–P4.20); the flip batch runner and switch UI (P2.22); the decision itself (P4.01).
Diagram: see "The privacy matrix as an input" above.

---

### P4.18 — Follows per the P4.01 matrix; Follow button on profiles

Tags: [SEC]            Depends on: P4.17a, P3.12, P3.05, P2.07, P1.17, P1.31 (`sh.unset.follow`)            Plan: §5.4 Follow, §11 Q2b (3) as amended by decision 28 (Alex answer 29b, mixed follows by target), §2 rules 12 and 16
Where: `domains/social/follow`, `interfaces/http/routes/follow` (`POST /follow`, `POST /unfollow`), Follow button in `ProfileView`, ingest handler registration
Size: ~220 source lines, ~280 test lines

Goal: a member follows or unfollows another member from any profile, the follow lives where the matrix says (a
public follow of an unset.sh account is `sh.unset.follow`, of a Bluesky account `app.bsky.graph.follow`; a private
follow is an app-DB row; answer 29b), and counts and "follows you" read both kinds.
Settled by Alex (2026-10-03, answers 26 and 29/29b): a private follow stays inside unset.sh and its target sees
who; a public follow is written by target.

Inputs: `interactionPolicy.decide` and ledger tables (P4.17a); `pds.applyWrites` (P2.07); `idx.record`,
`idx.account`, `ingest.registerCollection` (P3.05); the public route group (P3.12); `rateLimit` bucket `follow` (P1.06);
`withDidLock` (P1.17).
Outputs:
- Ingest registrations for **both** public follow collections, `sh.unset.follow` and `app.bsky.graph.follow` (answer
  29b; same record shape `{subject: did, createdAt}`): promoted columns `follower_did = repo DID`, `subject_did =
  record.subject`, `collection`; index `(follower_did, subject_did)`, `(subject_did)`. Every read path below reads both
  collections, so a follow counts once per (follower, subject) whichever collection holds it.
- `follow.follow(viewerDid, subjectDid) → followed | already | refused(code)`,
  `follow.unfollow(viewerDid, subjectDid) → unfollowed | not_following | refused(code)`,
  `follow.state(viewerDid, subjectDid) → {following: boolean, private: boolean}`,
  `follow.counts(did, viewerDid?) → {followers, following, privateFollowers?}`, `follow.isFollowable(did) → boolean`.
- Routes: `POST /follow`, `POST /unfollow` with fields `subject` (DID) and `return` (path; P1.09 validator).

Algorithm (`POST /follow`):
  1. CSRF gate (P1.07) has run. Session: none → re-render the profile page with a sign-in link (plan §5.4: signed-out
     viewer gets the page back), status 200, no redirect off-origin.
  2. Validate `subject` as a DID (syntax) → bad → `303 return?error=follow.invalid`.
  3. `subject = viewer` → `follow.self`.
  4. Rate limit `follow` per DID (30/minute) and per salted IP hash → `follow.rate_limited`. This step sets `follow`
     to these values in `interfaces/http/limits.ts` (P1.06p; feature code, not trusted base: SE-6 as updated, plan `6275827`).
  5. `isFollowable(subject)`: account indexed, active, not delisted, and **either** privacy switch public (profile
     published, or "Posts and follows" public; R2) → else `follow.unavailable`. A member with a private profile and
     public posts has videos in feeds, so they must be followable for the Following tab to include them. DB error → 503 page.
  6. `kind = targetOrigin(subject) = 'ours' ? 'follow_ours' : 'follow_bsky'` (P4.17a; error → 503 page);
     `cell = decide(viewer, kind)` → refused → `social.privacy_flip_in_progress`; `disabled` → its reason code.
  7. Steps 7–9 run inside `withDidLock(viewer, …)` (P1.17; R3), so two clicks by the same member are serialized and
     the second sees the first's ledger row. `LockError` → `303 return?error=social.busy`, nothing written.
     Already following? `repo` cell: ledger row `(viewer, follow, subject)` exists, or an `idx.record` follow by
     viewer → subject exists **in either follow collection** → `already` (no write; a target that changed origin keeps
     its existing record). `app_db` cell: private row exists → `already`.
  8. `repo` cell: build `{$type: collection, subject, createdAt: now}`; `lexicon.validate`; `applyWrites` create (rkey new
     TID; timeout 8 s).
     - success → insert ledger row `(viewer, follow, subject, uri, rkey)`; `303 return?followed=1`.
     - `PdsTimeout`/`PdsTransient`/`PdsRateLimited` → no ledger row; `303 return?error=pds.unavailable`. (A timeout may
       have written the record; the next follow attempt finds it via ingest or the ledger reconciler in step U4.)
     - `PdsAuthLost` → `303 return?error=auth.reconnect`. `PdsRejected` → `follow.rejected`.
  9. `app_db` cell: insert private row (ON CONFLICT DO NOTHING) → `303 return?followed=1`.
  10. `return` failing the return-path validator → use `/@<subject handle>`.

Algorithm (`POST /unfollow`):
  U1. Steps 1–4 as above (no followable check: you may always unfollow). U2–U4 run inside `withDidLock(viewer, …)`.
  U2. Delete any private row `(viewer, follow, subject)`.
  U3. Collect repo records to delete: ledger rows for `(viewer, follow, subject)` ∪ `idx.record` follows by viewer
      with that subject in **both** `sh.unset.follow` and `app.bsky.graph.follow` (records written by other clients,
      or before the target's origin changed). Bounded: at most 20 rkeys (duplicates from other clients);
      more → delete the first 20 and log `follow.duplicates_capped`.
  U4. If any: one `applyWrites` with delete ops (only rkeys in the viewer's own repo and one of the two follow
      collections; anything else is skipped). Success → delete ledger rows. Errors as in step 8. If none: `not_following`.
  U5. `303 return?unfollowed=1`.

Read paths:
  - `state(viewer, subject)`: own data first (rule 12): ledger and private rows (app DB), then `idx.record` for records
    written elsewhere.
  - `counts(did)`: followers = distinct `follower_did` in index follows with `subject_did = did`, joined to
    `idx.account` active and not delisted; following = same by follower. `privateFollowers` (only when
    `viewerDid = did`) = the private rows with `subject_did = did`, returned **with each follower's handle** (decision
    39, ADR 0006: `targetSeesActor` is always true), shown to the target inside unset.sh only as "<name> follows you";
    for any other viewer the field is absent and every response is identical to having no private follower.
  - Follow button: server-rendered `<form method=post action=/follow>` with a hidden `subject` and `return`; zero JS on
    `/@handle`. Disabled cell → the button is rendered disabled with the reason text beside it (not a tooltip). The
    post page also shows the button when the member's posts are public and their profile is private (R2, answered by
    decision 37, Alex 2026-10-04 13:50Z, ADR 0004; R3-04). Such a member's public posts show under the bare handle on
    the post page `/@alice/p/{rkey}` (P3.12 step 9), in feeds and in the read API, and Follow lives on that post page.
    `/@alice` stays the `unavailable` 404 (D7). The earlier stop for P4.00 is removed. `isFollowable` may differ
    between this member and an unknown handle, because the public posts already show the account ("whatever another
    app can show, we show too").

Edge cases and failures:
  - Subject is delisted or suspended after the follow → kept in the repo (the user's data), hidden from counts.
  - Two clicks race → serialized by `withDidLock(viewer)`; the second finds the ledger row → `already`. Duplicates
    written by other clients are still tolerated: unfollow deletes them all (U3), counts use distinct follower.
  - Private profile, public posts → followable from the post page (R2; decision 37). Both switches private →
    `follow.unavailable`, and no page shows a Follow form for them.
  - Lock wait over 10 s (P1.17 default) → `social.busy`; the member clicks again.
  - Foreign-PDS viewer (Q13) → same path; their PDS receives the write.
  - Accepted cost (plan decision 28): Bluesky's app does not show `sh.unset.follow` follows, so Bluesky's follower
    counts and its `getTimeline` omit unset.sh-to-unset.sh follows (P4.21 notes the effect).
  - The subject creates or deletes its `sh.unset.profile` record later → existing follow records stay as written;
    reads and unfollow cover both collections.
  - Follow record from another client with a non-DID subject → ingest validation drops it (P3.05).
  - The privacy switch flips during the request → step 6 refuses; P2.22's batch converts existing rows.

Threats: follows written to repositories and the app database.
  - T Deleting another account's records on unfollow → foreign rkeys never deleted (`unfollow_skips_foreign_rkeys`).
  - I Private followers shown to others → target only, with the follower's name (decision 39); others get nothing (`follow_private_followers_only_for_target`).
  - S Open redirect through `return` → same origin only (`follow_return_path_rejects_offorigin`).
  - D Follow spam → rate limit (`follow_rate_limited`).

Done when (tests):
  - `follow_public_writes_repo_and_ledger`: public cell → one `applyWrites` create with collection from the matrix; ledger row present; no private row.
  - `follow_public_by_target` (answer 29b): a public viewer follows an account with an `sh.unset.profile` record → the create is `sh.unset.follow`; follows a Bluesky-only account → `app.bsky.graph.follow`.
  - `follow_origin_changed_already`: an `app.bsky.graph.follow` exists for a subject that has since created an `sh.unset.profile` record → `already`, no second record; unfollow deletes the existing one.
  - `follow_counts_both_collections`: one follower via each collection plus one duplicate across both → followers = 2.
  - `follow_private_writes_app_db_only`: private cell → zero PDS calls; one private row.
  - `follow_disabled_cell_refused`: matrix variant with `disabled` → reason code; no writes.
  - `follow_self_refused`, `follow_invalid_subject`, `follow_unfollowable_inactive`, `follow_unfollowable_delisted`, `follow_unfollowable_both_private`.
  - `follow_followable_profile_private_posts_public` (R2; decision 37): `/@alice/p/<rkey>` for a member with a private
    profile and public posts renders the Follow form and following succeeds; `/@alice` renders the `unavailable` 404
    with no Follow form.
  - `follow_double_click_one_record` (R3): two concurrent `POST /follow` by one viewer → one `applyWrites`, the second answers `already`.
  - `follow_lock_timeout_busy`: lock held elsewhere past the wait → `social.busy`, no PDS call.
  - `follow_idempotent_via_ledger` and `follow_idempotent_via_index`: second follow → no write.
  - `follow_never_scans_repo`: PDS stub fails the test on any `listRecords` call.
  - `unfollow_deletes_all_duplicates`: three index records + one ledger row → one `applyWrites` with three deletes (ledger row's rkey included once).
  - `unfollow_skips_foreign_rkeys`: an index row whose URI DID is not the viewer → never in the delete ops.
  - `follow_pds_timeout_no_ledger`, `follow_auth_lost_keeps_session`.
  - `follow_rate_limited`: 31st follow in a minute → `follow.rate_limited`.
  - `follow_signed_out_gets_page_back`: no session → 200 profile page with sign-in link; no `Location` header.
  - `follow_return_path_rejects_offorigin`: `return=//evil.example` → redirect to `/@handle`.
  - `follow_counts_exclude_inactive_followers` and `follow_private_followers_only_for_target` (decision 39): the target sees `privateFollowers` with the follower's handle; a third viewer's response is identical to one with no private follow.
  - `follow_private_never_on_network` (decision 39): a private follow → zero PDS calls, nothing in the firehose fixture or the repo.
  - `follow_profile_zero_js`: `/@handle` with the button still has zero `<script>`.
Reuse:
  - `app/src/lib/graph.ts:313-370` (`listOwnFollows` scans up to 5,000 records per click and throws past that) → REJECT: the same scan defect as likes (§2 defect 3); undo uses the ledger and the index.
  - `app/src/lib/graph.ts:358-370` (unfollow deletes every duplicate) → LESSON, provisional — for reuse review: keep the behaviour, bounded.
  - `app/src/actions/follows.ts:262-277` (DID validation, self-follow refusal, followable check) → LESSON, provisional — for reuse review; its per-action `requireTrustedOrigin` (`:220-227`) → REJECT: one CSRF gate (§2 rule 14).
  - `appview/src/db.ts:123-139` (monotonic follow upsert, stale-delete guard) → LESSON (P3.05 owns the guard).
Not in this step: follower lists UI and "follows you" notifications (no notification inbox in core, plan §4); blocks and mutes (not in plan scope); the flip batch (P2.22 with P4.17a contributors); the directory (P3.14).
Diagram: none.

---

### P4.19 — Likes keyed on URI, not CID; foreign likes ignored; counts survive edits

Tags: [SEC]            Depends on: P4.17a, P3.05, P2.07, P1.17            Plan: §2 defects 1 and 3, §5.2 ingest rule 4, §11 Q2b
Where: `domains/social/like`, `interfaces/http/routes/like` (`POST /like`, `POST /unlike`), like button in post views (island in feeds, form on permalinks), ingest registration
Size: ~220 source lines, ~300 test lines

Goal: members like and unlike posts with counts that never reset on an edit and never break on a large like collection.
Settled by Alex (2026-10-03, answers 26, 27, 28): a private like stays inside unset.sh and the author sees who; a
private account cannot like Bluesky posts (disabled with a one-line reason).

Inputs: P4.17a policy and tables; P3.05 ingest with the like filter; `pds.applyWrites` (P2.07); our post NSIDs from
P4.02 (`sh.unset.video` and the comment type when it is a repo record).
Outputs:
- Ingest registration `sh.unset.like` (likes on our posts, plan §5.8; this step creates `idx.like`): keep only if
  `subject.uri` parses as `at://<did>/<our post NSID>/<rkey>` (P3.05's filter; this step supplies the NSID list).
  `app.bsky.feed.like` is not ingested at all (likes on Bluesky posts are counted by the AppView). Promoted `actor_did`, `subject_uri`, `subject_did`; index
  `(subject_uri)`, `(actor_did, subject_uri)`. `subject.cid` is stored in the record JSON only, **never** a key or filter.
- `like.like(viewer, target: {uri, cid, origin: 'ours' | 'bsky'}) → liked | already | refused(code)`,
  `like.unlike(viewer, target: {uri, viewerLikeUri?}) → unliked | not_liked | refused(code)`,
  `like.counts(uris[≤50], viewer?) → Map<uri, {count, viewerLiked, privateCount?, privateLikers?}>` (`privateLikers`:
  handles, author only, decision 39).

Algorithm (`POST /like`):
  1. Session required (else sign-in redirect to the same page). Rate limit `like` per DID (120/minute).
  2. Parse `subject_uri` (AT-URI) and `subject_cid` (CID syntax). Bad → `like.invalid`.
  3. Origin: collection in our post NSIDs → `ours`; `app.bsky.feed.post` → `bsky`; anything else → `like.invalid`.
  4. `ours`: subject must exist in `idx.record` (current row, any CID) and its author account active and not delisted →
     else `like.unavailable`. The strongRef written uses the **current** indexed CID (the client's CID is ignored), so
     the record names the version the viewer saw last.
     `bsky`: the client's `{uri, cid}` is used as given (the AppView handed it to us); syntax only.
  5. `cell = decide(viewer, origin === 'ours' ? 'like_ours' : 'like_bsky')`. Refused/disabled → code.
  6. Steps 6–8 run inside `withDidLock(viewer, …)` (P1.17; R3); `LockError` → `social.busy`, nothing written.
     Already liked? `ours` + repo cell: ledger row or index row `(viewer, subject_uri)` → `already`. `bsky`: the form
     carries the hydrated `viewer.like`; non-empty → `already`. `app_db` cell: private row exists → `already`.
  7. `repo` cell: record `{$type: <the cell's collection: 'sh.unset.like' for ours, 'app.bsky.feed.like' for bsky>, subject: {uri, cid}, createdAt}` → `lexicon.validate` →
     `applyWrites` create (timeout 8 s). Success → ledger row. Errors as P4.18 step 8.
  8. `app_db` cell: insert private row `(viewer, like_ours, subject_uri, subject_did)`.
  9. Respond: island request (`Accept: application/json`) → `{liked: true, count}`; form → `303` back.

Algorithm (`POST /unlike`):
  U1. As steps 1–3. U2–U4 run inside `withDidLock(viewer, …)`.
  U2. Delete private row if any.
  U3. rkeys to delete: ledger rows `(viewer, like, subject_uri)` ∪ index likes `(viewer, subject_uri)` (`ours`) ∪, for
      `bsky`, `viewerLikeUri` from the form **only if** its DID equals the viewer and its collection is
      `app.bsky.feed.like` (for `ours` the collection is `sh.unset.like`). Cap 20.
  U4. One `applyWrites` of deletes; success → delete ledger rows. None found → `not_liked`.

Counts (`like.counts`): one statement for up to 50 URIs:
  `count(DISTINCT actor_did)` from index likes `WHERE subject_uri = ANY($1)` joined to `idx.account` active and not
  delisted, grouped by `subject_uri`; viewer flag from ledger ∪ index ∪ private rows. `privateCount` and
  `privateLikers` (the members' handles) only for the author (`subject_did = viewer`; decision 39, ADR 0006, shown as
  "<name> liked this" inside unset.sh only); for anyone else both are absent and the response is identical to no
  private like. Bluesky posts never use this: their counts
  and `viewer.like` come hydrated from the AppView.

Edge cases and failures:
  - Post edited (new CID) → counts unchanged (counted by URI); a like naming the old CID still counts.
  - Post deleted → likes stay in index (they are the likers' records) but the post is not rendered; counts unused.
  - A member's repo holds 10,000 Bluesky likes → ingest drops them all; like toggles never list the collection; nothing throws.
  - A like whose subject is our NSID but whose DID is unknown to the index → indexed (cheap), counted only once the post is indexed.
  - Like by a deactivated actor → excluded from counts; reappears if reactivated.
  - Duplicate likes from other clients → count distinct actors; unlike removes all (cap 20).
  - Double-click on Like → serialized by `withDidLock(viewer)`; one record, the second answers `already`.
  - Forged `viewerLikeUri` pointing at another repo → skipped (U3).

Threats: likes and their counts.
  - T Forged likes removed or counted → foreign subjects dropped; forged viewer likes skipped
    (`like_foreign_subject_dropped_at_ingest`, `unlike_forged_viewer_like_skipped`).
  - I Private likers revealed → author only, with names (decision 39); others get nothing (`like_private_count_only_for_author`).
  - D Like spam → rate limit (`like_rate_limited`).

Done when (tests):
  - `like_counts_survive_edit` (regression, §2 defect 1): index post at CID A, two likes naming A; upsert the post at CID B → count 2, viewer flag true.
  - `like_counts_by_uri_not_cid_query_shape`: `EXPLAIN` of the counts statement uses the `(subject_uri)` index and the SQL text has no `subject_cid`.
  - `like_foreign_subject_dropped_at_ingest` (regression, §2 defect 3): an `app.bsky.feed.like` of any subject, and an `sh.unset.like` whose subject is an `app.bsky.feed.post` → not in the index.
  - `like_ours_is_sh_unset_like`: a public like on our video writes an `sh.unset.like` record (plan §5.8).
  - `like_toggle_with_5001_bsky_likes` (regression, §2 defect 3): PDS stub repo with 5,001 `app.bsky.feed.like` records; like and unlike of our post succeed; `listRecords` never called.
  - `like_uses_current_cid`: client sends stale CID → written strongRef uses the indexed CID.
  - `like_bsky_disabled_when_private` (proposal cell) and `like_bsky_public_writes_repo`.
  - `like_ours_private_app_db_only` and `like_private_count_only_for_author` (decision 39): the author sees `privateCount` and the likers' handles; a third viewer's response is identical to one with no private like; no actor DID in any response; nothing in the firehose fixture or the repo.
  - `like_idempotent`, `unlike_removes_duplicates`, `unlike_forged_viewer_like_skipped`.
  - `like_double_click_one_record` (R3): two concurrent likes by one viewer → one `applyWrites`.
  - `like_unavailable_for_delisted_author`, `like_counts_exclude_inactive_actor`.
  - `like_counts_single_query_for_50`: query counter = 1 for 50 URIs (budget ≤5 queries per request).
  - `like_rate_limited`, `like_pds_errors_mapped` (timeout, transient, auth lost, rejected).
Reuse:
  - `app/src/lib/social-interactions.ts:142-205` (`listOwnLikes` scans the collection on every toggle, throws at `:164` past 5,000) → REJECT: §2 defect 3.
  - `appview/src/db.ts:178-199` (`getPostSocial` counts `WHERE subject_uri = ? AND subject_cid = ?`) → REJECT: §2 defect 1.
  - `appview/src/ingest.ts:170-181` (indexes every like, no subject filter) → REJECT: §2 defect 3.
  - `appview/src/db.ts:172-177` (`deleteLikesForDid` removes likes by and on the DID) → LESSON, provisional — for reuse review: erasure in both directions (P3.07 covers it by the registry).
  - `app/src/lib/social-interactions.ts:126-140` (`parsePostRef`: lexicon-validate the ref, then check the NSID) → LESSON, provisional — for reuse review.
  - `appview/test/db.test.ts:123` ("counts current-CID likes") → REJECT: the test asserts the defect; P4.28 keeps its inverse.
Not in this step: notifications of likes (no inbox in core); like lists ("who liked this"; not in plan scope); Bluesky like counts (hydrated by the AppView).
Diagram: none.

---

### P4.20 — Comments with the correct reply root

Tags: [SEC] [MOD]            Depends on: P4.17a, P3.05, P2.07, P4.11, P4.13, P1.17            Plan: §2 defects 1 and 2, §5.8 review and "restores the user's OAuth session server-side", §11 Q2b, P4.01 comment record type
Where: `domains/social/comment`, `interfaces/http/routes/comment` (`POST /comment`, `POST /comment/delete`), comment list on the permalink and in the feed item, ingest registration
Size: ~300 source lines, ~340 test lines

Goal: members comment on posts and on comments, every reply carries the thread's real root, and threads and
counts are keyed on URIs so edits never orphan them.
Settled by Alex (2026-10-03, answers 26 and 28): a private comment stays inside unset.sh and the author sees who; a
private account cannot reply to Bluesky posts (disabled with a one-line reason).

Inputs: P4.17a (matrix: `comment.type`, `comment.review`, cells `comment_ours`, `comment_bsky`); P4.02 comment
lexicon; P3.05 ingest; P2.07 `applyWrites` and `pds.call('app.bsky.feed.getPosts')` (scope `rpc:…getPosts`, §3);
P4.11 `review.submit` with `ReviewJob` kind `comment` (text only: no image gate; the local P4.09a text gate, then
`route`; R4; nothing is sent to Claude, answers 30 and 30b) when `comment.review = before_publish` (the default,
decided by Alex in answer 30); P4.13 appeals; `pdsAgentFor` (P2.07); `withDidLock` (P1.17).
Outputs:
- Ingest registration for `sh.unset.comment` (plan §5.8): promoted `author_did`, `root_uri` (= the record's `subject.uri`),
  `parent_uri` (= `parent.uri` or null), `created_at`; indexes `(root_uri, created_at, uri)`, `(parent_uri)`.
- Table `app.pending_comment(id, did, target_uri, root jsonb, parent jsonb, text, review_job_id, state, rkey NULL,
  needs_reauth bool, waiting_since timestamptz NULL, submission_id uuid, updated_at)` (only used when review is `before_publish`), with `state ∈ reviewing
  | unsure | blocked | appealed | appeal_upheld | approved | published | publish_failed | blocked_by_privacy | expired
  | matched_hold` (`matched_hold`: P4.07's suspected-abuse path on a text-gate S4, answer 30c; the text is sealed into
  the hold and overwritten here)
  (part 1's names). DID column registered.
- Every comment form carries a one-time `submission_id` (random, rendered server-side) used to make a double submit
  idempotent (R3).
- `comment.create(viewer, parent: {uri, cid?}, text) → created(uri) | pending(id) | refused(code)`,
  `comment.delete(viewer, uri) → deleted | not_found`, `comment.thread(rootUri, viewer, cursor) → {items[≤50], cursor}`,
  `comment.counts(rootUris[≤50]) → Map<uri, count>`, `computeReplyRef(parent) → {root, parent}`.

Algorithm (`computeReplyRef(parent)`), the core of defect 2:
  1. Our-side parent (collection is one of our post NSIDs or the comment type): read the **current** row from
     `idx.record` by `parent.uri` (own comments not yet indexed: read the ledger/PDS per rule 12 via
     `pds.call('com.atproto.repo.getRecord')`, timeout 3 s). Not found → `comment.parent_unavailable`.
  2. Bluesky parent: `pds.call('app.bsky.feed.getPosts', {uris: [parent.uri]})` (timeout 4 s). Missing or blocked view →
     `comment.parent_unavailable`; `PdsTimeout`/`PdsTransient` → `pds.unavailable`.
  3. `parentRef = {uri: parent.uri, cid: <current CID from step 1 or 2>}` (client CID ignored).
  4. If the parent record is itself a comment or reply → `root` = its stored root exactly as stored (`subject` of an
     `sh.unset.comment`, `reply.root` of an `app.bsky.feed.post`);
     else → `root = parentRef`. Never take `root` from the client.
  5. Sanity: `root.uri` must be one of our post NSIDs for an our-side thread, or `app.bsky.feed.post` for a Bluesky
     thread; mismatch (a crafted record) → `comment.parent_unavailable`.
  6. Record shape (editor pass, plan §5.8): on our side the record is `sh.unset.comment {subject, parent?, text, langs?,
     createdAt}` with `subject = root` (always the video) and **one level of replies**: replying to the video gives no
     `parent`; replying to a top-level comment gives `parent = parentRef`; replying to a reply gives `parent` = that
     reply's own `parent` (the top-level comment), so depth never exceeds one. A Bluesky thread keeps the
     `app.bsky.feed.post` `reply: {root, parent}` of steps 1–5. The optional Bluesky twin reply when the video was also
     posted to Bluesky (plan §5.8, opt-in) is left to P4.00.

Algorithm (`POST /comment`):
  1. Session; rate limit `comment` per DID (20/minute) and per IP hash (this step adds `comment` to
     `interfaces/http/limits.ts` (P1.06p; feature code, not trusted base: SE-6 as updated, plan `6275827`)).
  2. Text: NFC; graphemes 1..limit (1,000 for `sh.unset.comment`, 300 for `app.bsky.feed.post`) → `comment.empty` / `comment.too_long`.
  3. Origin of the thread: ours or bsky (by parent collection). Ours: root author active and not delisted, root post
     playable/visible → else `comment.unavailable`.
  4. `cell = decide(viewer, origin === 'ours' ? 'comment_ours' : 'comment_bsky')` → refused/disabled → code.
  5. `{root, parent} = computeReplyRef(parent)`.
  6. `app_db` cell: private row `(viewer, comment_ours, subject_uri = root.uri, subject_did = root author, body = text)`
     plus `parent_uri` in the body JSON; shown per `visibleTo`. Done.
  7. `repo` cell, `comment.review = before_publish`: inside `withDidLock(viewer, …)`, a `pending_comment` with this
     `submission_id` already exists → answer it again; else insert `pending_comment` (`state = reviewing`) and
     `review.submit({kind: 'comment', did, pendingCommentId, text})`; answer `pending`; the comment shows to its author
     only, marked "in review". On decision: `pass` → `approved`, then step 8 from `web`'s job runner with no user
     present: `pdsAgentFor(did)` restores the session server-side (plan §5.8); `NeedsReauth` → stays `approved` with
     `needs_reauth`, `waiting_since` and a "Sign in to publish" link (30 days later P4.25 drops it, E22); re-check privacy and parent existence first (parent gone →
     `publish_failed`, `comment.parent_unavailable`); `fail` → `blocked` with reason and appeal (P4.13: `appealed` →
     `approved` or `appeal_upheld`); `unsure` → `unsure`, a person decides (P4.12; self-harm holds show the author
     9-8-8 resources); suspected (text-gate S4) → `matched_hold`, P4.07's emergency path, nothing published.
  8. `repo` cell, write, inside `withDidLock(viewer, …)` (R3): a ledger row with this `submission_id` exists → answer
     its URI again (double submit), no write. Else record per type (`{$type, text, reply: {root, parent}, createdAt,
     langs}`) → `lexicon.validate` → `applyWrites` create (rkey chosen once and stored before the call, timeout 8 s) →
     ledger row `(viewer, comment, root.uri, uri, rkey, submission_id)`. Errors as P4.18.
  9. Island → `{uri, pending?}`; form → `303` to the permalink with `#c-<rkey>`.

`POST /comment/delete`: the URI's DID must equal the viewer and its collection the comment type → `applyWrites` delete;
private comments → delete row by `(id, actor_did)`. Pending → delete row and cancel nothing (a late decision is a no-op).

`comment.thread(rootUri)`: `idx.record` comments with `root_uri = rootUri`, authors active and not delisted, ordered
`(created_at, uri)`, keyset cursor, 50 per page; each item carries `parent_uri` so the view can say "replying to
@handle" (handle from `verifyHandle`) or "replying to a deleted comment" when the parent is gone. Private comments are
merged in only for the viewer who wrote them or the root's author (per `visibleTo`), labelled "only you and the
author can see this". `comment.counts` counts by `root_uri` only.

Edge cases and failures:
  - Reply to a reply to a reply → root stays the original post (depth irrelevant).
  - Parent deleted between view and submit → `comment.parent_unavailable`.
  - Root edited (new CID) → thread and counts unchanged (keyed on `root_uri`).
  - Crafted parent record whose `reply.root` points to an unrelated post → step 5 refuses when the NSID class
    mismatches; when it matches, the thread is the crafted root's (same as Bluesky's behaviour; not exploitable for
    visibility because every item is still gated on its author's state).
  - Bluesky parent hidden by a block (`blockedPost` view) → `comment.parent_unavailable`.
  - Viewer flips to private while a comment is pending → on pass, privacy re-check fails → pending row stays
    `blocked_by_privacy`, nothing written, author told.
  - Double submit of the same form → one record (the `submission_id` check inside the lock).
  - Session revoked between the pass and the write → `approved` with `needs_reauth`; nothing written.
  - Comment text with markup → rendered as text (React escaping; no markdown in comments).

Threats: comments: member text shown to others.
  - T A client-chosen root moves a reply into another thread → root never from the client
    (`reply_root_never_from_client`).
  - I A private comment seen by a third person → author and commenter only
    (`comment_private_cell_visible_to_author_and_commenter_only`).
  - E Deleting others' comments, or publishing before review → own only; review first (`comment_delete_only_own`,
    `comment_review_before_publish_pending_then_pass`).
  - D Comment floods → limits and rate limit (`comment_limits`, `comment_rate_limited`, `comment_thread_bounded`).

Done when (tests):
  - `reply_root_top_level`: parent = video → `subject` = video strongRef, no `parent`.
  - `reply_root_reply_to_reply` (regression, §2 defect 2): parent is a comment on video V → new record's `subject.uri = V` and `parent.uri` = the top-level comment (one level, step 6).
  - `reply_root_never_from_client`: form field `root` present → ignored.
  - `reply_root_bsky_parent_via_getPosts`: Bluesky reply parent with root R → root R; getPosts timeout → `pds.unavailable`.
  - `thread_survives_root_edit` (regression, §2 defect 1): root re-indexed at a new CID → all comments still listed, count unchanged.
  - `comment_counts_by_root_uri`: three nested comments → count 3 for the root.
  - `comment_parent_deleted_shows_placeholder`.
  - `comment_private_cell_visible_to_author_and_commenter_only` (decision 39): the author sees the text with the commenter's name; a third viewer's thread and counts are identical to having no private comment; nothing in the firehose fixture or the repo.
  - `comment_bsky_disabled_when_private`.
  - `comment_review_before_publish_pending_then_pass` / `_fail` / `_unsure` / `_privacy_changed`.
  - `comment_review_none_writes_immediately` (matrix variant).
  - `comment_review_job_text_only` (R4, answer 30): the job is `{kind: 'comment', …}`; no image gate runs; the first job is `text_gate`, then `route`; the net-guard mock records zero requests (nothing to Claude).
  - `comment_s4_suspected`: the text gate returns S4 → `pending_comment.state = matched_hold`, its text overwritten after the sealed copy verifies, P4.07 path started, nothing written to any repo.
  - `comment_pass_restores_session_server_side` and `comment_revoked_grant_sign_in_to_publish`.
  - `comment_double_submit_one_record` (R3): two concurrent POSTs with one `submission_id` → one `applyWrites` (or one pending row).
  - `comment_appeal_states`: `blocked` → `appealed` → `approved` writes once; `appeal_upheld` writes nothing.
  - `comment_type_variants`: the create test for `sh.unset.comment` on our posts and for an `app.bsky.feed.post` reply on a Bluesky post.
  - `comment_one_level_of_replies`: a reply to a reply on our side → `subject` is the video and `parent` is the top-level comment.
  - `comment_delete_only_own`, `comment_limits`, `comment_rate_limited`, `comment_unavailable_delisted_root`.
  - `comment_thread_bounded`: 120 comments → pages of 50, 50, 20; one query per page.
Reuse:
  - `app/src/actions/social.ts:73-80` (`reply: {root: subject, parent: subject}`) → REJECT: §2 defect 2.
  - `appview/src/db.ts:107-121, 184-193` (replies and reply counts matched on `parent.uri` **and** `parent.cid` with `json_extract`) → REJECT: §2 defect 1 and unindexable JSON filters.
  - `app/src/actions/social.ts:67-71` (grapheme count with `Intl.Segmenter`) → LESSON, provisional — for reuse review.
Not in this step: comment edits (comments are create and delete only); media in comments; notifications; moderation of comments after publish (report button, P4.24).
Diagram: none.

---

### P4.21a — Bluesky pictures through our media server (fetch, verify, fingerprint, re-encode, serve)

Tags: [SEC] [MOD]            Depends on: P3.09, P2.16, P2.16b, P2.17, P2.01, P1.18a, P4.07 (the labels step is a soft link only: until labels land, P4.21's "any label → hide" applies; the editor pass of 2026-10-04 removed it from this list because it closed a cycle through P4.21)            Plan: §2 rule 9 (never raw `getBlob` to browsers), §5.2 media proxy, §5.8 "Fingerprints" (every picture the app processes); Alex 16:41Z, P4b-E5 option C (answer 33; plan change relayed by the coordinator); vault note `atproto-blob-serving-security`
Where: `interfaces/media/routes/bsky-image.ts`, `domains/content/media/bsky-image.ts` (URL minting in `web`, fetch and verify in `media`), the `bsky-cache/` object prefix and its lifecycle rule; tests beside them
Size: ~260 source lines, ~300 test lines

Goal: show the pictures of Bluesky posts in the Following and feed tabs (P4.21, P4.22) without the viewer's browser
ever contacting Bluesky: `media` fetches the blob server-side, proves it is the blob the post names, checks its
fingerprint, re-encodes it without metadata and serves it from our media origin under the mandatory sandbox headers.
Reason for the letter suffix: it extends P3.09's media entrypoint with a new outbound fetch and is needed by P4.21;
keeping it out of P4.21 keeps both near one PR.

Inputs: P3.09 `mediaHeaders()` and the media entrypoint; P2.01 `resolveDid(did) → {pdsEndpoint}`; P1.18a
`guardedFetch('public', …)` (no redirects, size cap, pinned DNS); P2.16 `FingerprintCheck` and P2.16b PDQ; P2.17
`encodeImage` in the bounded decode worker; P4.07 `onMatch`; P4.23 `moderation.decide`; a `web` HMAC key for the URLs
(P2.19's scheme, new purpose `bsky_img`).
Outputs:
- `bskyImage.url(did, cid, size: 'thumb' | 'full') → string` (in `web`): `https://<media>/x/<did>/<cid>/<size>.webp?exp=<exp>&kid=<kid>&sig=<sig>`,
  signed with P2.19's message format (purpose `bsky_img`, object key `bsky/<did>/<cid>/<size>`), TTL 1 hour. `web` mints a URL only for a CID that the post or
  profile view it is rendering names (`embed.images[].image.ref`, the `recordWithMedia` images, an `external.thumb`,
  or the avatar CID parsed from the AppView avatar URL with a strict `/<did>/<cid>@` pattern; anything else → no
  image), and only after `moderation.decide` allowed the item: `hide` → no URL; `warn` → the URL sits behind the
  warning interstitial (blurred until the viewer opens it). So `media` is never an open proxy for arbitrary blobs.
- Route `GET|HEAD /x/{did}/{cid}/{size}.webp` on the media domain.
- Object prefix `bsky-cache/<cid>/<size>.webp` with a lifecycle rule deleting objects after 24 hours; no DID in the key.
- Table `app.bsky_image_state(cid pk, verdict ok | refused, reason, checked_at)` (no DID; the `media` role gets
  select/insert/update on it and nothing else new, P1.12 grant matrix; rows older than 24 h deleted by the same
  sweeper) so a refused CID is not re-fetched for an hour.

Algorithm (route, `media`):
  1. Verify the MAC, purpose and expiry (constant-time); bad or expired → `403`, `mediaHeaders()`, no fetch. Validate
     `did` (`@atproto/syntax`), `cid` (CIDv1, raw codec `0x55`, sha2-256; anything else → `400`), `size`.
  2. Cache hit at `bsky-cache/<cid>/<size>.webp` → stream it (step 9). **A cache hit is not checked again** (it was
     checked when it was made, and the bytes are bound to the CID).
  3. `bsky_image_state` says `refused` within the last hour → `404` (no re-fetch).
  4. Fetch the original from the **author's own PDS**: `resolveDid(did)` → `pdsEndpoint`; `guardedFetch('public',
     {url: <pdsEndpoint>/xrpc/com.atproto.sync.getBlob?did=<did>&cid=<cid>, timeoutMs: 5000, maxBytes: 2_000_000,
     redirects: none})`. Only `200` with a body is used; 3xx, 4xx, 5xx, timeout or the cap → `502` (failure cached
     for 60 s in memory, not in the table). Our own PDS is reached through the `public` policy's internal-host
     exception. **Why the PDS and not `cdn.bsky.app`:** the CDN serves Bluesky's own re-encode, which cannot be checked
     against the CID; the PDS serves the exact blob, so step 5 proves the bytes are the ones the post names whatever
     host the DID document points at (the endpoint is self-asserted, the CID is not). No request carries any viewer
     data: no cookie, no `X-Forwarded-For`, no viewer address or user agent (our fixed `User-Agent` only).
  5. Hash the bytes (sha2-256) and compare with the CID's digest; mismatch → `502`, `bsky_image_state = refused`
     (`cid_mismatch`).
  6. Sniff the type from the bytes (JPEG, PNG, WebP, GIF first frame only; anything else → refused,
     `unsupported_type`); decode in P2.17's bounded worker (pixel limit, time limit).
  7. **Fingerprint (Alex's rule: every picture the app processes):** PDQ on the decoded image (P2.16b), then
     `FingerprintCheck.check([pdq])` (fake until P5.07b; real Arachnid Shield after). `match` → never served:
     `bsky_image_state = refused` (`match`), and P4.07 `onMatch({subjectKind: 'image', subjectRef: 'bsky:<did>/<cid>',
     did, result})` runs the image hold path (P5.07b's, sealing the bytes in `media` with `sealToStream`; no
     transmission data exists, the uploader is not our member unless the DID is ours, and the freeze applies only to a
     member). `unavailable` → `503`, not cached (fail closed: nothing unchecked is served).
  8. Re-encode with `encodeImage(bytes, {maxEdge: 320 (thumb) | 1600 (full), formats: [webp], maxBytes: 300 KB})`,
     metadata stripped; write `bsky-cache/<cid>/<size>.webp`; `bsky_image_state = ok`.
  9. Serve: `mediaHeaders()` (`default-src 'none'; sandbox`, `nosniff`), `Content-Type: image/webp` from our encode
     only, `Cache-Control: public, max-age=3600` (short, so a takedown upstream ages out within the 24-hour cache),
     ETag `"<cid>-<size>"`, `Cross-Origin-Resource-Policy: cross-origin`, no `Set-Cookie`.
  10. Takedown and labels: a post or account Bluesky takes down disappears from the AppView, so no new URL is minted;
     our labeler's `!takedown` (P4.23) stops minting at once; the cache expires within 24 h. A moderator can purge one
     CID (`media.purge({cid})`, P3.09) from `admin`.

Edge cases and failures:
  - A DID document whose PDS endpoint points at a private address → `guardedFetch` refuses (`egress.*`); `502`.
  - A huge or slow blob → the 2 MB cap and 5 s timeout end it; `app.bsky.embed.images` blobs are ≤1 MB by lexicon.
  - The author's PDS is down → `502`, the post shows "image unavailable" with its alt text.
  - Animated GIF → first frame only (no animation at v1).
  - The same CID in many posts → fetched, checked and encoded once; cache keyed by CID.
  - Video embeds and their thumbnails → not proxied (HLS is out of scope); P4.21 renders a link.

Threats: fetching other people's pictures from foreign PDSes and serving them.
  - E SSRF or a free open proxy → MAC-bound URLs, net-guard, no redirects, size cap (`bsky_img_mac_required`,
    `bsky_img_private_endpoint_refused`, `bsky_img_no_redirects_and_cap`).
  - T Bytes that do not match the CID → refused (`bsky_img_cid_verified`).
  - E A matched image served, or served during an outage → never; fails closed (`bsky_img_match_never_served`,
    `bsky_img_unavailable_fails_closed`).
  - I Viewer data forwarded, metadata kept, scriptable responses → none forwarded; re-encoded; sandbox CSP
    (`bsky_img_no_viewer_data_forwarded`, `bsky_img_reencoded_stripped`, `bsky_img_headers`).

Done when (tests):
  - `bsky_img_mac_required`: no MAC, a wrong MAC, an expired URL, a MAC minted for another CID or size → `403`, zero outbound requests.
  - `bsky_img_cid_verified`: the PDS stub returns bytes whose sha256 differs from the CID → `502`, `refused`, nothing cached.
  - `bsky_img_pdq_checked`: a fresh fetch calls `FingerprintCheck.check` once; a cache hit calls it zero times.
  - `bsky_img_match_never_served`: the fake check returns `match` → `404` now and on retry, `onMatch` called once with `subjectKind: 'image'`, no `bsky-cache/` object.
  - `bsky_img_unavailable_fails_closed`: `unavailable` → `503`, nothing cached, nothing served.
  - `bsky_img_reencoded_stripped`: a JPEG with EXIF GPS → served WebP has no EXIF/XMP and is ≤ the size cap.
  - `bsky_img_headers`: every status carries `default-src 'none'; sandbox` and `nosniff`; `Content-Type` is `image/webp`.
  - `bsky_img_no_viewer_data_forwarded`: the outbound request (recorded by the PDS stub) has no cookie, no `X-Forwarded-For`, no viewer address and our fixed `User-Agent`.
  - `bsky_img_no_redirects_and_cap`: a `302` from the PDS → `502`; a 3 MB body → aborted at 2 MB, `502`.
  - `bsky_img_private_endpoint_refused`: a DID document pointing at `10.0.0.1` → refused by net-guard.
  - `bsky_img_hidden_label_no_url` (with P4.21): a post whose label decision is `hide` gets no image URL; `warn` → URL only behind the interstitial.
  - `bsky_img_cache_ttl`: the `bsky-cache/` lifecycle rule is 24 h; `bsky_image_state` rows older than 24 h are swept.
Reuse:
  - `appview/src/media-proxy.ts:110-117` (sandbox CSP, `nosniff`, not-immutable cache) → LESSON (vault note `atproto-blob-serving-security`).
  - `appview/src/media-proxy.ts:84-90, 126-138` (forwards the raw `Range` and buffers an uncapped body) → REJECT (the note's "resource exhaustion" finding).
  - `appview/src/views.ts:117-118,145` (direct `getBlob` URLs from the self-asserted PDS endpoint) → REJECT (the note: never serve raw `getBlob` to browsers).
  Provisional — for reuse review.
Not in this step: Bluesky video playback (HLS, out of scope); our own published images and videos (P3.09, P4.16); the
image hold internals (P5.07b); label rendering rules (P4.23).
Cost for P4.00 to measure (estimates, not yet measured): CPU per first fetch ≈ decode + PDQ + WebP encode ≈ 80–200 ms
on one core per image (P2.17's figures apply), plus one Arachnid Shield request per new CID once P5.07b is live (its
rate limit and any per-request cost go in P5.07b's spike); storage ≈ 2 encodes × ~60 KB per distinct CID kept 24 h,
so 10,000 distinct images a day ≈ 1.2 GB on the object store; outbound bandwidth ≈ the original sizes (≤1 MB each).
P4.00 sets the cache TTL and a per-viewer rate limit (`feed` bucket, which this step adds to `interfaces/media/limits.ts` (P1.06p; feature code, not trusted base: SE-6 as updated, plan `6275827`)) from these numbers.
Diagram:
```mermaid
sequenceDiagram
  autonumber
  participant B as Browser
  participant W as web
  participant M as media
  participant PDS as author's PDS
  participant FC as FingerprintCheck
  W->>W: render post; moderation.decide; mint bskyImage.url(did, cid, size) (MAC, 1 h)
  B->>M: GET /x/did/cid/size.webp
  M->>M: verify MAC; cache hit? serve
  M->>PDS: getBlob(did, cid) via guardedFetch (no redirects, 2 MB, no viewer data)
  PDS-->>M: bytes
  M->>M: sha256 == CID? decode, PDQ
  M->>FC: check(pdq)
  FC-->>M: clear | match | unavailable
  M->>M: re-encode WebP, strip metadata, cache 24 h
  M-->>B: image/webp + sandbox CSP + nosniff
```

---

### P4.21 — Home timeline: our videos from the index plus Bluesky `getTimeline` through the user's PDS

Tags: [SEC]            Depends on: P4.18, P2.07, P4.16, P4.19, P4.20, P4.21a            Plan: §5.8 feeds as tabs, §3 `rpc:` scopes, §2 rules 9 and 12, §6.1 budgets
Where: `domains/feed/{following,merge,render-model}`, `interfaces/http/routes/home` (`GET /home`, `GET /home/feed`), `apps/web/islands/feed-list`
Size: ~380 source lines, ~400 test lines

Goal: the Following tab shows, newest first, the user's Bluesky timeline (fetched through their own PDS) merged
with public unset.sh videos from the people they follow, with labels respected and nothing private.

Bluesky media (decided, Alex 16:41Z, P4b-E5 option C as the coordinator relayed it, answer 33; the stop is removed):
pictures in Bluesky posts and Bluesky authors' avatars are shown **through our own media server** (P4.21a), never
from Bluesky's CDN, so the viewer's browser talks only to our origins and no viewer address reaches Bluesky. The
app's `img-src` stays the media origin only. Bluesky video embeds are HLS; plan §5.8 excludes hls.js, so they render
as a text line "Video: open in Bluesky" (no poster; the video thumbnail is not a blob of the record).

Bluesky blocks (decided, Alex 16:41Z, P4b-E19, answer 34): a signed-in member's Bluesky blocks apply to unset.sh
feeds. The Bluesky half already arrives with them applied by the AppView; our half (and P4.22's `unset_latest` and
`unset_following` tabs) drops every item whose author the viewer blocks, or who blocks the viewer, in both directions
as Bluesky does. The source is the `app.bsky.graph.block` records in repos (public records; nothing private is read).

Inputs: `follow` read paths (P4.18, both follow collections); `like.counts`, `comment.counts` (P4.19, P4.20);
`playback.urls`, `isPlayable` (P4.16); `bskyImage.url(did, cid, size)` (P4.21a); `pds.call` (P2.07); vendored `app.bsky.feed.getTimeline` and `app.bsky.feed.defs` lexicons;
`lexicon.validate`.
Outputs:
- `following.page(viewer, cursor?) → {items: FeedItem[], cursor?, notices: NoticeCode[]}`.
- `FeedItem = {kind: 'ours', video: VideoView, counts, viewer} | {kind: 'bsky', post: BskyPostRender, reason?}`;
  `BskyPostRender` holds only fields we render (author did, verified display handle, text, facets as safe links,
  embed summary, counts, `viewer.like`, labels) — never the raw AppView object.
- `moderation.decide(item) → show | warn(labels) | hide` hook: until P4.23 lands, the built-in rule is "any label →
  hide" (fail closed).
- Cursor `FollowingCursor = base64url(JSON {v: 1, b: string | null, bDone: bool, o: {t: iso, u: uri} | null})`, ≤1 KB.
- `GET /home` (shell with tab bar, first page streamed) and `GET /home/feed?tab=following&cursor=` (JSON, `no-store`).
- Ingest registration for `app.bsky.graph.block` (record shape `{subject: did, createdAt}`): promoted columns
  `blocker_did = repo DID`, `subject_did = subject` in `idx.record` (both DID columns registered for erasure), indexed
  on `(blocker_did)` and `(subject_did)`; only for repos the indexer already tracks.
- `blocks.hiddenFor(viewer) → Set<Did>`: subjects of the viewer's block records ∪ blockers whose record names the
  viewer; one query; read error → the route answers 503 for our half (never shown unfiltered).

Algorithm (`following.page`):
  1. Session required (`/home` without session → `303 /login`). Rate limit `feed` per DID (60/minute) → `429` with
     `feed.rate_limited` (this step adds `feed` to `interfaces/http/limits.ts` (P1.06p; feature code, not trusted base: SE-6 as updated, plan `6275827`)).
  2. Decode cursor: absent → fresh. Present → base64url decode, JSON parse, schema check (`v = 1`, `b` ≤512 chars,
     `o.t` ISO date, `o.u` AT-URI) → any failure → `400 feed.cursor_invalid` (the island restarts from the top).
  3. Bluesky half (skip if `bDone`): `pds.call(viewer, 'app.bsky.feed.getTimeline', {limit: 30, cursor: b}, {timeoutMs:
     4000, headers: {'atproto-accept-labelers': '<bsky moderation DID>;redact, <our labeler DID>'}})`.
     - success → `lexicon.validate` the output; an invalid **item** is dropped and counted (`feed.item_invalid`); an
       invalid envelope → treat as error.
     - `PdsTimeout`/`PdsTransient`/`PdsRateLimited` → Bluesky half empty for this page, notice `feed.bsky_unavailable`,
       `b` unchanged (retry next page load).
     - `PdsRejected(403, scope)` (the user consented to the fallback scope without `rpc:`) → empty, notice
       `feed.bsky_scope_missing` with a reconnect link; set `bDone = true` for this cursor.
     - `PdsAuthLost` → empty, notice `auth.reconnect` (session kept, §2 rule 3).
  4. Window: if the Bluesky half returned items, `windowEnd = min(sortAt)` of those items (`sortAt = reason.indexedAt
     ?? post.indexedAt`); else `windowEnd = −∞` when `bDone`, or "30 newest" otherwise.
  5. Our half: one query: public `sh.unset.video` records in `idx.record` whose author is followed by the viewer
     (index follows by viewer ∪ viewer's private follow rows — the viewer's own data, rule 12) **or** is the viewer
     (own published videos), author active and not delisted, `rendition_set` ready, `(created_at, uri) < o` if `o`,
     `created_at ≥ windowEnd`, order `(created_at DESC, uri DESC)`, limit 50. Timeout 2 s → our half empty, notice
     `feed.ours_unavailable`. "Followed" merges **both** public follow kinds (`sh.unset.follow` and
     `app.bsky.graph.follow`, answer 29b) and includes follows the viewer made **on Bluesky** or in any other client:
     they are records in the viewer's own repo, indexed by P4.18's registrations (R7). Authors in
     `blocks.hiddenFor(viewer)` are excluded in the same query (answer 34).
  6. Dedupe twins: drop every Bluesky item whose URI is `at://<did>/app.bsky.feed.post/<rkey>` where
     `at://<did>/sh.unset.video/<rkey>` is in our half or in the index (P4.14 same-rkey rule) — our richer copy wins.
  7. Merge by `sortAt` descending (ours: `created_at` clamped to ≤ `indexed_at` so a back-dated record cannot jump the
     queue), tie-break by URI. Emit all Bluesky items of this page and our items inside the window.
  8. Hydrate ours: `like.counts` and `comment.counts` (one query each for all URIs), `playback.urls`, author handle via
     `verifyHandle` (cached); Bluesky items: build `BskyPostRender` (text as text, facet links through `safeHref` with
     `rel="noopener noreferrer ugc"`, mentions link to `https://bsky.app/profile/<did>`); images (`app.bsky.embed.images`,
     the images of `recordWithMedia`, an `external` thumb) and the author's avatar as `bskyImage.url(did, cid, size)`
     URLs on our media origin with their alt text (P4.21a; no CDN URL is ever emitted); a video embed as the text
     link above.
  9. Apply `moderation.decide(item)`: `hide` → drop; `warn` → item rendered behind the warning interstitial.
  10. Next cursor: `b` = AppView cursor (or unchanged on failure), `bDone` = AppView returned no cursor, `o` = last of
     our emitted items (or previous `o`). If both halves are done and nothing emitted → no cursor ("you're all caught up").
  11. Render: `/home` streams the shell (tabs, skeleton) first and the first page inside a streamed boundary (P1.20 glue);
     if streaming is unavailable, render after the page resolves, under a written TTFB budget exception for the
     PDS-bound part (E10, accepted). The
     `feed-list` island loads further pages from `/home/feed` and mounts `video-player` per item.
  12. Feed UI (sheet v44, approved by Alex 2026-10-04; components from P1.24a; Editor pass B): the list has the ARIA
     `feed` role; the page uses `AppShell` with `feed` (no footer; the footer links are in the header menu). **Endless
     scroll:** without JS, `FeedMore` is a plain `older posts` link to `/home?tab=<id>&cursor=<next>` (the server renders
     that page); the `feed-list` island turns it into auto-load (loading, end and error states) and keeps the current
     cursor in the URL with `history.replaceState`, so reload and back return to the same place. **New posts:** the
     island checks for newer items (one `/home/feed` request without a cursor, at most once a minute while the tab is
     visible, counted against the `feed` limit) and shows `NewPosts`, the status bar under the header
     (`[info] 3 new posts  SHOW ↑`); it slides away when the reader scrolls up, reaching the top reloads the feed in place
     with the new posts, and `SHOW` does both. `Pagination` is never used here. The
     `feed-list` island stays inside P1.23's existing budget: ≤15 KB gzipped for the island, ≤75 KB for bootstrap,
     runtime and all islands together.

Edge cases and failures:
  - Viewer's "Posts and follows" private → our half still shows public videos of people they follow privately (their
    own data); their own videos are private, so not in any feed (§5.8 "a private user's posts never enter any feed").
  - Followed account becomes private (unpublishes) → its records leave the repo, ingest deletes them, they vanish.
  - AppView returns a post from one of our members that is also in our index as a twin → dedupe (step 6).
  - AppView item with an unknown embed type → "unsupported content, open in Bluesky" link.
  - A followed unset.sh account followed through `sh.unset.follow` → its videos are in our half, but its Bluesky
    posts are not in `getTimeline` (Bluesky's graph lacks the follow; accepted cost of decision 28). P4.00 decides
    whether our half also reads those authors' `app.bsky.feed.post` records (it would need ingest of that
    collection for members only); until then the tab says nothing about it.
  - A Bluesky image the proxy refuses (fingerprint match, `unavailable`, fetch failure, too large) → a neutral
    "image unavailable" box with the alt text; the post still renders.
  - Display name with bidi overrides or zero-width characters → rendered inside `<bdi>`; never interpreted.
  - Cursor from a different user → harmless (contains only public positions); still validated.
  - Both halves fail → page with both notices, no items, retry button; HTTP 200 (the page itself works).

Threats: the timeline: our index merged with Bluesky content fetched through the member's PDS.
  - I Blocked authors or hidden items shown → blocks applied, block read error fails closed; labelled items hidden
    (`following_bsky_blocks_hide_ours`, `following_blocks_read_error_fails_closed`,
    `following_label_any_hides_until_P4_23`).
  - I The viewer's browser contacting Bluesky CDNs → media origin only (`following_no_raw_cdn_urls`).
  - T Script through facets, or a tampered cursor → `safeHref`; cursor validated (`following_facet_link_safehref`,
    `following_cursor_tamper_400`).

Done when (tests):
  - `following_merge_window`: Bluesky page spanning 10:00–09:00 and our videos at 10:30, 09:30, 08:30 → 10:30 and 09:30 emitted, 08:30 next page.
  - `following_bsky_timeout_shows_ours_with_notice`; `following_bsky_rate_limited_same`; `following_auth_lost_notice_session_kept`.
  - `following_scope_missing_notice`: 403 with `ScopeMissing` → notice and `bDone`.
  - `following_invalid_item_dropped_envelope_error`: one bad item → dropped; bad envelope → `bsky_unavailable`.
  - `following_ours_only_public_followed_active`: delisted, inactive, unfollowed and not-ready videos excluded.
  - `following_includes_bsky_graph_follows` (R7): a follow record written by another client into the viewer's repo, once indexed → that author's videos appear.
  - `following_merges_both_follow_kinds` (answer 29b): one author followed by `sh.unset.follow`, one by `app.bsky.graph.follow`, one privately → all three authors' videos appear.
  - `following_private_viewer_own_videos_excluded`.
  - `following_bsky_blocks_hide_ours` (answer 34): the viewer has an indexed `app.bsky.graph.block` on author A, and
    author B has one on the viewer → neither A's nor B's videos appear; removing the block record (ingest delete)
    brings them back.
  - `following_blocks_read_error_fails_closed`: the block query fails → our half empty with `feed.ours_unavailable`.
  - `following_dedupes_bsky_twin`.
  - `following_backdated_record_clamped`.
  - `following_cursor_tamper_400` (bad base64, wrong `v`, 2 KB cursor, non-URI `o.u`).
  - `following_label_any_hides_until_P4_23`: Bluesky item with a label → not rendered.
  - `following_accept_labelers_header_sent`.
  - `following_no_raw_cdn_urls`: rendered HTML/JSON contains no `cdn.bsky.app`, `video.bsky.app` or `getBlob`; every image URL is on the media origin and built by `bskyImage.url` (answer 33).
  - `following_image_alt_kept`: a Bluesky post with two images → two media-origin URLs with their alt texts.
  - `following_facet_link_safehref`: `javascript:` facet → plain text.
  - `following_query_budget`: ≤5 DB queries per page request (counter).
  - `following_axe_both_themes` and `following_keyboard_reaches_every_action` (Playwright).
  - `feed_nojs_older_link`: JS off → `older posts` link; following it renders the next page by cursor.
  - `feed_autoload_replacestate`: JS on → scrolling loads the next page and the URL carries the new cursor; reload
    shows the same position's page.
  - `feed_newposts_status_bar`: a newer item appears → the `[info] … new posts  SHOW ↑` bar; scroll up hides it; top
    reloads in place; `SHOW` does both.
  - `feed_role_no_footer`: `role="feed"`, no `<footer>`, footer links in the menu.
  - `feed_list_island_budget`: the `feed-list` chunk ≤15 KB gzipped and the P1.23 total unchanged at ≤75 KB.
  - `feed_reduced_motion`: no slide animation for `NewPosts` or loading under `prefers-reduced-motion`.
Reuse:
  - `app/src/lib/social-feed.ts:85-120` (appview client with a shared bearer token and a viewer-DID header) → REJECT: the plan replaces the shared-secret timeline with the user's PDS proxy and the merged process (review 03 §3).
  - `appview/src/db.ts:208-233` (`listTimelinePosts` gates: self or followed, active, not hidden, published) → LESSON, provisional — for reuse review.
  - `app/src/lib/social-feed.ts:40-83` (defensive view parsing) → LESSON: replaced by the one lexicon validator (§2 rule 8).
  - `app/src/components/social/SocialTimeline.tsx` (432 lines, Tailwind classes, inline `choose()` strings) → REJECT: no Tailwind, strings go to catalogs (plan §5.1, §8 Phase 1).
Not in this step: other tabs and saved feeds (P4.22); full label behaviour (P4.23); report button (P4.24); Bluesky thread view (the `getPostThread` scope is requested from day one, plan §3 22:49Z, but no Phase 4 step
builds the view; posts link out); reposting (not in plan scope).
Diagram: see "Loading a feed tab" above.

---

### P4.22 — Feed tabs: saved feeds in the app DB, `getFeed` through the PDS proxy, our own feeds

Tags: [SEC]            Depends on: P4.21            Plan: §5.8 feeds as tabs, §3 scopes, §11 Q2b ("feeds show only public content")
Where: `domains/feed/{saved,bsky-feed,ours}`, `interfaces/http/routes/feeds` (`GET /settings/feeds`, `POST /feeds/add`, `POST /feeds/remove`, `POST /feeds/move`), tab bar on `/home`
Size: ~320 source lines, ~340 test lines

Goal: users add, remove and reorder feed tabs; Bluesky feeds load through their own PDS; our "unset.sh latest" feed
loads from the index; the list is private in the app DB.

Inputs: P4.21 merge/render model, `FeedItem`, moderation hook, cursor helpers; P2.07 (with the `getFeed` and
`getFeedGenerators` scopes, plan §3 22:49Z); `resolveHandle`, `verifyHandle`; P2.21's atomic-reorder pattern.
Outputs:
- Table `app.saved_feed(did, id uuid, kind ('following' | 'unset_latest' | 'unset_following' | 'bsky'), feed_uri NULL,
  label text, position int, created_at, PRIMARY KEY (did, id), UNIQUE (did, position) DEFERRABLE, UNIQUE (did,
  feed_uri))`. DID column registered; included in export.
- Defaults at first `/home` visit: `following` (position 0, cannot be removed) and `unset_latest` (position 1;
  settled by Alex 2026-10-03, P4b-E14, answer 35: Following + unset.sh latest).
- `savedFeeds.list(did)`, `.add(did, input) → added | refused(code)`, `.remove(did, id)`, `.move(did, id, 'up' | 'down')`.
- `bskyFeed.page(viewer, feedUri, cursor?)`; `ours.page('latest' | 'following', viewer?, cursor?)` (shared with P4.22a).
- `GET /home/feed?tab=<id>&cursor=` dispatches by kind. Every tab uses P4.21's feed UI (step 12: ARIA `feed` role,
  `FeedMore` with the no-JS `older posts` link, `NewPosts` status bar, cursor in the URL via `replaceState`, no footer);
  `/settings/feeds` is an ordinary page, not a feed.

Algorithm (`POST /feeds/add`):
  1. Session; rate limit `feed_edit` (30/hour; this step adds it to `interfaces/http/limits.ts` (P1.06p; feature code, not trusted base: SE-6 as updated, plan `6275827`)). Count saved feeds; ≥20 → `feeds.limit`.
  2. Parse input: an `at://<did-or-handle>/app.bsky.feed.generator/<rkey>` URI, or
     `https://bsky.app/profile/<did-or-handle>/feed/<rkey>`. Anything else → `feeds.invalid`.
  3. Handle in the input → `resolveHandle` (timeout 3 s) and `verifyHandle` must agree → else `feeds.invalid`; store the
     DID form only.
  4. Duplicate `feed_uri` for the DID → `feeds.already_added`.
  5. Look up the generator: `pds.call(viewer, 'app.bsky.feed.getFeedGenerators', {feeds: [feed]}, {timeoutMs: 6000})`
     (the response is validated with the vendored lexicon).
     - a view returned and `isValid ≠ false` → save with `label` = user-supplied (≤40 graphemes), else the generator's
       `displayName` (NFC, cut to 40 graphemes, stored and rendered as text), else "Feed <rkey>"; position = max + 1.
       `isOnline = false` → saved, with the notice `feeds.offline` on the tab.
     - no view, or `isValid = false` → `feeds.not_found`. Timeout/transient → `feeds.try_again` (nothing saved).
       `PdsAuthLost` → `auth.reconnect`. Scope refused (a member on the fallback scope) → `feeds.scope_missing`.
  6. Audit nothing (private preference); log `feeds.added` with no feed URI (the URI is personal data about interests).

`POST /feeds/remove`: `(did, id)` scoped; `following` → `feeds.cannot_remove`; delete and renumber positions in one
transaction (deferred unique constraint).
`POST /feeds/move`: swap positions with the neighbour in one transaction; at the edge → no-op; `following` stays at 0
(moves that would displace it are no-ops).

`bskyFeed.page`: as P4.21 step 3 with `app.bsky.feed.getFeed` (`limit 30`, same headers, timeout 4 s), same error
mapping (feed-specific: `UnknownFeed` → notice `feeds.gone` with a remove button), same validation, twin dedupe against
the index, render model and moderation hook. Cursor is the generator's cursor wrapped `{v: 1, f: cursor}`.

`ours.page('latest', viewer?, cursor)`: public `sh.unset.video` of all active, non-delisted authors with
`rendition_set` ready, not hidden by our labels (P4.23 decision applied after fetch), keyset on `(created_at, uri)`,
limit 30. `ours.page('following', viewer, cursor)`: same restricted to authors followed by `viewer` (public follows from
the index ∪ the viewer's private follows when called from our app; only public follows when called by P4.22a).
With a signed-in viewer, both pages exclude `blocks.hiddenFor(viewer)` (P4.21, answer 34); `latest` without a viewer
(P4.22a's anonymous request) has no blocks to apply.

Edge cases and failures:
  - Feed generator offline → AppView returns an error through the PDS → notice, tab stays.
  - Generator returns posts from a private unset.sh user → impossible: private posts are not in any repo.
  - Feed list row for a feed later taken down → `feeds.gone` notice.
  - Two tabs racing a reorder → serialized by the transaction; final order is consistent.
  - Label longer than 40 graphemes → `feeds.label_too_long`.

Threats: saved feed tabs and third-party feed generators.
  - S A feed URL with an unverified handle → refused (`feeds_add_handle_mismatch_refused`).
  - E Editing another DID's tabs → scoped (`feeds_scoped_by_did`).
  - E The server contacting feed hosts directly → only the viewer's PDS (`feeds_bsky_page_through_pds_only`).
  - T Markup in a feed name → stored as text (`feeds_add_label_from_display_name`).

Done when (tests):
  - `feeds_add_at_uri`, `feeds_add_bsky_url_with_handle_verified`, `feeds_add_handle_mismatch_refused`, `feeds_add_garbage_refused`.
  - `feeds_add_generator_missing_or_invalid`, `feeds_add_lookup_timeout_not_saved`, `feeds_add_scope_missing`.
  - `feeds_add_label_from_display_name`: a 60-grapheme `displayName` containing markup → stored as text, cut to 40.
  - `feeds_add_offline_saved_with_notice`: `isOnline = false` → saved; the tab shows `feeds.offline`.
  - `feeds_limit_20`, `feeds_duplicate_refused`.
  - `feeds_remove_following_refused`, `feeds_remove_renumbers`, `feeds_move_up_down_edges`, `feeds_scoped_by_did` (B cannot move A's tab).
  - `feeds_bsky_page_through_pds_only`: net-guard stub asserts the only host contacted is the viewer's PDS.
  - `feeds_bsky_page_feed_gone_notice`.
  - `feeds_ours_latest_only_public_ready_active`.
  - `feeds_ours_apply_bsky_blocks` (answer 34): `unset_latest` and `unset_following` drop authors the viewer blocks and
    authors who block the viewer.
  - `feeds_ours_following_includes_private_follows_in_app_only`.
  - `feeds_defaults_created_once`: two concurrent first visits → exactly two default rows.
  - `feeds_settings_zero_js_forms`: add, remove, move work as plain form POSTs with JS off.
  - `feeds_export_includes_saved_feed` (with P4.26).
Reuse:
  - Prototype has no saved feeds; `rss` tab code (`app/src/lib/rss-prefs*.ts`) stored prefs through a PDS patch → REJECT (§2 defect "PDS prefs patch").
  - `@atproto/api` `AtUri` parser → LESSON, provisional — for reuse review: `@atproto/lex` (P1.31) or `@atproto/syntax` may already provide one; never a hand regex.
Not in this step: the public feed-generator endpoint (P4.22a); syncing with Bluesky's `savedFeedsPrefV2` preferences (plan: stored privately in the app DB); feed discovery or search (not in plan scope).
Diagram: see "Loading a feed tab" above.

---

### P4.22a — Our feed generators for third-party unset.sh clients

Tags: [SEC] [ALEX]            Depends on: P4.22, P3.11, P3.10            Plan: §5.8 "We run our own feed generators … for our app and third-party unset.sh clients"
Where: `interfaces/api/routes/feedgen` (`/xrpc/app.bsky.feed.getFeedSkeleton`, `/xrpc/app.bsky.feed.describeFeedGenerator`, `/.well-known/did.json` for the feed service DID), runbook `docs/human/runbooks/feed-generator-records.md`
Size: ~140 source lines, ~200 test lines

Goal: expose "unset.sh latest" and "unset.sh following" as standard atproto feed generators on the public `api`
entrypoint, so other unset.sh clients can use them.
Reason for the letter suffix: P4.22 is already a full PR; the public endpoint has its own trust boundary (service
JWT, `api` role) and an Alex step (publishing the generator records).

Inputs: `ours.page` (P4.22); `verifyServiceJwt` (P3.11); `api` entrypoint with rate limits and caching (P3.10);
config `FEEDGEN_SERVICE_DID` (`did:web:<api host>`), `FEEDGEN_PUBLISHER_DID`.
Outputs:
- `GET /.well-known/did.json` → `{id: FEEDGEN_SERVICE_DID, service: [{id: '#bsky_fg', type: 'BskyFeedGenerator',
  serviceEndpoint: 'https://<api host>'}]}`.
- `describeFeedGenerator` → `{did, feeds: [{uri: at://<publisher>/app.bsky.feed.generator/unset-latest}, …following]}`.
- `getFeedSkeleton(feed, limit ≤50, cursor?) → {feed: [{post: uri}], cursor?}`.
- [ALEX] runbook: publish two `app.bsky.feed.generator` records (`did = FEEDGEN_SERVICE_DID`, display name,
  description) in the publisher repo with `goat`, from an operator machine (same custody rule as the lexicon authority, §5.3).

Algorithm (`getFeedSkeleton`):
  1. Rate limit per IP hash (P3.10). Parse `feed` (AT-URI) → not one of the two published URIs → `400 UnknownFeed`.
  2. `limit` default 30, clamp 1..50; `cursor` ≤256 chars, format `<iso>::<uri>` → else `400 InvalidRequest`.
  3. `latest`: auth optional; if an `Authorization` header is present it is still verified (an invalid token → `401`,
     never silently ignored). `following`: `Authorization: Bearer <jwt>` required → `verifyServiceJwt(jwt, {aud:
     FEEDGEN_SERVICE_DID, lxm: 'app.bsky.feed.getFeedSkeleton'})`; missing or invalid → `401 AuthRequired`.
  4. `ours.page(kind, iss, cursor)` with **public follows only**, both collections (`sh.unset.follow` and
     `app.bsky.graph.follow`, answer 29b; the `api` role cannot read the app schema, so private follows are
     unreachable by construction).
  5. Return URIs only (no hydration); `Cache-Control: public, max-age=30` for `latest`, `private, no-store` for `following`.
  6. DB error or timeout → `503`, `no-store`.

Edge cases and failures:
  - Token with `aud` of another service, expired >60 s, wrong `lxm`, replayed `jti` → `401` (P3.11 rules).
  - Request for a feed URI under another publisher → `400 UnknownFeed`.
  - Bluesky's AppView calls us for these feeds → it drops `sh.unset.*` URIs (plan §5.8): expected, not a bug.

Threats: our public feed generators, called by any client with a service JWT.
  - S A forged or misdirected service JWT → audience, method and signature checked (`feedgen_following_wrong_aud_401`,
    `feedgen_following_wrong_lxm_401`, `feedgen_latest_bad_token_401`).
  - I Private follows used → public only; `api` has no grant on `app.*` (`feedgen_following_public_follows_only`,
    `feedgen_api_role_grants`).

Done when (tests):
  - `feedgen_did_json_shape`, `feedgen_describe_lists_two_feeds`.
  - `feedgen_latest_anonymous_ok`, `feedgen_latest_bad_token_401`.
  - `feedgen_following_requires_jwt`, `feedgen_following_wrong_aud_401`, `feedgen_following_wrong_lxm_401`, `feedgen_following_replay_401`.
  - `feedgen_following_public_follows_only`: a private follow row exists → its author's videos absent.
  - `feedgen_unknown_feed_400`, `feedgen_limit_clamped`, `feedgen_cursor_invalid_400`, `feedgen_db_outage_503`.
  - `feedgen_api_role_grants`: the grant-matrix test still shows `api` with no grant on `app.*`.
Reuse:
  - `bluesky-social/feed-generator` starter → LESSON, provisional — for reuse review: route shapes and `did.json`; its Express server, SQLite and firehose subscriber are not used.
  - `@atproto/xrpc-server` `verifyJwt` → REJECT here: P3.11 is the one verifier (global invariant 2).
Not in this step: showing our feeds in other apps (withdrawn by the plan); a third feed ("new on unset.sh" is `latest`); the records themselves (Alex, runbook).
Diagram: none.

---

### P4.23 — Labels: our labeler's stream into `label`, `atproto-accept-labelers`, hide and warn

Tags: [MOD] [SEC]            Depends on: P4.21            Plan: §5.8 Labels, "Our labeler: Ozone"
Where: `interfaces/indexer/labels` (subscriber), migration `idx.label`, `domains/moderation/labels` (decision), warning interstitial markup
Size: ~300 source lines, ~320 test lines

Goal: every feed item, permalink and profile shows Bluesky's and our labels correctly: hidden labels hide, warning
labels sit behind a warning, and our own videos get our labels from our index.

Inputs: config `OUR_LABELER_DID`, `OUR_LABELER_URL` (internal URL of Ozone; Ozone arrives in P5.07, so dev and CI use
the fixture labeler, see editor note E12), `BSKY_LABELER_DID`; P2.01 DID resolution (for `#atproto_label` keys);
P4.21 `moderation.decide` hook; vendored `com.atproto.label.*` lexicons.
Outputs:
- Table `idx.label(src did, uri text, cid text NULL, val text, neg bool, cts timestamptz, exp timestamptz NULL, sig
  bytea, PRIMARY KEY (src, uri, val))` plus `idx.label_cursor(src PK, seq bigint)`. DID columns: `src` (a service DID)
  and the DID inside `uri` (account labels) — registered; erasure deletes labels on the erased DID's URIs.
- Indexer task `labelSubscriber`: WebSocket `com.atproto.label.subscribeLabels?cursor=<seq>` to `OUR_LABELER_URL`.
- `labels.forUris(uris[], authorDids[]) → Map<uri, Label[]>` (one query).
- `moderation.decide(item) → show | warn(labelVals) | hide` replacing P4.21's fail-closed stub.
- `LABEL_BEHAVIOUR` table (checked in): `!hide`, `!takedown`, `!suspend` → hide; `!warn` → warn; `porn`, `sexual` →
  hide (adult content is banned at launch, §5.8); `nudity`, `graphic-media`, `gore` → warn; our custom values from
  P5.07's definitions → hide or warn as defined; unknown values from Bluesky's labeler → warn; unknown values from any
  other source → ignored (we accept only two labelers).

Algorithm (subscriber):
  1. Load `seq` for `OUR_LABELER_DID` (absent → 0).
  2. Connect (timeout 10 s). Failure → backoff 1, 2, 4 … 60 s with jitter; never advance the cursor.
  3. For each frame: decode the event-stream frame (header + CBOR body); `#labels` → for each label:
     a. `src` must equal `OUR_LABELER_DID` → else drop and count `labels.foreign_src`.
     b. Verify `sig` against the `#atproto_label` key of `src` (resolved via P2.01, cached 10 minutes, refetched once on
        failure) → invalid → drop, count `labels.bad_sig`.
     c. Upsert: if `neg` → delete the row `(src, uri, val)` when its `cts ≤ label.cts`; else upsert with
        `WHERE excluded.cts ≥ label.cts` (monotonic, like records).
     d. Commit, then store `seq`. DB error → do not store `seq`, reconnect from the stored cursor (§2 rule 11: cursor held
        on transient failure).
     `#info` `OutdatedCursor` → log and continue. Unknown frame type → skip. Error frame → reconnect.
  4. A nightly sweep deletes rows with `exp < now()`.

Algorithm (decision, used by feeds, permalinks and profiles):
  1. Bluesky items: labels are already in the hydrated view (the AppView honoured `atproto-accept-labelers` with
     `redact` for Bluesky's labeler); take `post.labels` and `author.labels`; keep only those whose `src` is
     `BSKY_LABELER_DID` or `OUR_LABELER_DID`.
  2. Our items (and our users' profiles): `labels.forUris([recordUri], [authorDid])` from `idx.label`.
  3. Drop expired labels and those negated later (already applied at ingest).
  4. Map each value through `LABEL_BEHAVIOUR`; result is the strongest: any hide → `hide`; else any warn → `warn`; else `show`.
  5. `warn` renders the item behind an interstitial ("Content warning: <label names>", a "show" button that works without
     JS as a `<details>` element); the poster and video are not requested until opened (`preload="none"`, no autoplay).
  6. On `/@handle` (zero JS): account-level `hide` → the "unavailable" state page; record-level `hide` → the post is omitted.

Edge cases and failures:
  - Labeler down → subscriber retries; existing labels still apply; new labels apply on reconnect.
  - Label for a URI not in our index → stored (cheap) and applies when the record is indexed.
  - Label negation arriving before the label (out of order) → the negation's `cts` is newer; the later stale label is rejected by the `cts` guard.
  - Signature key rotated → refetch once; still invalid → drop and alert (`labels.bad_sig` > 0 raises the health board flag).
  - A Bluesky item labelled by a third-party labeler the user subscribes to on Bluesky → ignored here (only two labelers accepted, plan).

Threats: labels from labelers, which decide what is hidden.
  - S Forged labels or labels from unknown sources → signature and source checked (`labels_bad_sig_dropped`,
    `labels_foreign_src_dropped`).
  - T A replayed old label after a negation → rejected (`labels_stale_label_after_neg_rejected`).
  - I Hidden content still loaded → absent; warned media not requested (`feed_hidden_item_absent`,
    `feed_warned_item_behind_details_no_media_requests`).

Done when (tests):
  - `labels_ingest_valid_signed`: fixture labeler signs with a test key → row stored, cursor advanced.
  - `labels_bad_sig_dropped`, `labels_foreign_src_dropped`.
  - `labels_neg_removes`, `labels_stale_label_after_neg_rejected`, `labels_exp_swept`.
  - `labels_cursor_held_on_db_error`: DB throws on upsert → reconnect from the old cursor; label later stored once.
  - `labels_reconnect_backoff_capped`.
  - `decide_hide_wins_over_warn`, `decide_unknown_bsky_value_warns`, `decide_unknown_other_src_ignored`, `decide_expired_ignored`.
  - `feed_hidden_item_absent`, `feed_warned_item_behind_details_no_media_requests` (Playwright counts media requests).
  - `profile_account_hide_state_page_zero_js`.
  - `accept_labelers_header_value`: exactly two DIDs, Bluesky's with `;redact`.
  - `erasure_removes_labels_on_erased_did`.
Reuse:
  - `@atproto/api` moderation (`moderatePost`, `LABELS` defaults) → LESSON, provisional — for reuse review: the reference for label semantics; adopting it as a dependency is the reuse reviewer's call (size, pin, fit with `@atproto/lex` types).
  - `@atproto/xrpc` / `@atproto/sync` event-stream frame decoding → USE candidate, provisional — for reuse review (plan pins `@atproto/*` exactly; never a hand-written CBOR frame parser).
  - Prototype has no labels → nothing to salvage.
Not in this step: deploying Ozone and our label definitions (P5.07); labelling actions in `admin` (P5.08); querying Bluesky's labels on our users' accounts (review 03-data MINOR-2 "lazy `queryLabels`"; not in plan; editor note E13); user label preferences (not in plan scope).
Diagram: none.

---

### P4.24 — Report button on every post

Tags: [MOD] [SEC]            Depends on: P3.15, P2.07, P4.23            Plan: §5.8 "A report button stays on every post", §6 "Reports go into the moderation queue, never into logs", §2 rule 16, §5.8 "Forwarding" (question 36: from our own moderation account)
Where: `interfaces/http/routes/report` (`GET /report`, `POST /report`), report link in every post view (feed items, permalinks, comments)
Size: ~150 source lines, ~200 test lines

Goal: every rendered post and comment has a report link that files a structured report into the P3.15 queue.

Inputs: `reports.submit` (P3.15) and its `ReportSubject` type; P4.21/P4.20 views; rate limit bucket `report`;
config `BSKY_LABELER_DID` (P4.23), whose `#atproto_labeler` service is Bluesky's moderation service; the moderation
service account's credential (forwarder only, never `web`).
Outputs:
- `ReportSubject` extended (editor note E15) with `{kind: 'record', uri, cid?, origin: 'ours' | 'bsky'}`,
  `{kind: 'private_comment', id}`, `{kind: 'account', did}`.
- `GET /report?subject=<encoded>` (zero-JS form page, the same page signed in or out) and `POST /report`.
- Report link markup in every post and comment view: `<a href="/report?subject=…">` with a labelled flag icon
  (P1.24 `Icon`, an Iconoir SVG that must be on the design sheet's Icon list, `aria-hidden`, plus hidden text) and a
  ≥24×24 px target.
- No forwarding checkbox (answer 36): a report on a Bluesky record is always forwarded to Bluesky's moderation service
  **from our own moderation service account**, never from the reporter's DID, so Bluesky never learns who reported; a
  report on unset.sh content is never forwarded. The form says so in one line ("Reports about Bluesky posts are also
  sent to Bluesky, from unset.sh, without your account").
- Table `app.report_forward(id uuid PK, case_id, subject_uri types.at_uri, subject_cid, reason_type, state
  ('queued' | 'sent' | 'failed'), attempts, created_at, sent_at NULL)`: the forward outbox. It holds **no reporter DID
  and no note** (free text can identify the reporter). One row per subject URI per 24 hours (later reports on the
  same subject attach to the queued row), so our account never files the same subject twice in a day.
- `REASON_TO_BSKY` (checked in): our reason codes → `com.atproto.moderation.defs#reason*` values (spam, violation,
  misleading, sexual, rude, other); a test keeps it complete.

Algorithm (`POST /report`):
  1. CSRF gate has run. Reporter = session DID or null (the public notice form path, DSA Art. 16, is P3.15's; signed-out
     reports of records use the same intake with `reporterDid = null` plus P3.15's notice fields).
  2. Rate limit `report`: per DID 10/hour; per IP hash 5/hour for signed-out → `report.rate_limited`.
  3. Parse subject: `record` → AT-URI syntax; `ours` must exist in `idx.record` (deleted → still accepted: the report
     may be about content that was just removed; P3.15 decides) ; `bsky` → URI syntax only. `private_comment` → row
     must be visible to the reporter (they are its target or its author) → else `404`. `account` → DID syntax.
  4. `reasonCode` from the P3.15 allow-list → else `report.reason_invalid`. Note ≤2,000 graphemes, optional.
  5. `reports.submit(...)` (DB timeout 2 s). Success → `303 /report/thanks?case=<short id>`. Error → `503` page;
     nothing logged except `report.submit_failed` with no subject, note or reporter.
  6. Log line on success: `report.filed` with the reason code only. Never the subject URI, the note or the reporter DID.
  7. Forward to Bluesky (answer 36), only when `origin = 'bsky'`, signed in or not: in the same transaction as step 5,
     insert or join the `app.report_forward` row `{case_id, subject_uri, subject_cid, reason_type:
     REASON_TO_BSKY[reasonCode]}`. No `cid` on the subject → not forwarded (our case still stands). The thanks page
     says "also sent to Bluesky, from unset.sh". `web` makes no `createReport` call and holds no credential for it.
  8. Forwarder (a hypothesis; P4.00 places it): a loop in one process that alone holds the moderation service
     account's credential (a non-human account on our PDS; secret file; listed in the P0.12 inventory; never `web`)
     reads queued rows and calls `createReport` through that account's own PDS with `atproto-proxy:
     <BSKY_LABELER_DID>#atproto_labeler`, body `{reasonType, subject: strongRef}` and **no `reason` text**. Timeout
     or 5xx → retry with backoff up to 24 h, then `failed` (shown in the P3.20b queue); 4xx → `failed` at once. Log
     `report.forwarded` / `report.forward_failed` with no subject. How the account signs in (OAuth or an app password,
     the legacy path that decision 26 allows for moderator accounts only) is a P4.00 question for Alex; never a
     reporter's token.

Edge cases and failures:
  - Reporting your own post → allowed (people report their own hacked accounts).
  - Report on a Bluesky post → stored in our queue with `origin: 'bsky'`; our own action is our label (P5.07/P5.08);
    it is also sent to Bluesky's moderation service from our moderation account (steps 7–8), never naming the reporter.
  - Report on our own record (unset.sh content) → never forwarded (Bluesky does not moderate `sh.unset.*`; Ozone does,
    P5.07).
  - Duplicate report by the same reporter and subject within an hour → P3.15 merges or stores; this step does not dedupe.
  - Subject param tampered to a private comment the reporter cannot see → `404`, no oracle on existence.

Threats: reports filed by anyone, including signed-out visitors.
  - I Report details in logs, or reporter identity sent to Bluesky → not logged; forwarded from the service account
    (`report_never_logs_pii`, `report_bsky_forward_always_from_service_account`).
  - D Report floods → rate limits signed in and out; one forward per subject and day
    (`report_rate_limited_signed_out`, `report_forward_dedup_per_subject_day`).
  - I Probing private comments through reports → 404 (`report_private_comment_not_visible_404`).

Done when (tests):
  - `report_link_on_every_post_kind`: render ours, bsky, comment, private comment → each has a report link with a labelled icon and a 24×24 target.
  - `report_signed_in_files_case`, `report_signed_out_files_case_null_reporter`.
  - `report_never_logs_pii` (regression, §2 defect "Post reports end up in logs"): capture logs during a report → no URI, note text or DID.
  - `report_goes_to_queue`: after submit the P3.15 table has one row with the subject and reason.
  - `report_reason_invalid`, `report_rate_limited_signed_in`, `report_rate_limited_signed_out`.
  - `report_private_comment_not_visible_404`.
  - `report_form_zero_js_and_axe`: page has no `<script>`; axe zero violations both themes.
  - `report_csrf_applies`.
  - `report_bsky_forward_always_from_service_account` (answer 36): a signed-in and a signed-out report on a Bluesky post → one `report_forward` row; the forwarder's `createReport` is made with the service account's session, never the reporter's; the request carries no reporter DID and no `reason` text; `web` makes no `createReport` call.
  - `report_bsky_forward_shape`: `atproto-proxy` names `BSKY_LABELER_DID#atproto_labeler`; the subject is a strongRef with the hydrated CID; the reason type comes from `REASON_TO_BSKY`.
  - `report_bsky_forward_failure_still_filed`: timeout and 5xx → retried, then `failed`; our case row exists throughout.
  - `report_forward_dedup_per_subject_day`: three reports on one Bluesky post within 24 h → one forward.
  - `report_forward_never_for_ours`: a report on an `sh.unset.*` record or a private comment → no `report_forward` row.
  - `report_forward_reason_map_complete`: every P3.15 reason code has a mapping.
Reuse:
  - `app/src/lib/post-report.ts:11-44` (writes reporter DID and note to `console.info`, optional webhook) → REJECT: §2 defect "Post reports end up in logs, not in a moderation queue".
  - `app/src/lib/post-report.ts:3-9` (reason allow-list) → LESSON.
Not in this step: the queue and admin list (P3.15, P3.20); Ozone routing (P5.07); chat reports (P6.14).
Diagram: none.

---

### P4.25g — `retention` grants on existing tables (split from P4.25, SE-6)

Tags: [SEC]            Depends on: P4.03, P4.06, P4.07, P4.08, P4.09, P4.13, P4.17, P4.20, P1.12, P2.18            Plan: §5.2 roles; §9 trusted base (rule SE-6, as ruled 2026-10-04; plan `f9b48f8`); §6 retention
Where: one migration (grant statements only), `roles.json` (`retention`'s `passwordFrom`, if not already set),
  `grant-matrix.json` rows, matrix test rows
Size: ~20 lines SQL, ~20 test lines

Why a separate step (letter suffix): every grant in P4.25's "Grants migration" is on a table or function an earlier
step created, which is trusted base.
Goal: the expiry job's role reaches exactly what P4.25's list names.
Inputs: the tables and `core.is_held` named in P4.25's Outputs.
Outputs: P4.25's "Grants migration" list exactly: SELECT, DELETE on the P2.18 draft tables, `app.bsky_post_draft` and
  `app.pending_comment`; UPDATE (`state`, `needs_reauth`, `waiting_since`, `updated_at`) on `app.bsky_post_draft`;
  SELECT and UPDATE (`state`, `needs_reauth`, `master_downgraded`, `waiting_since`, `expires_at`) on `video_upload`;
  DELETE on `video_fingerprint`, `nudity_result` and `transcript`; SELECT (`created_at`, `decided_at`) on `appeal`;
  EXECUTE on `core.is_held`; the matrix rows.
Algorithm: the statements.
Edge cases and failures: none beyond the matrix test.
Threats: the `retention` role.
  - E `retention` reading sessions or holds → `expiry_role_grants` (P4.25), `matrix_matches`.
Done when (tests): `matrix_matches`; P4.25's `expiry_role_grants`.
Reuse: none. Not in this step: the job (P4.25). Diagram: none.

---

### P4.25 — Draft and upload expiry jobs (30 days) under the `retention` role

Tags: [SEC]            Depends on: P4.25g, P4.03, P4.07, P4.07h, P4.13, P4.17, P4.20, P1.12, P2.18            Plan: §5.4 drafts 30-day TTL, §5.8 drafts store lifecycle and "the 30-day draft expiry skips a draft with an open appeal … an appeal open longer than 7 days raises an alert", §6 retention, decision 9 (legal hold)
Where: `interfaces/jobs` (new scheduled entrypoint; editor note E16) with `retention/drafts.ts` and `retention/expirable.ts` (the one shared predicate), migration for grants, compose service `jobs`
Size: ~200 source lines, ~280 test lines

Goal: every abandoned draft, draft image, upload and pending post older than 30 days is deleted from storage and
expired in the database, except a draft with an open appeal (kept with no time limit) and material under a legal hold,
with a bounded, idempotent nightly job.

Inputs: draft tables and the `drafts/<did>/…` prefix (P2.18); `video_upload` rows and `drafts/<did>/v/<uploadId>/…`
objects with part 1's state enum (P4.03); P4.17 `bsky_post_draft` and P4.20 `pending_comment` (same state names); the
`legal_hold` table (P4.07, written in the same transaction that sets `matched_hold`); `appeal` rows (P4.13);
`retention` DB role (P1.12); a storage credential that may delete under `drafts/` and is refused on `drafts/*/private/*`.
Outputs:
- `expirable(kind, row, now) → boolean` with its SQL twin, in one module: the only place that says which states expire.
  P4.13's `expiry-skips-appealed` test imports it.

  | Kind | Expires when older than 30 days (`expires_at < now` for `video_upload`, set by P4.03; `updated_at < now − 30 d` for the others) | Never expired by this job |
  |---|---|---|
  | `video_upload` | `ready`, `blocked`, `unsure`, `publish_failed` (part-1 state diagram) | `appealed` (no time limit), `uploaded`, `processing`, `reviewing`, `approved`, `pds_refused_master` (these two go back to `ready` by the return-to-draft rule below, never straight to `expired`), `private`, `published`, `matched_hold`, and the terminal states |
  | `bsky_post_draft` | `draft`, `blocked`, `unsure`, `publish_failed` | `appealed`, `reviewing`, `approved`, `published`, terminal |
  | `pending_comment` | `blocked`, `unsure`, `publish_failed`, `blocked_by_privacy` | `appealed`, `reviewing`, `approved`, `published`, terminal |
  | P2.18 profile and section drafts, draft images | all (no review states) | — |

- **Return to draft (part-2 note E22, editor pass):** an item waiting on its owner for 30 days goes back to draft, so a
  member who never signs in again cannot keep a reviewed post forever: `video_upload` in `approved` with `needs_reauth`,
  or in `pds_refused_master`, with `waiting_since < now − 30 d` → `ready`, flags `needs_reauth` and `master_downgraded`
  cleared, `waiting_since` null, `expires_at = now + 30 d` (a fresh draft period; republishing needs a new submission
  and review); `bsky_post_draft` in `approved` with `needs_reauth` and `waiting_since < now − 30 d` → `draft`
  (`updated_at = now`); `pending_comment` in the same case has no draft state, so its row is deleted (state `expired`)
  and its author sees "not posted". P4.14, P4.17 and P4.20 set `waiting_since` when they set `needs_reauth`.
- Holds are read only through **`core.is_held('video', upload_id) → boolean`** (the one hold predicate: declared by
  P3.07, body by P4.07; editor pass, lead decision 2026-10-03, replacing this step's former `app.is_held`). `EXECUTE`
  to `retention`; it returns a boolean, never a hold row. This settles R5: the hold index this job reads is a Postgres
  table; `pds-admin` keeps the authoritative clock and is never called by this job.
- Job `retention.drafts.run(now)` → `{expiredRows, returnedToDraft, deletedObjects, skippedHeld, overdueAppeals, errors}`; daily at 03:15 UTC.
- Grants migration (**P4.25g**, landed ahead as its own step: these are grants on existing objects, SE-6): `retention` gets `SELECT, DELETE` on the P2.18 draft tables, `app.bsky_post_draft` and
  `app.pending_comment`; `UPDATE (state, needs_reauth, waiting_since, updated_at)` on `app.bsky_post_draft`; `SELECT` and `UPDATE (state, needs_reauth, master_downgraded, waiting_since, expires_at)` on `video_upload`; `DELETE` on `video_fingerprint`,
  `nudity_result` and `transcript`; `SELECT (created_at, decided_at)` on `appeal`; `EXECUTE` on `core.is_held`; nothing
  else (grant-matrix test updated).
- Metric counters for the health board: last run time, rows expired, errors, overdue appeals (counts only, no DIDs).

Algorithm:
  1. Take a Postgres advisory lock `retention.drafts` (non-blocking). Not acquired → exit 0 (another run is active).
  2. `now` from the database (`SELECT now()`).
  2a. **Mass-delete governor (findings F-13; it carries P2.18's sweeper governor over).** For each kind, count the
     candidates for step 3 (`count(*)` bounded at the cap + 1). A count above the kind's cap (`EXPIRY_MAX_PER_RUN_<KIND>`;
     defaults 20 profile drafts and 500 for every other kind) → that kind deletes and expires nothing this run, and
     the job raises the health flag `retention.mass_delete` with the kind and the count (no DID); the other kinds still
     run. A real backlog is cleared by raising the cap in a reviewed config PR, never by a flag.
  3. For each kind in order [video_upload, P2.18 draft media, P2.18 profile and section drafts, bsky_post_draft,
     pending_comment] that passed step 2a, loop at most 50 batches:
     a. Select up to 500 candidate ids where `expirable(kind, row, now)` holds, keyset by primary key.
     b. Empty → next kind.
     c. For each id, one short transaction:
        i. `SELECT … FOR UPDATE SKIP LOCKED` the row and re-check `expirable` (a row locked or changed since step a,
           for example an appeal filed meanwhile, is skipped; P4.13's appeal insert takes the same row lock, so an
           appeal and an expiry never both win).
        ii. `video_upload` only: `core.is_held('video', id)` (timeout 2 s). True → skip, count `skippedHeld`. Error → skip, count
            an error (never delete what might be held).
        iii. Delete the objects: for `video_upload`, every key under `drafts/<did>/v/<id>/`; for the other kinds, the
             row's draft image keys. A key under `drafts/<did>/private/` is refused by this check and by the
             credential. Each DELETE timeout 5 s; 404 counts as success. Any failure → roll back, count an error (the
             row keeps its state, and the next run retries).
        iv. `video_upload` → `state = 'expired'` and delete its `video_fingerprint`, `nudity_result` and `transcript`
            rows (keep `review_decision`, the P4.14 step 11 rule; P5.09 owns its clock; `text_result` goes with the draft).
            Other kinds → delete the row. Commit.
  3a. Return to draft: for each kind, at most 50 batches of 500 rows matching the return-to-draft rule above, one short
     transaction per row with `SELECT … FOR UPDATE SKIP LOCKED` and a re-check; no object is deleted (a `needs_reauth`
     upload made no `media/` copies, and P4.14 deletes them on entering `pds_refused_master`).
  4. Overdue appeals: count `appeal` rows with `decided_at IS NULL AND created_at < now − 7 days`; > 0 → raise the
     health flag `appeal.overdue` with the count only (plan §5.8). P4.13 lists them in `admin`; this job only counts.
  5. Release the lock. Write counters. Exit code 0 if `errors = 0`, else 1 (the scheduler raises the health flag).
  6. The bucket lifecycle rule on `drafts/` (Phase 5 storage config) is a backstop only and is **not age-only** (E26,
     editor pass): it applies only to objects carrying the tag `lifecycle=expire`. Draft upload writers (P4.03, P4.05,
     P4.17) set the tag; P2.18's profile images never carry it (P2.18's sweeper deletes them; lead decision 4 as
     amended); private posts under `drafts/*/private/` are written without it (P4.14); P4.13 removes it from
     every object of a draft when an appeal is filed. The rule's age is set above the longest legitimate draft life
     (30 days plus 30 days of return-to-draft waiting, so 60 days, provisional for the Phase 5 storage step). This job
     never relies on the rule.

Edge cases and failures:
  - Clear fail with an open appeal → never expired, however old (plan §5.8, 22:49Z); after 7 days the
    `appeal.overdue` flag is raised every night until a person decides. Overturn → `approved` (publish path); uphold →
    `appeal_upheld`, and P4.13 deletes the objects.
  - Appeal filed while this job holds the row → the appeal waits a few seconds on the row lock, then sees `expired`
    and is refused by P4.13; never objects deleted under an `appealed` state.
  - Legal hold → `matched_hold` is never expirable; `is_held` also covers an upload in another state that has a hold
    row (an analyst hold, P4.07); an error keeps the row.
  - Private posts under `drafts/<did>/private/` → never touched.
  - `approved` with `needs_reauth`, or `pds_refused_master` → never expired directly; after 30 days of waiting it returns to draft (E22), then follows the draft rules.
  - Row edited yesterday → not expired (rolling 30 days from the last change).
  - Storage down → objects kept, state unchanged, next run retries.
  - Job crashes mid-row → the transaction rolls back; objects already deleted answer 404 next time (success).

Threats: the job that deletes members' data after 30 days.
  - T Mass deletion by a bad cutoff or predicate → predicate table, per-run governor (`expiry_predicate_table`,
    `expiry_governor_stops_mass_delete`).
  - T Held or appealed items deleted → skipped; hold lookup error keeps (`expiry_skips_held`,
    `expiry_hold_lookup_error_keeps`, `expiry_never_expires_appealed`).
  - E The `retention` role reading sessions or holds → grants (`expiry_role_grants`,
    `expiry_is_held_definer_pinned_search_path`).

Done when (tests):
  - `expiry_predicate_table`: every state of every kind → the expected `expirable` value from the table above (the predicate P4.13 imports).
  - `expiry_deletes_old_drafts_and_objects`: 31-day draft with two images → row and objects gone.
  - `expiry_video_upload_expired_state`: a 31-day `ready` upload → state `expired`, `drafts/<did>/v/<id>/` empty, fingerprint, nudity, text-gate and transcript rows gone, `review_decision` kept.
  - `expiry_keeps_recent`: 29-day draft kept; edited-yesterday 40-day-old draft kept.
  - `expiry_never_expires_appealed`: `appealed` upload, Bluesky post and comment, all 400 days old → kept with their objects.
  - `expiry_appeal_filed_during_run`: the appeal insert races the job on one row → exactly one of {`expired` with the appeal refused, `appealed` with the objects present}.
  - `expiry_overdue_appeal_flag`: an undecided 8-day-old appeal → `overdueAppeals = 1`; 6 days → 0; the flag carries no DID.
  - `expiry_skips_held`: `is_held` true → row and objects kept, `skippedHeld = 1`.
  - `expiry_hold_lookup_error_keeps`: `is_held` throws → kept, error counted, exit 1.
  - `expiry_private_prefix_untouched`: objects under `drafts/<did>/private/` survive; the credential's DELETE there → 403.
  - `expiry_skips_reviewing_and_approved`, including `approved` with `needs_reauth` for less than 30 days.
  - `expiry_needs_reauth_returns_to_draft`: an upload `approved` with `needs_reauth` and `waiting_since` 31 days ago → `ready`, flags cleared, `expires_at` 30 days ahead, objects kept; the same for a Bluesky post draft (→ `draft`); a pending comment → row deleted.
  - `expiry_pds_refused_returns_to_draft`: `pds_refused_master` for 31 days → `ready`, `master_downgraded` false; 29 days → unchanged.
  - `expiry_lifecycle_tag_rule`: a fixture object store with the tag-filtered rule → objects of an appealed draft and under `drafts/<did>/private/` (no tag) survive past the rule's age; a tagged ordinary draft object does not.
  - `expiry_storage_error_keeps_row`, `expiry_storage_404_is_success`.
  - `expiry_bounded_batches`: with the kind's cap raised to 30,000, 30,000 rows → at most 25,000 handled in one run
    (50 × 500), the rest next run.
  - `expiry_lock_prevents_overlap`: two concurrent runs → one does the work.
  - `expiry_governor_stops_mass_delete`: 501 expirable `ready` uploads with the cap at 500 → none expired, objects
    kept, `retention.mass_delete` raised with kind and count; expirable draft media in the same run still go; at 500
    → all 500 expire.
  - `expiry_role_grants`: `retention` cannot SELECT `app.session`, any index table, `legal_hold` or `legal_hold_transmission`; it can only EXECUTE `core.is_held`.
  - `expiry_is_held_definer_pinned_search_path`: catalog check on `core.is_held` (with P4.07).
  - `expiry_crash_recovery_idempotent`.
Reuse:
  - Prototype `reaper` (deleted unverified accounts) → LESSON: "any error skips" is the same rule (plan §5.2); it moves into `pds-admin` and is not this job.
Not in this step: every other retention class (P5.09); the bucket lifecycle rule (Phase 5 storage config, E26); legal holds and their expiry job (P4.07); deciding appeals and the overdue list in `admin` (P4.13).
Diagram: none.

---

### P4.26 — Export page: CAR link plus JSON of every app-DB row for the DID; `dsar.export`

Tags: [SEC]            Depends on: P3.07, P1.13, P2.13, P2.18            Plan: §6 Export, "Moderation and GDPR" (`dsar.export`, moderation history in exports), §4 (CAR replaces per-post ZIP)
Where: `domains/privacy/dsar/export` (policy map, SECURITY DEFINER function), migration, `interfaces/http/routes/settings/export`
Size: ~260 source lines, ~300 test lines

Goal: a signed-in user downloads every row the app holds about them as JSON and gets a link to their repository CAR;
the same `dsar.export(did)` serves moderators for users who cannot log in.

Inputs: DID-column registry (P1.13); `eraseDid` pattern (P3.07, SECURITY DEFINER owned by `migrator`); session
(P2.03); settings shell (P2.13); `resolveDid` (P2.01) for the PDS endpoint; `appendAudit` (P1.15); `draftMedia.listForExport` (P2.18).
Outputs:
- Checked-in `EXPORT_POLICY: Record<schema.table, {mode: 'include'} | {mode: 'redact', columns: string[], when?:
  RowPredicate, replaceWith?: string, reason} | {mode: 'exclude', reason}>`. `EXPORT_POLICY` and the `didColumns()`
  walk are catalogued in `02-shared-blocks.md` next to `eraseDid` (R10; the editor adds the entry). Defaults: sessions → redact `sid_hash`; OAuth token stores → exclude ("sealed
  credentials; listing them would export secrets"); `app.private_interaction` where the user is the **target** → redact
  `actor_did` (the actor was promised anonymity, P4.17a cell); reports **about** the user → redact `reporter_did` and
  `note`; reports **by** the user → include; moderation decisions about the user → include (plan §6); legal holds and
  sealed transmission data (`legal_hold`, `legal_hold_transmission`) → exclude ("legal preservation; disclosure could
  tip off", C-16); `video_upload` → include, except that a row in `matched_hold` shows its state as `unavailable`
  (the same generic copy the member sees, so the export does not tip off); `review_decision` and `appeal` → include
  (moderation history, plan §6) with `decided_by` redacted when a person decided; `bsky_post_draft`, `pending_comment`
  → include; audit lanes → include rows naming the DID minus other DIDs. Draft images (P2.18 `draft_media`) → included
  through `draftMedia.listForExport(did) → {key, mime, bytes}[]` (P2 note E25; whether the bytes travel inline or as
  short-lived signed links is settled in P4.00).
- Export hooks (decision 25, the export twin of P3.07's `eraseHooks`): data held outside the app database joins through
  a fixed list `exportHooks: {name, export(did) → AsyncIterable<JsonChunk>}[]` passed by `web`'s composition root (no
  registry); `draftMedia.listForExport` is its first entry, and each later data owner (chat in Phase 6, any future
  plugin) adds one in the same PR as its `eraseHooks` entry. The stream writes one `{hook: name, …}` section per entry
  after the tables.
- SQL function `app.dsar_export_page(did text, table_name text, after_key text, lim int) → jsonb` (SECURITY DEFINER,
  owned by `migrator`, `search_path` pinned) applying the policy; `EXECUTE` granted to `web` and `admin`.
- `dsar.export(did) → AsyncIterable<JsonChunk>` streaming `{generatedAt, did, handle, pds, carUrl, tables: {name:
  rows[]}}`.
- Routes: `GET /settings/export` (page) and `POST /settings/export` (download).

Algorithm (`POST /settings/export`):
  1. CSRF gate; session required; the DID is the session DID only (no `did` parameter exists).
  2. Rate limit `export` per DID: 3 per 24 h → `export.rate_limited`.
  3. `appendAudit(tx, {action: 'dsar.export', outcome: 'succeeded', actorDid: did})`.
  4. Respond `200`, `Content-Type: application/json`, `Content-Disposition: attachment; filename="unset-export-<date>.json"`,
     `Cache-Control: no-store`, streamed.
  5. Write the header object: `did`, verified handle, PDS endpoint from `resolveDid` (timeout 3 s; failure → `null`
     with a note), `carUrl = <pds>/xrpc/com.atproto.sync.getRepo?did=<did>` (a download link, not media), a note that
     blobs are listed by CID in the records and downloadable from the PDS.
  6. For each table in `didColumns()` (sorted): policy missing → abort the stream with an error marker (fail closed; the
     test below prevents it in CI). `exclude` → write `{table, excluded: reason}`. Else page through
     `dsar_export_page` with keyset `after_key`, 1,000 rows per page, at most 1,000 pages per table (cap logged).
  7. DB statement timeout per page 2 s; a timeout → retry once, then write an error marker and end the stream
     (the user retries; partial exports are marked incomplete).
  8. Close with `{complete: true}`.

`GET /settings/export`: explains what is included, what is excluded and why (the policy reasons, translated), the CAR
link, and the "download my data" form. Zero JS.

`dsar.export` for `admin`: same iterator, called by P5.08 under a GDPR case with its own audit event.

Edge cases and failures:
  - New table with a DID column added without a policy → CI fails (`export_policy_covers_registry`), production aborts the export rather than silently omitting.
  - Foreign-PDS user → `carUrl` points at their PDS.
  - Deactivated account (cannot log in) → only via `admin` `dsar.export` (P5.08).
  - Very large tables (100k likes) → streamed in pages; memory bounded.
  - Rows mentioning other DIDs (follows of the user) → included: they are the user's own records; private-interaction rows where the user is the target are redacted per policy.

Threats: the data export: every row we hold about the person.
  - E Exporting another person's rows → session DID only (`export_only_session_did`).
  - I Other people's identities, tokens or holds in the export → redacted or excluded
    (`export_redacts_actor_for_target`, `export_excludes_tokens_and_holds`, `export_reports_about_user_redacted`).
  - D Exports exhaust memory → streamed, rate limited (`export_streaming_memory_bounded`, `export_rate_limited`).

Done when (tests):
  - `export_policy_covers_registry`: every registry table has a policy entry; a new fixture table without one fails the test.
  - `export_includes_own_rows`: seeded user with drafts, saved feeds, private likes, ledger rows → all present.
  - `export_lists_draft_images`: two draft images → both listed from `draftMedia.listForExport`, none of another DID's.
  - `export_redacts_actor_for_target`: user B's private like on A's post → A's export has the row without B's DID; B's export has it with A's post URI.
  - `export_excludes_tokens_and_holds`: no sealed token bytes or hold rows in output; exclusion reasons present.
  - `export_matched_hold_shown_unavailable`: a `matched_hold` upload appears with state `unavailable` and no other hold detail.
  - `export_moderation_history_included`: decisions and appeals present; a human `decided_by` is redacted.
  - `export_reports_about_user_redacted`.
  - `export_only_session_did`: no parameter can change the DID; another user's rows never appear.
  - `export_streaming_memory_bounded`: 100k rows → peak heap growth < 32 MB.
  - `export_page_timeout_marks_incomplete`.
  - `export_rate_limited`, `export_csrf_applies`, `export_no_store_and_attachment_headers`, `export_audited_did_only`.
  - `export_function_security_definer_pinned_search_path`: catalog check.
Reuse:
  - `app/src/lib/post-export.ts` (hand-rolled ZIP and CRC32, per-post export) → REJECT: per-post ZIP is dropped for CAR plus JSON (plan §4).
  - `appview/src/db.ts:purgeDid` pattern (both directions) → LESSON for the registry-driven walk (P3.07 owns erasure).
Not in this step: erasure (P3.07); the admin GDPR case screen (P5.08); blob download bundling (the PDS serves blobs; not in plan).
Diagram: none.

---

### P4.27 — Nightly `metrics_daily`: rounded service-wide counts, no DID, 13-month retention

Tags: [SEC]            Depends on: P4.14, P4.25, P3.15            Plan: §6 Measurement (decision 17), §6 Retention (aggregate metrics 13 months)
Where: `interfaces/jobs/metrics`, migration `app.metrics_daily` and function `app.metrics_compute(day)`
Size: ~140 source lines, ~180 test lines

Goal: once a night, store a handful of rounded, service-wide counts for the previous day, never joinable to a person,
and delete rows older than 13 months.

Inputs: session store (last-seen), accounts/onboarding rows, profile publish state (P2.23, including first-publish
time), video publish and review decisions (P4.11, P4.14), reports (P3.15); `interfaces/jobs` scheduler (P4.25).
Outputs:
- Table `app.metrics_daily(day date PRIMARY KEY, accounts int, profiles_published int, videos_published int,
  videos_blocked int, videos_unsure int, sessions_active int, reports_opened int, reports_closed int,
  median_time_to_first_publish_s int NULL, computed_at timestamptz)`. No DID column (the DID-registry test must not list it).
- `app.metrics_compute(day date) → record` (SECURITY DEFINER, owned by `migrator`, returns already-rounded values);
  `retention` role gets `EXECUTE` on it and `INSERT, DELETE` on `metrics_daily`, nothing else.
- Job `metrics.daily.run(now)` at 03:45 UTC.

Algorithm:
  1. `day = (db now() at UTC)::date − 1`. Advisory lock `metrics.daily` (non-blocking; not acquired → exit 0).
  2. If a row for `day` exists → skip compute (idempotent).
  3. `metrics_compute(day)` inside the function: each count is a `count(*)` over its source with a `[day, day+1)` time
     predicate (accounts = total onboarded accounts at end of day; sessions_active = sessions whose last-seen falls on
     `day`); then `round(v) = v < 50 ? floor(v / 5) * 5 : v` (plan: "rounded to buckets of 5 below 50"; editor note E18);
     `median_time_to_first_publish_s` over accounts whose first publish fell on `day`, `NULL` when fewer than 5 such
     accounts. Function statement timeout 30 s.
  4. Insert the row. Error → exit 1 (health flag); next night computes only its own day (missed days are not back-filled,
     to keep the job simple; the gap is visible).
  5. `DELETE FROM app.metrics_daily WHERE day < (day − interval '13 months')`.
  6. Release the lock.

Edge cases and failures:
  - A count of 3 → stored as 0; 7 → 5; 52 → 52.
  - Fewer than 5 first publishers → median `NULL`.
  - Job runs twice → second skips.
  - Source table missing a timestamp column → the migration fails CI (the function is compiled at migration time).

Threats: aggregate metrics kept for 13 months.
  - I Counts that identify a person → rounded, small medians suppressed, no DID column (`metrics_rounding_table`,
    `metrics_median_suppressed_below_5`, `metrics_no_did_column`).
  - E The metrics role reading source tables → EXECUTE only (`metrics_role_cannot_read_sources`).

Done when (tests):
  - `metrics_rounding_table`: 0, 3, 4, 5, 7, 49, 50, 51 → 0, 0, 0, 5, 5, 45, 50, 51.
  - `metrics_median_suppressed_below_5`.
  - `metrics_no_did_column`: catalog check on `metrics_daily`; DID registry does not list it.
  - `metrics_function_returns_rounded_only`: the function's result type has no text or DID fields.
  - `metrics_role_cannot_read_sources`: `retention` role SELECT on `app.session` → permission denied; EXECUTE works.
  - `metrics_idempotent_rerun`, `metrics_retention_13_months` (row 13 months + 1 day old deleted, 13 months − 1 day kept).
  - `metrics_counts_window_correct`: seeded events at 23:59 and 00:01 UTC land on the right days.
Reuse: prototype had no metrics → nothing to salvage.
Not in this step: dashboards (the `admin` health board reads the table later); any real-user performance beacon (plan: none); the privacy-notice sentence (P5.12).
Diagram: none.

---

### P4.28 — Phase 4 exit: prototype social parity, one regression test per §2 defect, rendition and first-frame budgets

Tags: (none; gate)            Depends on: P4.16, P4.17, P4.18, P4.19, P4.20, P4.21, P4.22, P4.22a, P4.23, P4.24, P4.25, P4.26, P4.27, P4.14a (outline-only: unpublish a video)            Plan: §8 Phase 4 exit, §2 defects list, §6.1 budget table and WCAG
Where: `tests/exit/phase-4/` (Playwright and Vitest suites), `tests/regressions/prototype-defects.ts` (registry), `budget.json`
Size: ~120 source lines (registry, harness), ~500 test lines

Goal: prove Phase 4 is done: everything the prototype's social side did works (better), each prototype defect has a
named regression test, and the video budgets pass on a production build.

Inputs: all Phase 4 steps; the compose dev stack (P1.29) with the dev PDS and a Bluesky AppView stub (recorded
fixtures served by a local XRPC stub that the PDS proxies to via `PDS_BSKY_APP_VIEW_URL` in the test overlay, covering
`getTimeline`, `getFeed`, `getPosts` and `getFeedGenerators`) and a moderation-service stub for `createReport`; the
review worker with fixture clips and fixture images.
Outputs:
- `PROTOTYPE_DEFECTS` registry: one entry per §2 defect `{id, text, testIds[], ownerStep}`; a Vitest check that every
  entry has ≥1 test id that exists in `vitest list --json`, except entries whose `ownerStep` is in Phase 6, which are
  checked at L.03 (they are listed now so they cannot be forgotten).
- Parity checklist (in the PR description and as Playwright tests), each mapped to the prototype feature it replaces.
- Budget report artefact (ffprobe JSON and Playwright timings) attached to the CI run.

Algorithm (exit run):
  1. Build production images; start the stack with the test overlay; seed two members (A public, B private), one foreign-PDS member (C) and fixture clips.
  2. Run the parity suite (below). Any failure → not done.
  3. Run the defect registry check and every listed regression test.
  4. Run the budget suite (below) three times; take the median per metric; compare with `budget.json`.
  5. Run axe (wcag2a..wcag22aa) on home, every tab type, permalink, compose, settings/feeds, settings/export, report — light and dark, EN and FR — zero violations.
  6. Manual keyboard pass (plan §6.1, per phase exit): a checklist file signed in the PR by the person who did it (Alex or delegate); the agent prepares it and stops for the sign-off.

Parity suite (prototype feature → test):
  - Posts with media privacy → `parity_video_publish_play`: A uploads, review passes, publishes; B sees it in "unset.sh latest"; it plays via the media proxy; no `getBlob` URL in any page.
  - Follows → `parity_follow_unfollow`: B (private) follows A → app-DB row only, A sees "follows you"; A (public) follows C (foreign PDS, no `sh.unset.profile`) → an `app.bsky.graph.follow` in A's repo, indexed, C's follower count +1; A follows D (an unset.sh account) → an `sh.unset.follow` (answer 29b).
  - Home timeline → `parity_following_tab_merges`: A's Following shows C's Bluesky post (stub) and B-followed video ordering.
  - Likes → `parity_like_unlike_counts`.
  - Comments → `parity_comment_thread_nested`.
  - Directory/search → `parity_directory_lists_public_only` (P3.14, re-run).
  - Post report → `parity_report_reaches_queue`.
  - Standalone Bluesky post → `parity_bsky_post_after_review`: A writes text and one image; review passes; the publish
    restores A's session server-side; one `app.bsky.feed.post` in A's repo, its blob uploaded immediately before the
    `applyWrites`.
  - Export → `parity_export_car_and_json` (replaces per-post ZIP).

Regression tests per plan §2 defect (registry contents):
  1. "A post edit wipes its likes and comments (keyed on CID)" → `like_counts_survive_edit` (P4.19), `thread_survives_root_edit` (P4.20), plus end-to-end `regression_edit_keeps_social`: edit a published video's caption (new CID) → like and comment counts unchanged on the permalink.
  2. "A comment's root is always set to its parent" → `reply_root_reply_to_reply` (P4.20) plus end-to-end `regression_reply_root_in_repo`: reply to a reply, read the record back from the dev PDS → its `subject` is the video (plan §5.8 `sh.unset.comment`).
  3. "Bluesky likes share our like collection; the toggle throws after 5,000" → `like_toggle_with_5001_bsky_likes`, `like_foreign_subject_dropped_at_ingest` (P4.19).
  4. "Chat authorisation rebuilds the Matrix id from the current handle; the login callback doesn't check whose account it got" → owner P6.03/P6.07 (checked at L.03).
  5. "Space join links make a Space public to the federation" → owner P6.10 (`join_rules` pinned at PL 100; checked at L.03).
  6. "Dead chat provisioning adds up to 2.5 s to every login" → `regression_login_makes_no_chat_calls`: **login of an
     existing account** with a network spy → zero calls to any Matrix host and zero calls to `chat-admin`; owner P2.06
     (test runs now). Signup seeding through `chat-admin` (Phase 6) is asserted separately in P6.05, so this test does
     not break when it lands (R6).
  7. "An 'unpublished' profile, including any shown email, is a public repo record" → `regression_unpublished_profile_not_in_repo` (P2.23): unpublish → `listRecords` on the dev PDS returns no `sh.unset.profile` and no email anywhere in the repo CAR.
  8. "The PDS prefs patch lets any OAuth client read and write preferences" → `regression_pds_image_unpatched` (P1.30 preflight: PDS image digest equals the pinned upstream digest; no `app.*.actor.*Preferences` route answers on the dev PDS).
  9. "`account-manager` mounts every signing key to read one table" → `regression_no_account_manager_service`: compose files contain no such service and no service other than the PDS mounts the PDS data volume.
  10. "`com.atproto.admin.*` is publicly routed" → `regression_admin_xrpc_denied_at_edge` (P1.28): request through the edge → 403/404.
  11. "`rss-worker` compares its secret in non-constant time and reads bodies with no size limit" → `regression_secret_compare_constant_time` (static test: every comparison of a configured secret goes through the one `timingSafeEqual` helper) and `regression_body_limit_global` (P1.06: an oversize body to any route → 413).
  12. "Post reports end up in logs, not in a moderation queue" → `report_never_logs_pii`, `report_goes_to_queue` (P4.24).

Budget suite (plan §6.1):
  - `budget_rendition_bitrates`: ffprobe on every fixture's 360p and 720p → `bit_rate` ≤1.2 Mbps and ≤3 Mbps; keyframe interval 2 s (±1 frame); `moov` before `mdat` (faststart).
  - `budget_poster_size`: AVIF and WebP posters ≤30 KB with dimensions matching `aspectRatio`.
  - `budget_first_frame`: Playwright, mid-range Android emulation, Lighthouse "slow 4G" throttling (1.6 Mbps, 150 ms RTT); scroll a clip into view; time from IntersectionObserver entry to `loadeddata` ≤1.0 s (median of 3).
  - `budget_feed_page`: LCP ≤2.5 s, CLS ≤0.1, TBT ≤200 ms on `/home` (LHCI); JS ≤75 KB gz total, `feed-list` and `video-player` islands ≤15 KB each.
  - `budget_permalink_zero_js`: `/@handle/p/{rkey}` 0 bytes of JS, HTML ≤30 KB gz.
  - `budget_transcode_wall_time`: 60 s clip ≤90 s on two cores (P4.05 metric, re-read here).

Edge cases and failures:
  - A Phase 6 defect has no test yet → allowed only with `ownerStep` in Phase 6; the registry check enforces it at L.03.
  - First-frame budget fails on CI hardware noise → rerun is not a fix; the median of 3 is the rule; a real miss stops the exit and is reported (likely causes: GOP too long, missing faststart, poster heavy).
  - The Bluesky stub drifts from the real AppView → the stub's fixtures are recorded from real responses and validated by the vendored lexicons on load.

Done when (tests):
  - All parity tests above pass on the production build.
  - `prototype_defects_registry_complete`: 12 entries; entries 1–3, 6–12 resolve to executed test ids; 4–5 owned by Phase 6.
  - Every budget test passes against `budget.json`.
  - axe matrix zero violations; the keyboard checklist is signed.
  - "Discovered equals executed" guard green for the whole repo.
Reuse:
  - `appview/test/db.test.ts:56` (stale delete cannot erase a newer follow) and `:75` (timeline gates) → LESSON, provisional — for reuse review: port as behaviour specs into P4.18/P4.21 tests.
  - `appview/test/db.test.ts:123` → REJECT (asserts the CID-keyed defect; its inverse is defect 1's test).
Not in this step: production sizing and CDN (Phase 5); chat defects' implementations (Phase 6); the launch gate (L.*).
Diagram: none.

---

## Notes for the editor

Plan gaps, outline errors and contradictions found while writing Phase 4, kept as the two writers left them after
round 2. Alex question labels are namespaced per part: `P4a-` for P4.01–P4.15 and `P4b-` for P4.16–P4.28. The
editor pass is at the end.

### Part 1 notes (P4.01–P4.15)

Plan gaps, outline errors and contradictions found while writing P4.01–P4.15, updated after the round-1 review
(`reviews/r1-phase-4-part1.md`). Nothing here was changed in the outline, README, plan or plan-issues.

**Decisions and security design needing review**
1. **C-16 buffer (Alex decision 21).** Encrypted to the legal-hold public key at upload (P4.03), kept for up to 7 days and moved unchanged into the hold on a match (P4.07), destroyed at once on no match (P4.06) and at the hard check deadline otherwise (P4.03 sweeper). Other steps must carry: (a) **P2.16 image uploads need the same buffer** (profile pictures, banners, any image pipeline) with the same tests; (b) P5.04 backups exclude `transmission_buffer` data (UNLOGGED here, so also absent from WAL and replicas) and keep `legal_hold_transmission` and `legal-hold/*` beyond pruning; (c) the "no IP written" CI check (P0.06 / admin design §8.1) allow-lists exactly these two tables.
2. **Public-key seal** `seal.encryptTo(pubKeyId)` goes into the one seal module as **P1.14a** (catalogued in `02-shared-blocks.md`); the legal-hold key pair joins the P0.12 ceremony (inventory row K2, opened only with one of the two hardware keys; P0-A4 answered).
3. **Where the legal-hold private key lives is Alex question P4a-A1.** P4.07 is built with the recommended default: no server holds it; `admin` only exports the sealed record; the owner decrypts offline. The online-decrypt path is not built. Settled by Alex (2026-10-03, answers 1 and 31).
4. **`P3.16c` preserve verbs** (create, notify, listExpired, close): `pds-admin` accepts `review_egress`'s `PDS_PRESERVE_KEY` for `preserve.create` only (as `web`'s key for `invite.issue`), the `retention` key for listExpired/close, owners for notify. Specified in P4.07.
5. **Egress network (plan issue):** `review_egress` reaches the outside hosts through the hostname-allow-list forward proxy (a P1.18 change) **and** internal `pds-admin` `preserve.create` only. It reads no media except `frames-cleared/*` (review F1). *[Superseded 2026-10-03 by answer 30b: one outside host (Arachnid Shield), no media at all; see the editor pass below.]*
6. **Lawyer hour (P5.12 list):** preservation clock (expiry `notifiedAt + 365 d`; analyst holds 365 days after creation); the report-vs-analyst table, including whether an **exact** `harmful-abusive-material` match is reportable; tipping off (generic "unavailable" copy, no in-app appeal for `matched_hold`, no automatic takedown); Cybertip.ca submission stays manual by an owner (no API assumed).
7. **Roles and cross-role writes:** new roles `review`, `review_egress`; definer functions and narrow grants for `web`→`review_job` (cancel only), `review`→`web_job` (insert only), `admin`→`review_job` (`unblur_frame`, `manual_match` only), `retention`→`close_expired_hold`; the audit role→action map needs `review.*` actions. All belong in P1.12's grant matrix.

**Contradictions or gaps in the plan text**
8. **TMK+PDQF dropped from v1 (plan issue):** no provider available to us accepts it; v1 computes PDQ + MD5 only and re-adds TMK when a provider does.
9. **Arachnid Shield API unverified:** P4.06 depends on a `[SPIKE]` sub-step **P2.16a** (ADR with the verified endpoint, batch maximum, classification names, MD5 lookup and test hash). A contradiction stops the build.
10. **Foreign-PDS blob limit (plan issue, review F5):** the PDS default `blobUploadLimit` is 5 MB (the installer sets 300 MB); our P1.30 preflight asserts `PDS_BLOB_UPLOAD_LIMIT ≥ VIDEO_MASTER_MAX_BYTES`; for a foreign PDS P4.14 retries once with `r720.mp4` as the repo blob (`master_downgraded`). The plan says the repo blob is the 1080p master.
11. **Plan wording:** "renditions and posters live in our media storage"; the caption blobs (P4.02, Bluesky's shape) and the `embed.external` fallback thumb (P4.15) are repo blobs by design.
12. **Consent placement:** the outline puts the checkbox in P4.14, but frames leave at submission. P4.11 records consent server-side and refuses submission without it; P4.14 owns the screen.
13. **Private posts:** stored under `drafts/<did>/private/` without the 30-day rule (P4.14); P4.25 must exclude that prefix; the **P2.22 flip-to-public batch** must route every private video through submission and review before writing.
14. **Publish after async review restores the OAuth session server-side** with no user present (P4.14; plan issue to state it); `needs_reauth` covers revoked grants.
15. **Draft TTL vs appeals:** P4.25 skips `appealed` uploads; appeals older than 7 days alert (already a plan issue).
16. **Statements of reasons** are delivered in-app only; P5.08 confirms that suffices.
17. **Unpublish of a video** has no row: new **`P4.14a`** (repo delete, `media/` removal, Bluesky post delete).
18. **250 MB single-request upload, no resume:** accepted for v1; the test track measures failed uploads.
19. **P4a-A2 to Alex:** may a P4.12 reviewer play the 360p rendition (audited), or frames and transcript only (this file's v1)? Batched with **P4.01 Q4b** (are text comments reviewed?).

**Outline changes to record (review F15; `01-outline.md` not edited)**
20. P4.04 deps add P1.18, P1.02, P1.03.
21. P4.06 deps add the P2.16a ADR (new `[SPIKE]` sub-step of P2.16).
22. P4.07 deps add P4.03, P3.20 and `P3.16c`; P4.12 deps add P4.05.
23. P4.02 tag `[ALEX]` (lexicon publication by the `goat` runbook); P4.15 tag `[ALEX]` (disposable crawled PDS hostname, since the development PDS has no crawlers).
24. New rows: P1.14a (public-key seal), P2.16a (Arachnid API spike), P3.16c (preserve verbs), P4.14a (unpublish a video).
25. Job order at run time differs from build order: probe → fingerprint → limits → transcode (P4.04 table). P4.17's images need the P2.16 gate with the C-16 buffer and reuse P4.08 and P4.09a (P4.10 is off in v1, answer 30b).

**Licences to verify (all USE candidates)**
26. ffmpeg with libx264 (GPL-2.0+; the image must offer source); ThreatExchange PDQ (per-directory licence); NudeNet-class weights and code (package MIT; YOLOv8-derived weights may be AGPL-3.0, lawyer hour), `onnxruntime-node`; the gore model `image-safety-classifier-s` (MIT); Detoxify `multilingual` (Apache-2.0); Llama Guard 3 1B (Llama 3.2 Community Licence, "Built with Llama", lawyer hour) and llama.cpp (MIT); whisper.cpp and the `base` weights (MIT); (the Anthropic TypeScript SDK is no longer used in v1, answer 30b); the smokescreen-class egress proxy (P1.18); the `age` implementation and hardware-key plugin (P1.14a); the Arachnid Shield SDK only if used.

#### Round 2 (part 1)

| Finding | What changed |
|---|---|
| F1 | Egress no longer reads, copies or deletes media. New compute job `preserve_copy` writes the encrypted copy (write-only credentials on `legal-hold/*`) and deletes drafts. Egress credentials are read-only on `frames-cleared/*`. New tests `egress-cannot-read-upload` (P4.04) and `egress-never-reads-media` (P4.07). Storage table, P4.04 grants and the diagrams updated. |
| F2 | Transaction A calls `keep_transmission_for_match` (buffer expiry now + 7 d). The sweeper skips `matched_hold` buffers. There is an owner alert at day 6 and destruction at day 7. Tests `match-near-deadline-keeps-buffer` and `match-buffer-unmoved-7d`. |
| F3 | Probe split into probe → fingerprint → limits. Only an undecodable file skips PDQ, and its MD5 is still checked. Sampling is capped at 63 frames across the real duration. The P4.05 and P4.06 tests were rewritten. |
| F4 | P4.07 uses "Export sealed record". No server holds the private key, and the owner decrypts offline. P4a-A1 settled by Alex (2026-10-03). Tests `export-requires-owner-signature` and `roles-cannot-decrypt` (now including `admin`). |
| F5 | P4.14 handles 413 differently by PDS. On our PDS it is a preflight misconfiguration and goes to `publish_failed`. On a foreign PDS it retries once with r720 and sets `master_downgraded`. Two tests added; plan issue noted (item 10). |
| F6 | P4.06 depends on the P2.16a ADR. Batch size, names and the MD5 lookup come from it. |
| F7 | When no frame is hashable, P4.06 still runs the MD5 lookup. Test `check-low-quality-still-md5`. |
| F8 | P4.04 uses an egress forward proxy with a hostname allow-list, referenced as a P1.18 change and not designed here. No IP firewall list. |
| F9 | P4.10 sends the captions cue text as a fourth delimited section (≤20,000 bytes). The request-shape test was updated. |
| F10 | Cross-role definer functions and grants added in P4.04, P4.07, P4.11 and P4.12. The `provider_access_lost` flag replaces egress writing `uploadsEnabled`. |
| F11 | One unblur reveals an item's whole frame set, and the limit is 30 items per day. Test `unblur-limit-counts-items`. |
| F12 | Stream pick ignores `attached_pic` and prefers but does not require `default`. Test `probe-cover-art`. |
| F13 | Terminal publish failures delete `media/<did>/v/<rkey>/`. `prepareBskyVideo` now runs before `uploadBlob(master)`. Tests added. |
| F14 | One state enum including `appeal_upheld` and `publish_failed`, with `needs_reauth` and `master_downgraded` as flags. State diagram updated. `-g 2×min(fps, 60)`; CRF 23 on r720 and r360; `snapshot_hash` uses the sha256 of the master. |
| F15 | Outline changes recorded (items 20–25). The P4.02 and P4.15 tags in this file now show `[ALEX]`, and the P4.04/P4.06/P4.07 "Depends on" lines include the new dependencies. |
| Note 9 | TMK removed from outputs, tests, the image and diagrams; one sentence kept in P4.06. |

### Part 2 notes (P4.16–P4.28)

Plan gaps, outline errors and contradictions found while writing P4.16–P4.28, updated after the round-1 review
(`reviews/r1-phase-4-part2.md`). None of the other files were edited. E21–E27 are new in round 2.

- **E1 (outline, new steps).** P4.17a (interaction policy) and P4.22a (feed-generator endpoint) are added with reasons in
  each step. Outline rows needed; P4.18, P4.19 and P4.20 then depend on P4.17a.
- **E2 (outline, missing dependencies).** P4.18 also needs P3.05 (follow ingest) and P2.07 (writes); P4.19 and P4.20 need
  P2.07; P4.20 needs P4.11 when comments are reviewed; P4.21 needs P4.16, P4.19, P4.20 (it renders players, counts and
  comments); P4.25 needs P2.18 and P4.07 (holds); P4.26 needs P1.13 and P2.13; P4.27 needs P3.15 and the P4.25 job
  runner; **P4.28 lists only P4.16 and P4.22 but must depend on every P4 step it checks.** P4.17 needs P2.07 and P2.22.
- **E3 (plan gap, comment review).** §5.8 says every public post (video or Bluesky post) is reviewed before going public. A
  reply to a Bluesky post *is* an `app.bsky.feed.post`, so the literal plan puts comments through the Claude review
  (cost, latency). P4.20 builds both options behind `comment.review` and defaults to `before_publish`; P4.01 should
  decide it explicitly. Also: should `sh.unset.comment` (if chosen) be reviewed the same way?
- **E4 — settled by Alex (2026-10-03, answers 26–28): the author sees who; going public converts in the same batch as posts.**
- **E4 (plan gap, privacy matrix detail).** The Q2b proposal does not say whether the author of a post sees *who*
  privately liked or commented ("a member liked this" suggests anonymous). P4.17a carries `targetSeesActor`; P4.01 must set it.
  It also does not say what happens on a flip (convert / drop / keep). P4.17a carries `flip` rules; P4.01 must set them.
- **E5 (plan gap, Bluesky media in our pages).** Bluesky posts in feed tabs carry media on `cdn.bsky.app` and HLS on
  `video.bsky.app`. Showing them sends viewer IPs to Bluesky (privacy notice) and needs CSP entries; proxying contradicts
  "net-guard only talks to the user's PDS"; HLS contradicts "no hls.js". P4.21 was marked `[STOP on Bluesky media hosts]` (removed 2026-10-03: answer 33, P4.21a)
  and builds text-only with a link (option c) until Alex picks.
- **E6 (plan gap, scopes).** Adding a feed by URL wants `app.bsky.feed.getFeedGenerator(s)` to show the feed's name;
  reporting Bluesky posts to Bluesky's moderation wants `rpc:com.atproto.moderation.createReport?aud=<bsky mod service>`;
  a Bluesky thread view wants `getPostThread`. None is in the §3 scope string, and adding scopes later forces re-consent
  for everyone. Recommend adding `getFeedGenerators` (and deciding on `getPostThread`) to P2.04's scope now. The book
  works around all three (user-supplied label, our queue only, link out). **Round 2:** folded into the plan (22:49Z);
  all three are requested from day one. P4.22 now names a feed from `getFeedGenerators`, and P4.24 forwards Bluesky
  reports with `createReport`. The thread view stays unbuilt (link out).
- **E7 (ownership gap, rendition readiness).** Nothing in the outline says who records "renditions exist for this master
  CID" in a table that `web`, `api` and `media` can read. Without it, a `sh.unset.video` written by another client (no
  review) would be indexed and could be shown. P4.16 assumes P4.05 writes `idx.rendition_set`; the review worker then
  needs a DB role with INSERT on that one table, which P1.12's role list lacks. Similarly the `media` process needs a
  read-only role on the index (P1.12 lists no `media` role). **Round 2:** accepted (R8). Part 1 now copies the files to
  `media/` at publish (P4.14), so the `rendition_set` writer becomes P4.14's publisher (E25).
- **E8 (ownership gap, video ingest).** No step registers `sh.unset.video` with the P3.05 ingest (promoted `video_cid`,
  `created_at`). P4.16 and P4.21 assume it; suggest P4.14 or P4.02 owns it.
- **E9 (assumed interface, twin dedupe).** P4.21 dedupes the "also post to Bluesky" twin by giving the
  `app.bsky.feed.post` the same rkey as the `sh.unset.video`. P4.14 must adopt this (or store the pairing somewhere both
  `web` and the index can read).
- **E10 (contradiction, TTFB budget).** §6.1 sets origin TTFB ≤200 ms warm for all pages, but `/home` must call the user's
  PDS (and Bluesky behind it) before it has content. P4.21 streams the shell first; if P1.20's glue cannot stream, `/home`
  needs a written budget exception.
- **E11 (plan gap, captions storage).** §5.8 says the record has an optional `captions` (WebVTT) field *and* that caption
  files live in our media storage. If `captions` is a repo blob, the edited WebVTT is public in the repo (fine, it is a
  public post) and we serve a copy; if it is not a blob, other apps cannot get captions. P4.02 decides; P4.16 serves our copy either way.
  **Round 2:** decided (plan §5.8, 22:49Z): caption files are repo blobs with a served copy in `media`.
- **E12 (order, labels before Ozone).** P4.23 consumes "our labeler's stream", but Ozone is deployed in P5.07, which depends
  on P4.23. P4.23 is built and tested against a fixture labeler; the live subscription is configured in P5.07. The
  `atproto-accept-labelers` header names our Ozone DID, which does not exist until P5.07 (config placeholder in dev).
- **E13 (gap, Bluesky labels on our users).** Review 03-data MINOR-2 suggested lazily querying Bluesky's labels on our
  members' accounts; the plan does not include it. Not built.
- **E14 (gap, default tabs).** The plan lists Following plus user-picked feeds; review 07 SERIOUS-2 recommends a "New on
  unset.sh" tab on by default for the cold start. P4.22 defaults to Following + "unset.sh latest". **Settled by Alex
  (2026-10-03 16:42Z, answer 35): Following + unset.sh latest.**
- **E15 (interface extension).** P4.24 needs P3.15's `ReportSubject` to cover Bluesky records (`origin: 'bsky'`), private
  comments (app-DB id) and accounts. Writer of P3.15 should include these kinds.
- **E16 (outline/skeleton gap, scheduled jobs).** P4.25 and P4.27 need a scheduled process running as the `retention`
  role. P1.01's skeleton has no such app. The book adds `apps/jobs` (one entrypoint, daily schedule, advisory locks);
  P5.09 should reuse it.
- **E17 (contradiction, appeals vs expiry).** §5.8: "A clear fail stays in draft storage until the appeal is decided, then
  is deleted (drafts expire after 30 days regardless)." An appeal opened late loses its evidence at day 30. P4.25 follows the
  plan (delete at 30 days unless legally held); Alex should confirm or extend the TTL while an appeal is open.
  **Round 2:** decided (plan §5.8, 22:49Z): the expiry skips an open appeal with no time limit, and an appeal older
  than 7 days raises an alert. P4.25 is rewritten to match.
- **E18 (ambiguity, metric rounding).** "Rounded to buckets of 5 below 50" is read as `floor(v/5)*5` for `v < 50`, exact
  above. Review 07 proposed k ≥ 5 suppression; P4.27 also suppresses the median below 5 contributors. Confirm.
- **E19 (plan gap, blocks and mutes for our videos).** Bluesky items arrive with the viewer's blocks and mutes applied;
  our index-hydrated videos do not (we do not index `app.bsky.graph.block`). A member who blocks someone on Bluesky can
  still see that person's unset.sh videos in "unset.sh latest". Not in plan scope; flag for Alex. **Settled by Alex
  (2026-10-03 16:41Z, answer 34): apply signed-in members' Bluesky blocks to unset.sh feeds** (P4.21, P4.22; mutes are
  not part of the answer and stay unapplied).
- **E20 (plan wording).** §5.2's public read API lists `getTimeline` with service auth; P4.21's Following tab runs inside
  `web` with the app session, so the `api` `getTimeline` (P3.11) is for third-party clients only. Worth one sentence in the plan.
  **Round 2:** folded into the plan (22:49Z, §5.2 public read API).
- **E21 (plan gap, follow scope; new).** The §3 scope string (22:49Z) has `repo:app.bsky.feed.like` and
  `repo:app.bsky.feed.post` but no `repo:app.bsky.graph.follow`. With the Q2b default (public follows are
  `app.bsky.graph.follow`, the shared graph), P4.17a's `assertComplete` fails at boot, as designed. Recommend adding
  `repo:app.bsky.graph.follow?action=create&action=delete` to the day-one scope, for the same re-consent reason as E6.
  For `plan-issues.md` through the coordinator.
- **E22 (gap, approved but never published; new).** Part 1's state diagram gives `approved` (including the
  `needs_reauth` flag) no expiry, so a member who never signs in again keeps a reviewed draft forever. P4.25 follows the
  diagram and leaves it alone. Suggest one rule (for example, expire `approved` + `needs_reauth` 30 days after the flag
  was set) decided once for videos, Bluesky posts and comments.
- **E23 (cross-file, two legal-hold tables; new).** P2.16 defines `app.legal_hold` (sealed media in the row, kind
  `fingerprint_match`) and P4.07 defines `legal_hold` (display copy keyed by `upload_id`, `pds-admin` authoritative).
  P4.25's `app.is_held` reads P4.07's table only; image matches never reach the draft store, so P2.16's rows are not
  needed by expiry. The editor should reconcile them into one table or name them apart.
- **E24 (product choice for Alex; new).** P4.24 forwards a Bluesky report to Bluesky only when the reporter ticks a box,
  unticked by default, because the forward reveals the reporter's account to Bluesky (the same opt-in default as
  decision 4's "also post to Bluesky"). The plan's wording ("so reports about Bluesky posts reach Bluesky") could also
  mean always forward or ticked by default. Built: opt-in; Alex confirms. **Settled by Alex (2026-10-03 16:43Z,
  answer 36): always forward reports on Bluesky posts, from our moderation service account, never the reporter's DID;
  never forward reports on unset.sh content.** The opt-in tick is removed (P4.24).
- **E25 (ownership, `rendition_set` writer; new).** R8 gave the `review` role INSERT/UPDATE on `idx.rendition_set`,
  but part 1 moved the copy into `media/<did>/v/<rkey>/` to P4.14's publisher, which runs in `web`. This file assumes
  the publisher inserts the row after the copy, so `web` needs INSERT on that one index table and `review` needs
  nothing there. If P4.14 keeps the copy, P1.12's matrix should say so; if the copy moves back to the worker, R8's grant
  stands.
- **E26 (gap, bucket lifecycle vs appeals and private posts; new).** The plan gives the `drafts` store a 30-day
  lifecycle rule, but an appealed draft must outlive 30 days and private posts live under `drafts/<did>/private/`. An
  age-only rule would delete both. Options: filter the rule by an object tag that P4.13 sets when an appeal is filed
  (and never on private posts), or move appealed and private objects to a prefix the rule does not cover. Phase 5
  storage config and P4.13 decide; P4.25 does not rely on the rule.
- **E27 (assumed interfaces in part 1; new).** This file assumes (a) part 1's P4.11 grows `ReviewJob` into the union in
  the interface table (R4); (b) P4.13 files an appeal by updating the upload's row from `blocked` to `appealed`, which
  takes the row lock P4.25 relies on; (c) P4.13 shows the overdue-appeal list in `admin`, while P4.25 only counts and
  raises the flag.

#### Round 2 (part 2)

| Finding | What changed |
|---|---|
| R1 (P4.17 blob GC) | The GC claim is gone. P4.17 step 10d uploads images only immediately before `applyWrites`, and a retry re-uploads the same stored bytes (same CID, never a fresh re-encode), citing `transactor.ts:89`, `:127-134` and `:298-310`. The record key is chosen once, so a lost response is recovered by reading the record back. The edge case was rewritten, and tests `bsky_post_retry_reuploads_same_bytes`, `bsky_post_blobs_uploaded_just_before_applywrites` and `bsky_post_lost_response_same_rkey` were added. P2.23 and P4.14 are other files: P4.14 already follows the rule (part-1 step 6a), and P2.23 is left to the editor. |
| R2 (P4.18 followable) | `isFollowable` now requires the account to be active and not delisted with **either** switch public. The private-profile state page shows Follow when posts are public. Tests `follow_followable_profile_private_posts_public` and `follow_unfollowable_both_private` were added (the latter replaces `follow_unfollowable_private_profile`). |
| R3 (double-click races) | P4.18, P4.19 and P4.20 wrap check-then-write in `withDidLock(viewer)` (P1.17, new namespace `social_write`, interface row added); a `LockError` maps to `social.busy`. Comments also carry a one-time `submission_id` (new nullable column on `app.own_interaction`), since a comment has no "already" check. Unfollow and unlike stay duplicate-tolerant for records written by other clients. Tests `follow_double_click_one_record`, `follow_lock_timeout_busy`, `like_double_click_one_record` and `comment_double_submit_one_record` were added. |
| R4 (ReviewJob union) | The P4.11 interface row now defines `ReviewJob` as `video \| bsky_post \| comment` with one pipeline per kind. `bsky_post` uses the P2.16 gate at upload, then the P4.08 nudity gate, then the P4.10 classifier; `comment` is text only, with no frames and no nudity gate. P4.17 and P4.20 submit those kinds, with tests `bsky_post_review_job_shape`, `bsky_post_images_nudity_never_leave` and `comment_review_job_text_only`. Part 1's P4.11 still has to grow the union (E27a). |
| R5 (hold index location) | Picked the Postgres option. P4.25 reads part 1's `legal_hold` table through the definer function `app.is_held(upload_id) → boolean` (EXECUTE to `retention` only), and `pds-admin` is never called by the job. Tests `expiry_role_grants` and `expiry_is_held_definer_pinned_search_path` cover it. The second hold table in P2.16 is E23. |
| R6 (P4.28 regression 6) | Scoped to login of an existing account, with zero calls to Matrix hosts and to `chat-admin`; signup seeding is asserted in P6.05. |
| R7 (P4.21 Bluesky follows) | Step 5 now says the followed set includes `app.bsky.graph.follow` records made on Bluesky or any client. Test `following_includes_bsky_graph_follows` was added. |
| R8 (roles) | Accepted for `media`: read-only on `idx.record`, `idx.account` and `idx.rendition_set`, stated in P4.16's inputs, with test `rendition_media_role_read_only`. **Partly rejected** for `review`: the reason is that part 1 now writes `media/<did>/v/<rkey>/` in P4.14's publisher, which runs in `web`, so `review` never touches `rendition_set` and `web` needs the INSERT instead (E25). |
| R9 (P4.23) | No change (the review found it correct). |
| R10 (export policy) | The P4.26 outputs say `EXPORT_POLICY` and the `didColumns()` walk belong in `02-shared-blocks.md` next to `eraseDid`. Only this file was edited, so the catalog entry is the editor's. The policy also gained part-1 tables (`matched_hold` shown as `unavailable`, moderation history included with human `decided_by` redacted) and two tests. |
| E1, E2 | Accepted by the lead (outline rows and dependencies in the editor pass). This file's "Depends on" lines and diagram now also include P4.14 → P4.16; P2.16, P4.08, P4.10 and P4.13 → P4.17; P1.17 → P4.18–P4.20; P4.07 and P4.13 → P4.25; P2.07 and P4.23 → P4.24. |
| E3, E4, E14, E19 | To Alex; unchanged. The builds stay parameterised (`comment.review`, `targetSeesActor`, `flip`, default tabs). |
| E5 | To Alex; option (c) text-only stays the build default and the stop point stays on P4.21. |
| E6 | Folded into the plan (22:49Z). P4.22 uses `getFeedGenerators` for the lookup and the default label (tests replaced: `feeds_add_generator_missing_or_invalid`, `feeds_add_lookup_timeout_not_saved`, `feeds_add_label_from_display_name`, `feeds_add_offline_saved_with_notice`). P4.24 forwards Bluesky reports with `createReport` through the reporter's PDS, opt-in (E24), with five tests. P4.21 says the `getPostThread` scope exists but the thread view is not built. |
| E7, E8, E9, E16 | Accepted (`media` role; P4.02 owns `sh.unset.video` ingest; same-rkey twin adopted by part 1; `apps/jobs`). The interface table was updated, and the `rendition_set` writer follows part 1 (E25). |
| E10 | Accepted; P4.21 step 11 states the written TTFB budget exception. |
| E11 | Decided by the plan: caption files are repo blobs plus a served copy. Stated in the P4.02 interface row and in P4.16. |
| E12, E15, E18 | Accepted as written; no change. |
| E13 | Not built; not in the plan. |
| E17 | Decided by the plan: an open appeal never expires and older than 7 days alerts. P4.25 was rewritten with the shared `expirable` predicate (`appealed` excluded with no time limit), a row-locked expiry so an appeal and an expiry never both win, the `appeal.overdue` flag, and tests `expiry_never_expires_appealed`, `expiry_appeal_filed_during_run`, `expiry_overdue_appeal_flag` and `expiry_predicate_table`. |
| E20 | Folded into the plan; noted. |
| Plan 22:49Z: TMK+PDQF dropped | This file computed no video fingerprints. The P2.16 interface row now says PDQ + MD5 only. |
| Plan 22:49Z: server-side session restore | The P2.07 interface row states `pdsAgentFor` restores the session server-side. P4.17 and P4.20 publish after an asynchronous pass with no user present; a revoked grant gives `approved` + `needs_reauth` ("Sign in to publish", `publish-now`). Tests were added; `bsky_post_auth_lost_keeps_session` was replaced by `bsky_post_revoked_grant_sign_in_to_publish`. |
| Part-1 alignment | The header points to `phase-4-part1.md`. P4.17 and P4.20 use part 1's state names (`reviewing`, `unsure`, `blocked`, `appealed`, `appeal_upheld`, `approved`, `published`, `publish_failed`, `expired`), and `needs_reauth`/`master_downgraded` are flags. P4.16 uses the `media/<did>/v/<rkey>/` layout with `r360.mp4`/`r720.mp4`/`captions.<lang>.vtt`, gates on `rendition_set.master_cid = video_cid`, and takes 1080p from the repo blob route (`null` when `master_downgraded`). The interface rows cover part 1's job kinds (`limits`, `preserve_copy`, `unblur_frame`, `manual_match`) and `review_egress` reading only `frames-cleared/*`. P4.17's images go through the P2.16 gate with the C-16 buffer and reuse the P4.10 classifier. P4.25 excludes `drafts/*/private/`. |
| New notes | E21 (follow scope missing from §3), E22 (`approved` + `needs_reauth` never expires), E23 (two legal-hold tables), E24 (report forwarding default), E25 (`rendition_set` writer), E26 (bucket lifecycle vs appeals), E27 (assumptions about part 1). |

### Editor pass (2026-10-03)

Merge: `phase-4-part1.md` and `phase-4-part2.md` were merged into this file on 2026-10-03, with one header, one
"Shared definitions" section, both dependency diagrams, the flows, the steps in id order (P4.01–P4.15, P4.16, P4.17,
P4.17a, P4.18–P4.22, P4.22a, P4.23–P4.28) and these notes. Each part file is now a one-line pointer. A line-by-line
check found every non-blank line of both parts in the merged file, except the two old headers and status paragraphs
(replaced by the merged header), the two intro paragraphs (reworded to "P4.01–P4.15 build…" and
"P4.16–P4.28 then build…"), the old shared-section headings (renamed), and the part-2 diagram label
`phase-4-part1.md` (now `P4.01–P4.15`). The changes below were made after that check.

**Alex question labels (namespaced).** Part 1: **P4a-A1** (where the legal-hold private key lives; P4.03, P4.07) and
**P4a-A2** (may a P4.12 reviewer play the 360p rendition; batched with P4.01 Q4b). Part 2: **P4b-E3** (are comments
reviewed before publishing), **P4b-E4** (`targetSeesActor` and the flip rules), **P4b-E5** (Bluesky media hosts,
P4.21 stop), **P4b-E14** (default tabs), **P4b-E18** (metric rounding), **P4b-E19** (blocks and mutes for our videos),
**P4b-E24** (report forwarding default). P4.01's Q1–Q3 and Q4b go to Alex through the P4.01 ADR.

**Changes, with the request that caused each**
1. **Decision 22 (editor-todo; plan §5.8; plan-issues 22), P4.14.** A 413 from a foreign PDS no longer retries
   automatically with the 720p rendition. The publisher deletes the `media/` copies, sets the new state
   `pds_refused_master` and asks the owner: publish with the 720p rendition (`publish-720p`: flag `master_downgraded`,
   shown on the post's details by P4.16) or keep it as a draft (`keep-draft`). A 413 on the 720p copy →
   `publish_failed`. Nothing is ever decided automatically (test `publish-never-downgrades-alone`). The state enum,
   the state diagram, the P4.03/P4.04 interface row, P4.16 (the 720p note) and P4.25 (return to draft after 30 days)
   were updated to match.
2. **Arachnid (brief resolution 2; decision 23; phase-2 E24/E26; editor-todo), P4.06 and P4.07.** P4.06 now uses the
   P2.16 `FingerprintCheck` stage (`fakeFingerprintCheck` until P5.07b) and P2.16b's PDQ module. It checks PDQ only:
   MD5 is gone from the tables, the jobs, the manifest, the diagrams and the tests. Classification names are
   hyphenated (`harmful-abusive-material`, `no-known-match`). P5.07b now owns the real client, the spike that was
   P2.16a, the batching, the 401 handling, `provider_access_lost` (removed from this file's tables and grants) and the
   image buffer and hold. The P4.04 boot check and the proxy allow-list reference the `arachnid` host only from P5.07b.
3. **"P3.16a" → P3.16c (phase-3 notes; coordinator).** Every reference was changed. P4.07's `Where` drops
   `apps/pds-admin/verbs/preserve.ts` (P3.16c builds the verbs). `preserve.create` gains `subject_did` and drops
   `createdBy`, since `created_by` comes from the verified service key (coordinator). The `review_egress` and
   `retention` keys are listed in the roster's `service_keys`.
4. **seal/sealTo naming with a context argument (phase-1-part1 notes; brief resolution 4).** The P1.14 row reads
   `seal(context, …)`/`unseal(context, …)` and `sealTo("legal_hold", context, plaintext)`. P4.03 seals the buffer with
   `sealContext("app.transmission_buffer.sealed", uploadId)`. `LEGAL_HOLD_PUBKEY_ID` becomes `LEGAL_HOLD_RECIPIENTS`.
   The legal-hold identity is an X25519 `age` identity protected at rest by hardware keys (P1.14a refuses plugin
   recipients), cited to the P0.12 inventory row K2 (phase-0 notes).
5. **Held media larger than 1 MiB (phase-1-part1 notes), P4.07.** `preserve_copy` streams the upload in chunks of at
   most 1 MiB. Each chunk is sealed with `sealTo` under the context `app.legal_hold.media|<holdId>:<n>` and stored as
   `legal-hold/<holdId>/upload.<n>.a1`. The manifest holds the per-envelope sha256 and the whole-plaintext sha256, and
   the runbook concatenates the chunks offline. No second encryption mechanism and no decrypt code exist. New tests:
   `preserve-copy-chunk-cap` and a rewritten `preserve-copy-in-compute`. **For the security review:** this is the
   editor's design choice, made with the one existing mechanism; the P1.14a writer offered "a restricted bucket whose
   object key is sealed" as the alternative. `app.legal_hold.media` must be registered in `sealed-columns.json`
   (editor-p1).
6. **One legal-hold design (brief resolution 3; phase-2 E23/E26; phase-5 F10; coordinator), P4.07.**
   - The hold table and the buffer: `legal_hold` is the one table, with `subject_kind video|image` and `subject_ref`.
     `onMatch({subjectKind, subjectRef, did, result})` in `packages/core/legal-hold/` is the one entry point, and
     P5.07b calls it for images. The buffer and definer functions take `subject_ref`. These names were agreed with
     editor-p5.
   - The hold predicate (lead decision): `core.is_held` is the one predicate. P3.07 declares it and P4.07 writes the
     body in two forms, `(did)` and `(subject_kind, subject_ref)`. P4.25's former `app.is_held` becomes
     `core.is_held('video', id)`.
   - The erasure rule: `eraseDid` erases everything except held material, reports `partially_erased_legal_hold`, and
     never refuses the whole erasure. The remainder is tracked in `core.erase_pending_hold`. When the hold closes, the
     expiry job runs `erase_did` again with `why = legal_hold_closed`.
   - The account flag: `uploads_frozen` is P2.16's column on `app.account`.
7. **E22 (part-2 note; editor-todo), P4.14, P4.17, P4.20, P4.25.** `needs_reauth` expires after 30 days, then the
   post returns to draft. The new column `waiting_since` is set with the flag. P4.25's return-to-draft rule sends a
   video back to `ready` with a fresh `expires_at`, a Bluesky post back to `draft`, and deletes a pending comment
   (comments have no draft state). The same rule covers `pds_refused_master`. Grants and tests were added.
8. **E25 (part-2 note), P4.14.** `web` inserts `idx.rendition_set` in the publish transaction, with
   `master_cid = masterRef.cid`. `web` gets INSERT on that one `idx` table; `review` gets nothing there.
9. **E26 (part-2 note), P4.13, P4.14, P4.25.** The drafts lifecycle rule is not age-only. It is filtered on the tag
   `lifecycle=expire`, which draft writers set and private posts never carry. P4.13 removes the tag when an appeal is
   filed (new step 5 and test). The rule's age is set above the longest legitimate draft life (60 days, provisional
   for the Phase 5 storage step). P2.18's writers must set the tag; that is for editor-p2 and the outline.
10. **E27a (part-2 note), P4.11.** P4.11 now defines the `ReviewJob` union
    (`video | bsky_post | comment`), `onReviewDecision`, and the queue columns `subject_kind`/`subject_ref` on
    `review_job` and `review_decision`. P4.12 lists `unsure` items of every kind. The per-kind reviewer material is
    left to P4.00 (hypothesis depth). It is not catalogued in `02-shared-blocks.md`: it is not an invariant-2
    mechanism.
11. **Draft-image export (phase-2 E25), P4.26.** The export includes draft images through
    `draftMedia.listForExport(did)`. A dependency on P2.18 and a test were added. The task list also named P4.16 for
    this; P4.16 is playback and has no export, so that part was not applied there. P4.16 instead took phase-5's
    requests: the `hidden_by_moderation` join from P5.08a, and `media.purge({did, cid?, recordUri?})`.
12. **P4.01 changes (phase-1-part2 note 18; plan §5.8).** New collections join the existing permission set through
    an `[ALEX]` PR (no new set NSID). The plan now settles the comment type (`sh.unset.comment {subject, parent?}`,
    one level of replies) and the like type (`sh.unset.like`), so P4.01 asks only for the matrix (Q1–Q3, Q4b). The
    plan wins over the round-2 text, so these steps were aligned:
    - P4.02 adds both records, the permission-set PR and tests.
    - P4.17a's matrix shows them; E21 is resolved because plan line 126 has `repo:app.bsky.graph.follow`.
    - P4.19 ingests `sh.unset.like` and creates `idx.like` (phase-3 note 5).
    - P4.20 writes `subject` plus one-level `parent` (new step 6; tests and P4.28 regression 2 updated). The opt-in
      Bluesky twin reply is left to P4.00.
13. **`idx` schema prefix (phase-1-part1 notes), P4.16–P4.28.** 37 `index.` table references became `idx.`.
14. **Other names (brief resolution 4; phase-2 E24).**
    - `RateLimiter.consume` (IP and DID slots) replaces `rateLimit.take`.
    - `appendAudit` replaces `audit.append` (P4.07, P4.26, the interface rows).
    - `guardedRequest`/`guardedFetch` and P1.18b proxy mode (`egress-fixed-review`) replace `netGuard.*` and "the
      P1.18 forward proxy" (P4.04).
    - The `roles.json` roster replaces "this part adds roles".
    - P2.22's `privacy.state`/`SwitchState`/`CategoryPublisher` replace `privacyState`, `privacy.get`, `flipping_*`
      and `FlipContributor` (P4.11, P4.14, P4.17, P4.17a). Any non-`public` state counts as not public.
    - `upload_day_count` is P2.18's table with `kind = 'video'` rows.
    - `mintDraftUrl`'s `/o/<purpose>/<objectKey>` shape.
    - The scope row matches plan line 126 (`createReport?aud=*`, `repo:app.bsky.graph.follow`).
15. **Depth (brief resolution 10).** The header states the detail-by-risk rule and names P4.00 ("Refine Phase 4") as
    an outline row for the lead; no P4.00 step body is written here.

**Rejected or not applied**
- The part-2 interface row saying that the `ReviewJob` union is "catalogued once in `02-shared-blocks.md`" was
  rejected: that file holds only the invariant-2 mechanisms (brief). The union lives in P4.11.
- "P4.16 exports draft images" was not applied, for the reason given in item 11.

**Conflicts left open (for the lead or the security review)**
- **`legal_hold_reader` versus `admin`'s export.** `roles.json` reserves `legal_hold_reader` for P4.07 as a group
  "granted to a named human login, never to a service", but P4.07's "Export sealed record" runs in `admin`, a service.
  P4.07 now names the conflict and leaves the mechanism (the owner's own login for the call, or a narrow grant) to the
  security review. Either way the export returns ciphertext only.
- **The `sealTo` argument order.** The brief says `sealTo(recipient, context, …)`, while P1.14a's text still has
  `(recipients, plaintext, context)`. This file follows the brief; editor-p1 aligns P1.14a.
- **The P3.07 hold hook.** phase-3's `core.is_under_legal_hold`, which raises and defers, must become the lead's
  `core.is_held` with the skip-held rule. That is for editor-p3; this file assumes the lead's names.
- **Outline rows for the lead.** P4.00 and P4.14a (unpublish a video, part-1 note 17) are still outline-only. The
  dependency changes are: P4.03 on P2.16 and P1.14a; P4.04 on P1.18b; P4.06 on P2.16b (not P2.16a); P4.07 on P1.14a
  and P3.07; P4.26 on P2.18; P4.02 no longer on P4.01.

### Lead sweep (2026-10-03)
- Lead decision 1 (one chunked seal), P4.07: the own chunk-plus-manifest design is replaced by one
  `sealToStream` object per held upload, `legal-hold/<holdId>/media.age`, under the context
  `app.legal_hold.media_key|<subjectRef>`; `legal_hold` gains `media_key`, registered in `sealed-columns.json` with
  `form: "sealToStream"` (row key `subject_ref`, so P5.07b can seal before the hold id exists). The manifest keeps
  only the object key, ciphertext and plaintext sizes and sha256, context, recipient id, PDQ values and provider ref.
  Tests `preserve-copy-one-stream` and `media-key-registered` replace `preserve-copy-chunk-cap`. Every `sealTo` call
  uses the owner's order `sealTo(recipients, plaintext, context)` (P4.03 step 10; interface row, which also now reads
  `seal(plaintext, context)` as P1.14 has it).
- Lead decision 3 (legal-hold export, security), P4.07, P4.03 and the match diagram: `admin` has no export and no
  `legal_hold_reader` membership; it reads hold metadata only through `core.list_holds()`. A named owner runs the
  offline CLI `tools/legal-hold-export` with their own `lh_<owner>` login (client certificate, tailnet only) against
  `core.export_sealed_record`, which returns ciphertext only and writes the audit row; decryption stays offline.
  Tests `export-only-human-reader`, `admin-lists-metadata-only`, `export-cli-no-decrypt` replace
  `export-requires-owner-signature`. The "legal_hold_reader versus admin" open conflict above is settled.
- Lead decision 4 (drafts tag), P4.03 step 8 writes the upload with `lifecycle=expire`.
- Coordinator item 10: P4.28 depends on P4.14a (outline-only).
- The "sealTo argument order" and "P3.07 hold hook" open conflicts above are settled (owner's order; P3.07 now uses
  `core.is_held`).
- Coordinator follow-up (sealed values): `legal_hold_transmission.sealed` is `text` (the `a1.` envelope, moved
  unchanged) and registered with `form: "sealTo"`, as is `transmission_buffer.sealed`.
- Lead decision 4 amended (2026-10-03), P4.25 step 6: P2.18's profile images carry no tag; the upload writers P4.03, P4.05 and P4.17 do.

**Alex's answers and plan decisions 24–26 applied (2026-10-03, answers editor)**
- **P4.07** (#1, P0-A4): the owner opens K2 with one of the two hardware keys before decrypting the export; no paper or
  passphrase copy exists; the edge case and the "Not in this step" summary are updated. P4a-A1 itself stays open.
- **P4.26** (decision 25): a fixed `exportHooks` list from `web`'s composition root, the export twin of `eraseHooks`.

**Alex's answers 29b, 30, 30b, 30c, 32 and 33 applied (2026-10-03, moderation editor)**
- **Answers 30 and 30b (local moderation, nothing to Claude):** new step **P4.09a** "Local text gate" (rules, then
  Detoxify `multilingual` as int8 ONNX, then Llama Guard 3 1B Q8_0 on llama.cpp, in the no-network compute container;
  S4 → P4.07's emergency path, S11 and other unsafe results → a person, two-model agreement → block, a transcript-only
  hit never blocks, errors hold; shadow mode first; a [SPIKE] step 0 for CPU latency, memory and French accuracy on
  ≥200 EN and ≥200 FR labelled items; model pins by sha256; licence notes incl. "Built with Llama"; the Qwen3Guard
  fallback; a reviewer-capacity note). It covers every `ReviewJob` kind: video caption, alt, captions cue text and
  transcript; `bsky_post` text and alts; comments. **P4.08** adds the gore classifier (`image-safety-classifier-s`,
  MIT, low maturity, **hold-only**), corrects NudeNet's licence (package MIT; YOLOv8-derived weights to check) and no
  longer writes `frames-cleared/*`. **P4.10** is now a documented "later option, off in v1" stub that only an
  Alex-approved PR after measurement can enable. **P4.04**: job kinds `nudity → text_gate → route` (no
  `egress_classify`), grants (`text_result`; no `classifier_result`), egress reads no media and holds no store
  credential, `egress-fixed-review` allows only `arachnid`, boot check and tests (`egress-has-no-store-credential`,
  `no-model-provider-egress`). **P4.11**: new `routeRules` order (suspected → nudity fail → nudity unsure → gore hold
  → text hold → shadow → text block → approve), reasons `needs_human_gore`, `needs_human_text`,
  `needs_human_self_harm`, the local notice text (no company named; whether a tick is still needed is a lawyer-hour
  question), `review_decision.models`; `REVIEW_MODE` replaces `CLASSIFIER_MODE`. **P4.12** shows the gate results
  and routes every "unsure" to a person. **P4.13** statements name the local models; the appeal test checks that no
  automated stage re-runs. P4.14, P4.17, P4.20, P4.25, the shared tables, config keys, interface rows, both diagrams,
  the main flow and the state diagram follow. The plan still says "The content classifier is the Claude API" (§5.8
  lines 462–463, §6 line 495): the coordinator relays that plan change; until it lands, this file follows Alex's
  later answers (30, 30b), which supersede the plan text.
- **Answer 30c (suspected CSAM, Alex 16:39Z):** **P4.07** gains "Suspected abuse material: the emergency path": block
  at once and never send anywhere; seal under the legal hold through `onMatch` with `subjectKind = 'suspected'` (and
  `item_kind`), C-16 clock unchanged; an immediate `csam_emergency` alert (P3.20c's highest class, never digest-only,
  never capped); a report case that a person must close by filing with Cybertip.ca, re-alerting every 4 h until the
  lawyer hour fixes the deadline; the runbook line "if a child appears to be in imminent danger, call the police
  (911 or local) as well"; freeze the poster's uploads, never the reporter; audit `csam.suspected`. Callers: P4.11
  (text-gate S4), P4.12 (the reviewer button, replacing "Report to Cybertip.ca"), P4.21a (a proxied image), P6.15
  (chat evidence, for the phase-6 editor). "Send to Arachnid" is recorded as impossible (lookup only); Cybertip.ca
  (C3P) is the channel. Eight new tests in P4.07, one each in P4.17 and P4.20, and the P4.12 button test.
- **Answer 32 (P4a-A2 option B, 16:40Z):** P4.12 adds `POST /review/:uploadId/play`: the 360p rendition only, inside
  `admin`, signed per-action with WebAuthn like the reveal, `no-store`, no download link, each play audited
  (`pii.review_play`, reviewer DID, item id, time), its own cap of 30 items per day (the reveal cap is kept). Never
  playable: `needs_human_nudity` items (kept blurred, as before), anything flagged suspected, anything matched. P4.13
  reuses it.
- **Answer 29b (mixed follows, plan decision 28):** P4.01 Q3 settled; the privacy-matrix table; P4.17a splits
  `follow` into `follow_ours` (`sh.unset.follow`) and `follow_bsky` (`app.bsky.graph.follow`), adds
  `targetOrigin(did)` (an active account with an `sh.unset.profile` record) and converts private follows by target at
  going-public time; P4.18 registers both collections, reads and unfollows across both, and picks the collection by
  target; P4.21 and P4.22a merge both kinds; P4.28's parity test. **NSID:** the book uses the flat
  **`sh.unset.follow`**, not the plan's provisional `sh.unset.graph.follow`, because P1.31's build check allows only
  flat `sh.unset.<name>` NSIDs so one `_lexicon.unset.sh` TXT record resolves them all (a deeper NSID needs a second
  TXT record, `_lexicon.graph.unset.sh`). The lexicon joins P1.31's first publication of the permission set, so no
  re-consent. If Alex prefers the plan's name, it is a rename in P1.31 and here plus that DNS record, before P1.35
  publishes.
- **Captions (decision 19, Alex 2026-10-03):** P4.09 always writes a track (a one-cue placeholder when there is no
  audio, no speech or the ASR failed); P4.11 and P4.14 require at least one cue; P4.16 renders no `default` track and
  a CC toggle (off by default, remembered per viewer; muting no longer turns captions on). The plan's §5.8 line 455
  ("shown by default when muted") needs the coordinator's relay.
- **Answer 33 (P4b-E5 option C, 16:41Z):** the P4.21 stop is removed; new step **P4.21a** proxies Bluesky pictures
  and avatars through `media`: URLs minted by `web` only for CIDs the rendered view names, fetched from the author's
  PDS `getBlob` through `guardedFetch('public')` (no redirects, 2 MB, 5 s, no viewer data), CID-verified, PDQ through
  `FingerprintCheck` (cache hits not re-checked), re-encoded WebP without metadata, sandbox CSP and `nosniff`,
  24-hour CID-keyed cache, labels respected. **Not `cdn.bsky.app`:** the CDN serves Bluesky's re-encode, which cannot
  be verified against the CID; the coordinator's "Bluesky CDN host(s) or the PDS getBlob" is resolved to the PDS only
  (a request I did not follow literally; see the summary). Cost estimates are marked for P4.00.

**Editor pass (2026-10-03, answers 31-53)**
- **P4.07, shared definitions, buffer paragraph, Notes 3 and F4** (answer 31): P4a-A1 settled (K2 only on the owners'
  hardware keys, offline; owners export and open records on their own device).
- **P4.01 Q1/Q2/flip, privacy-matrix section, P4.17a, P4.18, P4.19, P4.20, E4** (answers 26, 27, 28, 29): settled; the
  default matrix is the decided one (`targetSeesActor = true`, Bluesky likes and replies disabled while private,
  `convert` in the same batch as posts). Answer 29's P4.18 part was already applied by 29b.
- **P4.21, P4.22, E19** (answer 34): `app.bsky.graph.block` ingested for tracked repos; `blocks.hiddenFor(viewer)`
  excludes blocked and blocking authors from our half of Following and from the `unset_latest` and `unset_following`
  tabs; fail closed on a read error; three tests.
- **P4.22, E14** (answer 35): default tabs settled.
- **P4.24, E24** (answer 36): the opt-in tick is removed; every report on a Bluesky post is forwarded through an outbox
  (`app.report_forward`, no reporter DID, no note, one per subject per day) by a forwarder holding the moderation
  service account's credential; `web` never calls `createReport`. Open for P4.00 and Alex: which process runs the
  forwarder and how the service account signs in. **Plan scope note (for the coordinator):** plan line 126 keeps
  `rpc:com.atproto.moderation.createReport?aud=*` "so reports reach Bluesky's moderation service now and our own Ozone
  in Phase 5". The Bluesky half of that reason no longer applies; the scope is still needed for P5.07a (a signed-in
  user's report to our own Ozone through their PDS), so it stays requested; the plan's reason text should change.
  P4.24's Plan header still cites §3 for the scope; it is no longer used by this step.

**Editor pass (2026-10-03, Iconoir)**
- **P4.24 report link** (Alex, 2026-10-03 18:00Z, alex-answers #12b: Iconoir for all icons): the flag icon is P1.24's
  `Icon` (an Iconoir SVG from the sheet's Icon list), no longer a text glyph. If the flag is not on the sheet's list it is
  a stop item for Alex (P1.24 step 4).

### Editor pass (2026-10-04, decision 34)

- Paths rewritten to the decision-34 layout from `layout-map.md` by script (`apply.py`); prototype citations, external
  repositories (atproto, Synapse docs, Element) and Notes written before 2026-10-04 keep their old paths as history.
- P4.00 (outline-only) gets the feature-ownership duty in the header.
- P4.21a moved before P4.21 (P4.21 depends on it) and its soft P4.23 link removed from its Depends (cycle P4.21a →
  P4.23 → P4.21 → P4.21a). Lexicon unit tests sit beside their files.

### Editor pass (2026-10-04 05:10Z refinement, decision 34)

- Layout open points resolved by the architecture thread (guideline §1 refined 05:10Z; `layout-map.md`): P4.00 header: the placements are confirmed (`interfaces/jobs`; O-11 confirmed by P4.00); docs paths per O-10.

### Editor pass (2026-10-04, findings)

Source: `architecture-handoff/step-book-findings.md`; verdicts in `reviews/step-book-findings-triage.md`.

- F-01: the header tells P4.00 that account visibility is read only through `idx.visible_account` (moderation
  decisions now live in `mod.account_state`, P3.03).
- F-12, F-21, F-28, F-29: routed to P4.00 (header paragraph).
- F-13: P4.25 step 2a adds a per-kind mass-delete governor (`EXPIRY_MAX_PER_RUN_<KIND>`, health flag
  `retention.mass_delete`); `expiry_bounded_batches` raises the cap to keep testing batching.
- F-26: Threats blocks added to the full-detail `[SEC]` steps; P4.00 writes them for the rest.

### Editor pass (2026-10-04, decision 35)

- P4.18: open note for P4.00 on R2 (private profile with public posts, followable from a state page that decision 35 D7
  removed for non-owners). The D7 rule wins until P4.00 settles it with Alex; nothing else changed in this file.

### Editor pass (2026-10-04, bibliography review, decision 37)

- P4.00 list: applies decision 37 and fills the plan's §11 Q2b table with it. Test `feed_private_profile_bare_handle`.
- P4.18 (R2): the [STOP] for P4.00 is removed. Follow lives on the post page `/@alice/p/{rkey}`; the test is updated.
  R3-05 is untouched (still with Alex).
- P4.07 (architecture thread): the export CLI is `interfaces/legal-hold-export/`. New test
  `legal-hold-export-in-no-image`.

### Editor pass (2026-10-04, SE-6 ruling)

The architecture thread's ruling on SE-6 (plan §9 and the rule as folded at `f9b48f8`): role and grant changes on
objects that already exist are trusted base, checked by P0.09c's grant parse; a migration creating new tables, columns
or functions, with the grants on them, rides with its feature step. `shared/http/` stays trusted base. Detail by risk:
only steps whose text already names the grant or kit change were split.

- **P4.04g** (new, ahead of P4.04): `review`/`review_egress` grants on `video_upload` and their `passwordFrom`.
- **P4.07g** (new, ahead of P4.07): the `lh_<owner>` logins and their `legal_hold_reader` membership.
- **P4.16g** (new, ahead of P4.16): `media` SELECT on `idx.record`, `idx.account`, `idx.rendition_set`.
- **P4.18k** (new, ahead of P4.18): the `follow`, `comment`, `feed` and `feed_edit` policies in `shared/http/limits/`.
  P4.18, P4.20 and P4.21 depend on it (P4.22 through P4.21).
- **P4.25g** (new, ahead of P4.25): `retention`'s grants migration.
- Riding with their steps (new objects): P4.04 (`review_job`, cross-role definers), P4.06, P4.08, P4.09, P4.09a (their
  tables' grants), P4.14 (`web` INSERT on `idx.rendition_set`, if P4.14 creates it; P4.00 confirms), P4.21a
  (`app.bsky_image_state`).
- Open (not decided here): P4.07's Where mixes trusted-base paths (`domains/moderation/legal-hold/`,
  `interfaces/legal-hold-export/`) with feature code (`apps/admin/screens/`, `interfaces/review/…`); under P0.09c it
  fails isolation as written. P4.00 should split it like the others; the ruling covered `shared/http/` and grants only.

### Editor pass (2026-10-04, SE-6 follow-up ruling)

The architecture thread ruled on the SE-6 follow-ups; the plan folded them at `6275827` (plan §9's feature-step list:
"tables, columns, views, sequences or functions, with the grants on those new objects and the erasure-registry rows for
columns the same PR creates").

- **P4.18k removed** (id retired). Route rate-limit policies live in each interface's `limits.ts` (P1.06p): P4.18
  (`follow`), P4.20 (`comment`), P4.21 (`feed` in `interfaces/http`), P4.21a (`feed` in `interfaces/media`) and P4.22
  (`feed_edit`) add or set their own policy in their own PR; none depends on P4.18k.
- **P4.07k** (new, between P4.07g and P4.07): `domains/moderation/legal-hold/*` and `interfaces/legal-hold-export/`,
  the trusted-base part, first; P4.07 keeps the callers, admin screen, migration, definers and expiry job, and its
  Where no longer lists those two folders or the login roles (P4.07g). This answers the earlier "Open" note.
- ~~P4.07's `CREATE OR REPLACE` of `core.is_held`'s body is neutral under SE-6's exact wording (P0.09c), so it
  rides.~~ Superseded by the next note: it is trusted base and is P4.07h.

### Editor pass (2026-10-04, SE-6 corrections: function bodies)

SE-6 as folded at `badf15a` (plan §9: any change to a function or view the PR does not create, a replaced body or an
altered SECURITY, owner or search_path, is isolated trusted base).

- **P4.07h** (new, right after P4.07): the body of `core.is_held`. It follows P4.07 rather than preceding it because the
  body reads P4.07's `legal_hold` table. P4.25 depends on it.

### Editor pass B (2026-10-04 late)

- **Decision 38 (ADR 0005, Spaces):** P4.00 gains the Spaces status check, `[STOP] [ALEX]` (proceed only if Spaces is in
  an official PDS release and in the spec; otherwise records stay in our DB). P4.17a's `app.private_interaction` gains
  `collection`, TID `rkey` and the lexicon `record`, and says it holds private records shaped for a copy into a space;
  test `private_interaction_record_shape`.
- **Decision 39 (ADR 0006, shown to the target):** R3-05 closed. P4.17a states the rule, adds the one-time notice
  (`app.privacy_notice_seen`, copy in catalog key `privacy.private_interactions_visible_to_target`) and the tests
  target-sees, third-party-nothing, never-on-network and notice-once. The privacy-matrix rows for follow, like and
  comment are now decided. P4.18 (the R2 read path) returns private followers with names to the target only; P4.19
  `privateLikers`; P4.20 private comment shown with the commenter's name to the author.
- **Feeds (sheet v44):** P4.21 step 12 and tests: ARIA feed role, no footer, `FeedMore` (no-JS `older posts` link,
  island auto-load), `NewPosts` status bar (never the rejected pill), cursor via `replaceState`, island inside P1.23's
  15 KB / 75 KB budget. P4.22 tabs use the same feed UI.

### Editor pass (2026-10-04 evening)

Editor pass A (column-list ruling, plan §5.2 at `9c54e52`; SE-6; 02-shared-blocks §11). Decision 38/39 private-record
steps (P4.18, the private follow/like steps) are pass B's and were not touched.
- P4.16g: `media`'s SELECT on `idx.record`, `idx.account`, `idx.rendition_set` is by column list.
- Rule for every Phase 4 step that creates a table with a registry row (P4.03/P4.04 review tables, P4.07
  `legal_hold`, `legal_hold_transmission`, P4.17 `app.bsky_post_draft`, P4.17a's tables, P4.20 `app.pending_comment`,
  P4.21a `app.bsky_image_state`, P4.22 `app.saved_feed`, P4.24 `app.report_forward`): grants by column list in the
  creating migration, DELETE as `rowPrivileges`, never `wholeTable`; a later column a role needs carries its own column
  grant (rides only when new). P4.00 checks each table's lists against the code; P4.27's `app.metrics_daily` (no DID
  column) may be `wholeTable`.
- P4.07's definers (`keep_transmission_for_match`, `move_transmission_to_hold`, `destroy_transmission`,
  `close_expired_hold`, `core.list_holds`, `core.export_sealed_record`) are legal-hold definers: SE-6 makes them trusted
  base even when new, so P0.09c fails P4.07 if they stay in its feature migration (rule 3f, `trusted_family_unnamed`).
  **Open, for P4.00 and the coordinator:** move their `CREATE FUNCTION`s into P4.07k (or a new trusted-base step just
  ahead of P4.07) and add their names to the CODEOWNERS `# trusted functions:` line there; the brief names P4.07k and
  P4.07h as the steps that name them. Not moved here because P4.07 creates the `legal_hold` tables the definers read,
  so the split needs P4.00's ordering decision.
