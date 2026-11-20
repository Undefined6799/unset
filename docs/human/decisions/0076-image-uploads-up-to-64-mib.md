# 0076 — Image uploads up to 64 MiB and 110 megapixels

Status: Proposed (awaiting Alex). Supersedes only the upload numbers in ADR 0070 points 3, 4 and 8; everything else in
ADR 0070 stands. Alex asked on 2026-11-20 at 13:16Z: "Yes i think its worth rising it to 64 mb".

## Context

ADR 0070 accepts uploads up to 30 MB and 70 megapixels. A photographer's camera JPEG is larger: a 61-megapixel
full-frame file at fine quality is 25 to 45 MB, and a 102-megapixel medium-format frame (11,648 x 8,736) is 40 to
60 MB. Those members would have to shrink their pictures before uploading them, which ADR 0070 meant to spare them.
The versions we keep do not change: the main version is still a JPEG of at most 2560 px under 2,000,000 bytes, and
the display versions are still 480, 960 and 1600 px wide. Only what we accept, and the limits around reading and
decoding it, rise.

## Decision

1. **The upload.** JPEG, PNG, WebP and AVIF, up to 64 MiB (67,108,864 bytes), 110 megapixels and 12,000 px a side
   (`domains/content/images/standard.ts` `UPLOAD_LIMITS`). 110 megapixels takes every current camera up to 102
   megapixels with room; the 12,000 px side is kept, so a 110-megapixel picture is close to 4:3.
2. **Review's ceiling**, what review ever does for one job whatever web asks: 64 MiB and 120 megapixels
   (`infrastructure/image/wire.ts` `JOB_CEILING`). A child's job frame may be up to 72 MiB (`child.ts`).
3. **The body caps** (ADR 0070 point 8's loosenings, raised):
   - web's `/images` route and adapter-node's cap from 31 MiB to 65 MiB (`interfaces/web/src/routes/images/policy.ts`);
   - net-guard's request ceiling and the `review` policy from 32 MiB to 66 MiB (`infrastructure/net-guard/src/policies.ts`).
   The object store's 2 MiB and `uploadBlob`'s 2 MiB do not change.
4. **Memory and processors** (`deployment/limits.dev.json` and the compose files): web from 512 MB to 1 GB, since
   ADR 0070 point 4's four site-wide uploads now hold up to 260 MiB of bodies; review from 1.5 GB to 2 GB and from 1 to
   2 CPUs, one per child. Review keeps 2 children and a queue of 2 (four in flight, point 4), its 20 s job deadline and
   each child's 8 GiB address space.
5. **The edge** (`deployment/edge/Caddyfile`, `limits.json` `EDGE_READ_BODY_S`): the server's read window, which
   bounds headers and body together, from 30 s to 120 s: 64 MiB at 5 Mbit/s takes about 107 s, at 10 Mbit/s about
   54 s. It applies to every route on the edge, because Caddy has only a server-wide total (`read_body`); the
   per-route `timeouts` directive sets only idle and rate limits. Go starts the response's write clock when the
   headers are read, so the body counts against it; the write timeout rises from 135 s to 255 s, above the read
   window plus the upstream's 130 s. `read_header 10s` is added, so headers get 10 s rather than Caddy's 1 minute
   default.

## Evidence

Measured with the pinned sharp 0.35.5 on noise pictures, which compress worst: one 102-megapixel JPEG of 47 MB, all
versions, peaked at 284 MiB and took 10.5 s on one core; a 63 MB PNG at 418 MiB and 15 s. Two 110-megapixel JPEGs
(12,000 x 9,166, 37 MB) through the real pool at once, each child under an 8 GiB address space, both finished in
12.2 s. The 2-CPU figure is not yet measured on staging; a staging run with a 60 MB file checks it.

## Consequences

- Every route on the edge may now take 120 s to send its request, not 30 s. What still bounds each route is its own
  body cap: web's gate refuses any body above the route's `maxBody` or without a length before reading it, so only
  `/images` may send 65 MiB; the PDS keeps its own caps. A slow sender holds a connection up to 120 s, not 30 s;
  Caddy's 1 minute idle read timeout still drops one that stalls.
- Pangolin, in front of the staging edge, has its own timeouts, which we have not verified; the staging check with a
  60 MB file tests them.
- Web's memory at the site-wide cap rises to about 260 MiB of bodies, inside its 1 GB.
- The upload screen (P2.19b), where it names a size, says 64 MB.

## Alternatives

- Keep 30 MB: members with 60 to 100 megapixel cameras would have to resize first.
- Stream the upload to review instead of reading it into web's memory: less memory, but SvelteKit's form actions read
  the body whole, and the four-upload cap already bounds it.
- A per-route read window: Caddy 2.11.9 has none for the total; only an idle and minimum-rate window per route
  (experimental).

## Compliance

`domains/content/images/standard.test.ts` holds the upload numbers and checks a 60,000,000-byte, 102-megapixel
picture fits; `infrastructure/image/wire.test.ts` accepts a job at the ceiling and refuses one byte or one pixel past
it; `infrastructure/net-guard/src/request-caps.test.ts` sends 60,000,000 bytes and 66 MiB to review and refuses one
byte more; `interfaces/web/src/lib/server/body-cap.test.ts` fits a 64 MiB picture with the longest alt and caption
under `/images`' 65 MiB. `tests/integration/deployment/edge/timeouts.ts` checks every edge server reads for
`EDGE_READ_BODY_S` and writes for longer than that plus the upstream's wait, and `compose.dev.test.ts` ties the
compose limits to `limits.dev.json`. Acceptance is Alex's line on the pull request that adds this record.
