# Alex's answers

Answers Alex gave to step-book questions, one row each, appended end-only as Phase 0 carries the records from
`unset-plan/book-edits/`. Older answers cited as "alex-answers #N" live in the planning folder.

| id | question | answer | applied |
|---|---|---|---|
| base-alpine | Container base OS | Alex 2026-10-07 00:09:48Z: "Base image for container will be alpine linux" | superseded by base-debian-slim (2026-10-07 01:29:53Z) |
| p127-digest | Build from upstream Node Alpine by digest before the mirror exists | Alex card "Yes, digest" 2026-10-07 00:17:03Z | P1.27, P1.27s (flip back) |
| official-images | Official Docker images, Alpine where offered, by digest, until the mirror | Alex card "Yes, all official" 2026-10-07 00:54Z | P1.27 to P1.30, P1.27s |
| P1a-A1 | Keep the acting admin's network address in the audit log | Alex card "No address" 2026-10-07 00:14:42Z (option B); `event_pii` removed | P1.15m, P1.15d, P1.15g, P1.15, P3.17 text |
| p136 | Pull P1.36 forward into slice 1 | Alex "Yes p136" 2026-10-06 23:08:20Z | P1.36 |
| P1b-A1 | Forward the client's network address to the PDS | Alex card "Do not forward" 2026-10-07 00:57:16Z; remarks 00:57:31Z "But with the pds, I would refer you to the atproto docs", 00:57:59Z "Seems like the pds is public to query if I am not mistaken" | P1.28 (strip headers, PDS limits off, caddy-ratelimit zones), P1.36 RoPA |
| base-debian-slim | Switch the web image base from Alpine back to Debian slim | Alex asked 2026-10-07 01:26:43Z "Is it too late to revert docker image to debian slim?"; card "Debian slim" 2026-10-07 01:29:53Z | P1.27d (node:26-trixie-slim); official-images variant clause; P1.29 reason reworded; P2.16b musl note dropped |
| npm-cve-ignore | Ignore the three fixed HIGH npm CVEs in the upstream Node base for 14 days | Alex card "Ignore 14 days" 2026-10-07 02:02:20Z | .github/trivyignore.yaml, expires 2026-10-21 |
| mirror-build-stage | Let the mirror scan warn, not fail, on HIGH findings in build-only images | Alex card "Warn on build-only" 2026-10-07 03:56:37Z; typed "Yes p128v" 2026-10-07 11:45:09Z | P1.28v (#430): build-stage mirror entries fail only on CRITICAL and print HIGH as warnings; runtime entries still fail on HIGH and CRITICAL |
| pds-image | Allow Bluesky's own PDS image, pinned by digest, in our development stack | Alex card "Allow pinned" 2026-10-07 13:00:19Z | `ghcr.io/bluesky-social/pds` a runtime lock and mirror entry, allowlisted by that exact image name (never the host or namespace), under the usual scan and age rules; P1.29a |
| mailpit-image | Allow the Mailpit mail catcher image, pinned by digest, in development only | Alex card "Leave it out" 2026-10-07 13:05:20Z (against architecture's recommendation) | No Mailpit anywhere; P1.29a ships the PDS alone, P1.29h reads the local email token |
