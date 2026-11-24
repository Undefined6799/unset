---
status: Proposed
date: "2026-11-21"
step: P2.19f
amends:
  - adr: "0070"
    part: point 3, the main version (JPEG, 2560 px, 2,000,000 bytes); point 8, the 2 MiB uploadBlob and store hops; the rejected alternative "store our own format only (WebP or AVIF) as the PDS blob"
---
# 0088 — A picture's main version is a WebP of up to 4,096 px and 5,000,000 bytes

This ADR amends points 3 and 8 of [0070](0070-shared-image-foundation.md). Every other point of 0070 and of 0076 stands.

Alex asked for "the most efficient and the best quality possible" and said "I want photograph to be happy". On
2026-11-21 he confirmed a 5,000,000-byte picture ("ok 5mib is good") and a WebP main version of up to 4,096 px ("all
yes", 17:42Z). At 17:43Z he ruled out shrinking and retrying when a PDS refuses the size: "server should accept our
picture so I would not account for it". The card lexicon (0086, `sh.unset.block.defs#image`) accepts `image/*` up to
5,000,000 bytes, so this ADR lands after it.

## Context

The main version is the blob every atproto app reads from the member's repository. 0070 made it a JPEG of 2,560 px at
up to 2,000,000 bytes, which is Bluesky's post-image limit. A card picture is not a Bluesky post, and our lexicon now
allows 5,000,000 bytes. At the same size in bytes, WebP holds more detail than JPEG, and it keeps transparency.

Every browser we support decodes WebP. Bluesky's image service reads any format sharp reads, WebP included. This is
from reading source; a staging check is owed once picture cards are live. Our PDS takes blobs up to
`PDS_BLOB_UPLOAD_LIMIT` 5,242,880 bytes. PDS 0.5.51 refuses a larger one with XRPC `PayloadTooLarge`, HTTP 413.

**A bug found while preparing this change.** Web read a draft's main version from the object store through net-guard
with no answer cap of its own. net-guard's 1 MiB default applied, so a main JPEG over 1,048,576 bytes could not be
read when the card was saved, and the member saw "Your picture could not be saved just now". A test proves it:
`infrastructure/net-guard/src/object-store-fetch.test.ts`, case `store.default_cap_was_the_bug`. Uploads are not open
to any member yet.

## Decision

1. **The main version is a WebP.** Its longest side is at most 4,096 px, never enlarged, and it is at most 5,000,000
   bytes. It is sRGB with no metadata, and transparency is kept. The display and avatar versions do not change.
2. **Pixels go before quality.** Each size starts at q90 and steps down to q75: 4,096 px first, then 3,072 px. Only
   after both does the version fall to 0070's 2,560 px, stepping down to q45. A picture that fits none of these is
   refused as too large, as before.
3. **A PNG within 5,000,000 bytes is tried lossless first** at the full size, and kept if it fits. A screenshot or
   drawing then stays exact. A larger PNG is not tried lossless, because lossless WebP is smaller than the PNG it reads
   and a PNG photo would spend seconds on a try that cannot fit.
4. **A PDS that refuses the size gets nothing smaller.** On HTTP 413 the member sees one clear message:
   `card.image_too_large`, "Your sign-in server would not take a picture this large. Nothing was saved. Choose a
   smaller picture." The use is released and no card is written. `opFailure` reads any 413 this way, a proxy's bare
   413 included. Before this change, a 413 read as "your sign-in server is not answering".
5. **The loosenings**, on Alex's typed line for this PR (ADR 0059). Each states what still holds.
   - net-guard `atprotoBlobUpload` request cap goes from 2 MiB to 5 MiB (5,242,880 bytes). It still applies to the one
     uploadBlob call only; every other atproto request keeps 1 MiB.
   - net-guard `objectStore` put cap goes from 2 MiB to 5 MiB. A new `objectStoreFetch` gives the store's answers the
     same 5 MiB cap. It is the only fetch web and media build for the store, so no process falls back to the default.
     Each policy keeps its one exact private origin.
   - media's serve cap goes from 2 MiB to 5 MiB. It is defence in depth, since the pipeline stores nothing larger.
   - review's job ceiling for one version goes from 4,000,000 to 5,000,000 bytes. A job may name at most four smaller
     sizes, each below the one before, and lossless only for WebP. review still refuses any job past its ceiling.

## Alternatives

- **Keep the 2,000,000-byte JPEG.** It fits Bluesky's post limit, but Alex chose quality for photographs, and a card
  is not a post.
- **AVIF as the main version.** Smaller still, but slower to encode at 4,096 px within review's 20 s, and less widely
  decoded by atproto apps today.
- **Shrink and retry when a PDS refuses the size.** Rejected by Alex (17:43Z). Our own PDS takes 5,242,880 bytes, and
  the member gets one clear message instead.
- **Lower quality before fewer pixels.** At 4,096 px, a hard photo at q45 looks worse than 3,072 px at q75.

## Consequences

- The PDS blob is larger: up to 5,000,000 bytes instead of 2,000,000, and a little more web-to-PDS traffic per save.
- Encoding takes longer. These were measured in review's real child process (one thread), with the 6 MB to 64 MB
  inputs shown, in a 4-core container:
  - a 24-megapixel noisy photo: 8 s;
  - a 102-megapixel noisy photo: 7 s;
  - a 12-megapixel noisy PNG: 12 s.

  Pure noise at 24 megapixels, which no camera makes, takes 30 s and is refused as `image.timeout` under review's 20 s.
  Each size is decoded once and encoded at each quality from its pixels.
- A draft stored before this change is a `main.jpeg`. It now reads as missing ("Upload it again"). Drafts last a day.

## Compliance

The tests that prove each point:

- `domains/content/images/standard.test.ts`: the numbers.
- `infrastructure/image/encode.test.ts`: the order of tries.
- `infrastructure/image/pool.test.ts`, cases `main.webp_4096`, `main.smaller_first` and `main.png_lossless`.
- `infrastructure/image/wire.test.ts`: the job ceiling.
- `infrastructure/net-guard/src/request-caps.test.ts` and `object-store-fetch.test.ts`: each cap at its limit and one
  byte past it.
- `interfaces/media/serve.test.ts`.
- `infrastructure/pds/blob-upload.test.ts` and `card-pictures.server.test.ts`, case `picture.pds_too_large`: the 413.

Acceptance is Alex's line on the pull request that adds this record.
