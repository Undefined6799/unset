# Alex's answers

Answers Alex gave to step-book questions, one row each, appended end-only as Phase 0 carries the records from
`unset-plan/book-edits/`. Older answers cited as "alex-answers #N" live in the planning folder.

| id | question | answer | applied |
|---|---|---|---|
| base-alpine | Container base OS | Alex 2026-10-07 00:09:48Z: "Base image for container will be alpine linux" | P1.27 (node:26-alpine), P1.29 musl DNS check |
| p127-digest | Build from upstream Node Alpine by digest before the mirror exists | Alex card "Yes, digest" 2026-10-07 00:17:03Z | P1.27, P1.27s (flip back) |
| official-images | Official Docker images, Alpine where offered, by digest, until the mirror | Alex card "Yes, all official" 2026-10-07 00:54Z | P1.27 to P1.30, P1.27s |
| P1a-A1 | Keep the acting admin's network address in the audit log | Alex card "No address" 2026-10-07 00:14:42Z (option B); `event_pii` removed | P1.15m, P1.15d, P1.15g, P1.15, P3.17 text |
| p136 | Pull P1.36 forward into slice 1 | Alex "Yes p136" 2026-10-06 23:08:20Z | P1.36 |
| P1b-A1 | Forward the client's network address to the PDS | Alex card "Do not forward" 2026-10-07 00:57:16Z; remarks 00:57:31Z "But with the pds, I would refer you to the atproto docs", 00:57:59Z "Seems like the pds is public to query if I am not mistaken" | P1.28 (strip headers, PDS limits off, caddy-ratelimit zones), P1.36 RoPA |
