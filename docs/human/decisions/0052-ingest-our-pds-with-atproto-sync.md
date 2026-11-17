# 0052 — Ingest our own PDS with `@atproto/sync`, not Tap, for the first indexer slice

Status: Accepted by Alex, 2026-11-17 06:29:25Z, against ca5b1dc, replying with the line "accept ADR 0052 at ca5b1dc"
that the coordinator's project-chat post asked for on the head it had reviewed; this file is unchanged at ad62a7c,
the head that merges. Alex chose the direction on 2026-11-17 in the thread "Build the indexer for public
profiles": card "Own PDS first" (05:06:16Z), then card
"Own small reader (no Tap yet)" (05:11:33Z). It takes the
fallback that plan §5.2 ("The fallback is `@atproto/sync` on `subscribeRepos` (~300 lines)") and book P3.01 outcome C
already name, for our own PDS only, without running the P3.01 spike first. Plan §5.2's Tap row, decision 5's
"Indexer source" and ADR 0040 stand for the public relay; nothing here edits them.

## Context
Public `/@handle` pages need the index (plan §5.2: pages render from our database, never from a PDS on request).
Every staging account lives on our PDS (`staging.unset.ac`), so the first slice only has to read that one PDS.

The book's design runs `tap-own` against our PDS's internal URL. Tap's source does not allow that. At indigo
`a39b2f94d516d6d450b840bd4ca68cb7e3edaf4c` (2026-11-15, the latest commit touching `cmd/tap`):
- repo fetches (`cmd/tap/resyncer.go:200-216`) and the identity directory's HTTP client (`cmd/tap/tap.go:66-76`) use
  `ssrf.PublicOnlyTransport()`, whose dialer refuses every private, loopback and CGNAT address
  (`util/ssrf/ssrf.go:95-138`). The repo fetch goes to the PDS URL in the DID document, which for us is the public
  name, so Tap would fetch our repos over the internet and back through Pangolin;
- that transport honours `HTTPS_PROXY` (`Proxy: http.ProxyFromEnvironment`), but the dial to the proxy is checked
  too, so a proxy on a private Docker address is refused. The book's `egress-public` proxy (P1.18b, not built) and
  its `tap_edge` alias would both fail for repo fetches;
- the PLC client (`tap.go:72-74`) has no SSRF guard; its URL is `TAP_PLC_URL`.

Using Tap here would therefore mean a new direct internet path for a beta Go binary, plus a new image to build, sign,
mirror and scan, to read a PDS that sits on our own internal network.

`@atproto/sync` 0.4.26 (npm, read from its `dist/firehose/index.d.ts` and `index.js`) gives a `Firehose` class over
`com.atproto.sync.subscribeRepos` that verifies commit signatures through an `IdResolver`, filters collections, and
awaits our handler per event when no runner is set. `@atproto/identity` 0.5.23 (`dist/types.d.ts`,
`dist/did/plc-resolver.js`) accepts an injected `fetch`, so DID resolution can go through `net-guard`.

## Decision
1. A new process, `interfaces/indexer`, reads our PDS's `subscribeRepos` at its internal URL with `@atproto/sync`'s
   `Firehose` (no runner: events are handled one at a time, in order). `@atproto/sync` and `@atproto/repo` are pinned
   exactly and imported only in `infrastructure/firehose/` (one adapter folder, enforced by dependency-cruiser like
   the other vendor SDKs).
2. Every outbound HTTP call the reader makes goes through `net-guard`: PLC and did:web resolution for commit
   verification with the existing `plc` and `atproto` policies, and `getRepo` for a backfill with an exact-origin
   `internalPolicy` for the configured internal PDS URL (`INDEXER_PDS_URL`, plain http on port 3000 in the dev stack;
   the `atproto` policy refuses plain http and ports other than 443 before its own-PDS exception, net-guard
   `src/request.ts` `checkTarget`). The WebSocket goes only to the configured internal PDS URL, never to a URL from the network. Like `web`, the indexer
   gets one egress network of its own (`indexer_egress`, the shape of `web_egress`) that its code reaches only
   through `net-guard`; it is on no network with `edge`, `newt` or the object store.
3. Only DIDs that signed in here are indexed: the track queue of book P3.02 (`app.track_request`, filled by the
   sign-in callback) creates their `idx.account` row. An event for a DID with no row is dropped, so a PDS account
   that never signed in to the app is not indexed.
4. The cursor is a row in `idx` (one per source, no DID), written in the same transaction as the event it follows,
   so a crash replays from the last committed event. A handler failure never advances the cursor: the reader stops,
   backs off and reconnects from the stored cursor. If the PDS answers that the cursor is too old, every tracked DID
   is backfilled again from `getRepo` and reconciled, which also covers deletes missed meanwhile.
5. A newly tracked DID is backfilled once from `com.atproto.sync.getRepo` on our PDS, its commit signature checked
   with `@atproto/repo` before any record is written.
6. Ingest rules, erasure, account state and handle checks are the book's (P3.03 to P3.08) unchanged, except that
   Tap's acks, its identity-event split and its outbox are replaced by the cursor rule above, and the PDS's own
   `#account` events carry status directly (reactivation is still confirmed with `getRepoStatus` before an account
   becomes visible).
7. Indexing is off by default (`INDEXER_ENABLED`); the public page reads only `idx.visible_account`.

## Alternatives
- **Tap with its own egress network.** Keeps the book as written, but gives a beta binary direct internet access,
  adds an image to the signing and scanning pipeline, and fetches our own repos through Pangolin. Rejected by Alex
  on 2026-11-17 for this slice.
- **Patch Tap to allow our PDS's private address.** A fork to maintain, against a beta tool. Not considered further.
- **Read records from the PDS on each page view.** Contradicts plan §5.2 and needs network I/O on a public request.

## Consequences
- One new outbound path: `indexer_egress`, used through `net-guard` for PLC and did:web lookups. The PDS stream
  and `getRepo` stay on the internal network.
- No Tap, no Tap database and no Tap image in this slice; the `tap` Postgres role and database from bootstrap stay
  unused until Tap arrives with the public relay.
- People hosted elsewhere who sign in here are queued but not indexed until the relay slice; their `/@handle` reads
  as not found, like any unindexed account.
- When the relay slice comes, it either adds Tap for foreign repos (ADR 0040's signal collection needs Tap) next to
  this reader, or replaces this reader with Tap for everything; that choice is a later ADR. The ingest rules in
  `domains/` and the `idx` schema do not depend on the reader.
- Our PDS keeps a limited event backlog, so an indexer that is down for long falls back to a full re-backfill
  (decision 4). With a handful of accounts that is cheap; the cost grows with the number of members.
- The P3.01 spike is not run for this slice; its measurements apply when Tap is introduced.

## Compliance
The indexer's integration tests against the dev PDS (book P3.05 `tap-to-index-dev`, renamed `firehose-to-index-dev`):
publish a profile and see the row, unpublish and see it gone, restart mid-stream and lose nothing. A
dependency-cruiser rule keeps `@atproto/sync` and `@atproto/repo` inside `infrastructure/firehose/`. The compose
network test pins the indexer to `db`, the PDS's internal network and `indexer_egress`, and the net-guard CI guard
covers its fetches.
