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
`INDEXER_ENABLED` off (the default) `compose` is never called: no pool, no reads. The stream starts before the first
backfill pass, so a commit made during a repo read reaches us either way; `run.stream_starts_before_the_first_backfill_pass`
pins that order.

**Health.** Counts only (SE-7): the stream's counts and last stop reason, each pass's last counts, totals since start
and failures by pass name, the index counters, and `accounts.deletionsWaiting` (held hidden as deleted with a
confirm_deletion job queued). A deletionsWaiting that keeps rising means erasures fall behind the hourly cap (P3.06e);
alert on it before production. A failed read answers 503 with no body. There is no rate-limit policy: the endpoint
sits on the process's internal network with no published port.

**Image.** `deployment/images/indexer.Dockerfile`, its own image because the preflight's compose subset refuses
`entrypoint` and `command`. The compose service and its egress network come in a later PR, once publish-images has
produced a digest to pin.

**Links.** [[http]], [[postgres]].
