---
id: indexer
type: area
status: current
areas: ["[[indexer]]"]
summary: "Hub for interfaces/indexer: reads our PDS's stream and repos into idx; off unless INDEXER_ENABLED, own image."
code: [interfaces/indexer/main.ts, interfaces/indexer/compose.ts, interfaces/indexer/run.ts, deployment/images/indexer.Dockerfile]
sources: [docs/human/decisions/0052-ingest-our-pds-with-atproto-sync.md]
importance: normal
related: ["[[http]]", "[[postgres]]"]
replaced_by: null
tags: [area, indexer]
checked: 2026-11-18
---
# indexer

**What it owns.** The process that reads our own PDS's event stream and repos (ADR 0052, which replaced the Tap plan)
and writes the `idx` tables as the `indexer` role. Everything in `idx` can be dropped and rebuilt (DA-1), so no fact we
decide lives there.

**Shape (P3.05s PR 3).** `main.ts` reads the config (exit 78 when invalid) and serves `GET /health` on `HEALTH_PORT`;
`compose.ts` is the composition root and the only file that builds adapters (AB-2, the composition-root guard checks
it); `run.ts` starts the stream reader, then runs the track, backfill and confirm passes on a timer. With
`INDEXER_ENABLED` off (the default) `compose` builds nothing: no pool, no reads. On, it first checks the pool fits the
role's connection limit across `PG_MAX_REPLICAS` (exit 78 otherwise, as web); the indexer role allows 10. The config
refuses any `PG_USER` but `indexer` and plain http to anything but a one-label stack name. The stream starts before the
first backfill pass (`run.stream_starts_before_the_first_backfill_pass`), but starting is not being open, so the order
alone proves nothing. What closes the gap is the cursor: with none stored, the reader dials cursor 0, the oldest event
our PDS keeps, never the live tip, so a commit made after a repo read but before the socket opens still arrives
(`reader.first_dial_replays_commits_made_before_the_socket_opened`; Codex on #1723). First start therefore replays
the PDS's whole kept window; the consumer takes replays by rev.

**Stop.** SIGTERM aborts the stream and hands the abort to the pass in hand, which ends after its current item and
records nothing about a read the stop cut short. `shutdown.ts` waits for the loop, the pool's end and the health server
for `INDEXER_SHUTDOWN_GRACE_MS` (at most 9 s, under Docker's 10 s), exiting 1 when cut short or after an unhandled
rejection, so restart-on-failure brings it back.

**Health.** Counts only (SE-7): the stream's counts and last stop reason, each pass's last counts, totals since start
and failures by pass name, the index counters, and `accounts.deletionsWaiting` (held hidden as deleted with a
confirm_deletion job queued). A deletionsWaiting that keeps rising means erasures fall behind the hourly cap (P3.06e);
alert on it before production. A failed read answers 503 with no body. One read is shared for 5 s
(`HEALTH_CACHE_MS`), so callers on the internal network cannot starve the pool. A stream that keeps stopping with no
frame applied for `INDEXER_STREAM_UNHEALTHY_MS` (5 min) makes health 503 with the counts, so the image's HEALTHCHECK
fails (`stream-watch.ts`; a quiet PDS after one stop is not a fault).

**Handles (P3.08s).** `handles.ts` is the rule: verifyHandle fresh (both directions), and for a handle under
`HOSTED_HANDLE_SUFFIXES` also our PDS's word: the DID document names `PDS_PUBLIC_URL`, getRepoStatus is active, and
resolveHandle on our PDS maps it back to the same DID. An outage on either side is `unresolved` and keeps what is
stored, but only while the DID document still claims the stored handle (review B1 on #1728): verifyHandle's
`unavailable` names the claim when it read the document, and a different claim ends the verified status. Only an
explicit answer makes a handle invalid, and a 404 from the handle's host counts as one (resolve-handle.ts), so a host
answering 404 during a restart clears the handle until the next check (HANDLE_RECHECK_S, or an identity event). The identity frame never writes a handle, only queues the
check. `handleStore.ts` writes it in a short transaction; migration 0031's unique partial index allows one verified
holder per handle, and a new holder moves the old one to unresolved and queues its check. If a race still hits the
index, the write fails, is counted as failed and the job comes back after its 150 s lease (the book's step 6 re-runs
the collision step at once instead; this is simpler and never stalls the stream, which runs apart from the passes). A sweep every 10 minutes
queues accounts never checked or checked more than `HANDLE_RECHECK_S` ago. The book's step 7 (`pds_endpoint`) waits
for a column to hold it.

**Image.** `deployment/images/indexer.Dockerfile`, its own image because the preflight's compose subset refuses
`entrypoint` and `command`. The compose service and its egress network come in a later PR, once publish-images has
produced a digest to pin.

**Links.** [[http]], [[postgres]].
