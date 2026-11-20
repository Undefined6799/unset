# 0070 — One shared image foundation: blobs in the member's repository, five stages, an empty inspection port

Status: Proposed (awaiting Alex). Steps P2.17 to P2.19c. Alex asked for it on 2026-11-20 01:12:01Z ("Build one
reusable image foundation for profile cards, galleries, project screenshots, and future posts/blog content") and set
its direction at 01:23:11Z: no moderation or fingerprint check for now, a cleanly separated foundation that later
checks mount onto, decent quality for photographers, every picture converted to a proper format with all metadata
stripped, and moderation in place before production rather than an upload switch. It supersedes step-book text
(listed under Consequences) and replaces one paragraph of ADR 0029, which is still Proposed. It contradicts no
accepted record: ADR 0041 (the object store) and ADR 0039 (sign-in scopes) stand as they are.

## Context
The profile needs images: a single-image card, pictures on collection entries such as project screenshots, and a
small gallery; posts and blogs will need the same later. Today nothing uploads an image. The avatar editor changes
`avatarShape` only, and the pages show the initial letter. The object store (ADR 0041) and its adapter exist; sign-in
already asks for `blob:image/*` (ADR 0039); the indexer's `idx.record_blob` records which records use which blob.

The step book's image steps were written before ADR 0051 moved profile saves straight to the member's PDS. P2.16 puts a
fingerprint gate (PDQ and Arachnid Shield) before storage and refuses to boot production without it; P2.17 makes
avatar and cover crops capped at 1,000,000 bytes; P2.18 keeps profile and section drafts in our tables; P2.19 serves
draft previews; P3.09 serves published blobs. The published `sh.unset.profile` has no cover, its avatar allows
2,000,000 bytes, and there are no draft tables, so those steps no longer fit. Alex has also decided that moderation,
the fingerprint check included, is a later feature, built before production.

Facts this record rests on, read in the pinned sources:
- atproto's model is a blob in the member's own repository, referenced by records. Bluesky's post image
  (`app.bsky.embed.images#image`, @atproto/api 0.32.3) is `{image: blob up to 2,000,000 bytes, alt (required),
  aspectRatio}`, at most four per post; its avatar and banner are PNG or JPEG up to 1,000,000 bytes. Each use carries
  its own alt text.
- @atproto/pds 0.5.51 (`actor-store/blob/transactor.js`, `deleteDereferencedBlobs`): when a record stops using a
  blob, the PDS deletes the blob only if no other record of the account still references its CID. A blob uploaded
  and never referenced stays in the PDS's temporary store; no code path removes it.
- The PDS accepts blobs up to 5 MiB (`PDS_BLOB_UPLOAD_LIMIT`, pinned by `deployment/preflight/checks/settings.ts`).
  net-guard caps an outgoing request body at 1 MiB (`infrastructure/net-guard/src/request.ts`), and web's PDS calls
  go through it.
- sharp 0.35.5 (`dist/output.mjs:1236`): the prebuilt binaries read and write AVIF, but HEIC (HEVC) needs a system
  libvips built with patent-encumbered codecs. iOS converts a HEIC photo to JPEG when a file input does not accept HEIC.

## Decision
1. **An image is a blob in the member's repository, and each use describes it.** A new lexicon `sh.unset.defs`
   defines `#image`: `{image: blob (image/jpeg), alt: string, aspectRatio: {width, height}}`, the shape of Bluesky's
   post image. Every use embeds it and adds what belongs to that use: a caption, and a fit that is `contain` (the
   picture's own proportions) unless the member chooses `fill` for that use. `sh.unset.section` gains an `#image`
   card, a `#gallery` card (at most 12 images, in order) and an optional `image` on `#entry`. Posts and blogs will
   embed the same `#image`. The profile's avatar keeps its published field. Because the PDS keeps a blob while any
   record uses it, removing one use never deletes a picture used elsewhere, and our own copies follow the same rule
   (point 6).
2. **One pipeline in five stages, each behind its own boundary.**
   1. *Intake*, in web's upload route: a signed-in member, the CSRF gate, the declared size and type checked before
      anything is decoded, the member's upload limits and storage quota.
   2. *Processing*, in a killable child process with a time limit, a memory limit and a bounded queue: the bytes are
      sniffed by magic number, decoded under a pixel cap, turned upright from their orientation tag, converted to
      sRGB, stripped of every metadata block, and written out as the versions in point 3. sharp is the only image
      library and is imported in one adapter folder, `infrastructure/image/` (a new adapter folder; this record is
      its decision).
   3. *Inspection*, a port with no implementation mounted. It receives the processed versions and answers pass,
      refuse or hold. Moderation, fingerprints, AI alt-text suggestions, descriptions and categories for search mount
      there later, each in its own step. Their results attach to the image as our own metadata in a table that step
      adds; nothing is reserved now.
   4. *Storage*: the versions go to our private store under `drafts/<did>/i/<imageId>/` (ADR 0041's key convention and
      web's existing key), with one row per image in `app` (owner, sizes, state, timestamps). The bytes as uploaded are
      never stored: they live only in the request and the child process.
   5. *Publish*: when a save first uses an image, web uploads its main version to the member's PDS and then writes the
      record. Never earlier, because an uploaded blob no record references is never cleaned up by the PDS.
3. **The image standard.** Accepted: JPEG, PNG, WebP and AVIF, up to 30 MB and 70 megapixels, at most 12,000 px a
   side. Refused with a clear message: GIF and every animated image, HEIC, SVG, TIFF, camera RAW and anything else.
   Versions:
   - *main* (the PDS blob, what every atproto app sees): JPEG, longest side at most 2560 px, never enlarged, quality
     about 85 lowered step by step until it fits 2,000,000 bytes, sRGB, no metadata.
   - *display* (ours, for pages): AVIF and WebP at 480, 960 and 1600 px wide (never wider than the main version).
   - *avatar*: the member's chosen square crop, a 1000x1000 JPEG under 1,000,000 bytes (fits Bluesky's avatar too),
     with 128 and 256 px display versions.
   A crop is never baked into the main version of a general image; it is the use's `fill`, applied when shown.
4. **Limits.** Per member, in web: 120 images an hour and 1,000 a day, and the account's `storage_quota_bytes`
   (default 2 GiB) for every live image. The edge's `blob_upload` zone, which counts every member at once because web
   reaches the PDS from one address, rises from 60 to 3,000 per 5 minutes, so it stops floods only. Each limit gets a
   test that normal use fits inside it.
5. **Serving through the media origin only.** Before a save, the owner sees previews through short-lived signed links
   (book P2.19). After publishing, `media` serves `/b/<did>/<cid>` for a visible account's indexed record that
   references the CID (book P3.09), and its display versions for pages. No page ever links a raw PDS `getBlob` or the
   store. `img-src` in the app's CSP gains the media origin.
6. **Lifecycle.** An image no save has used is deleted with its row 24 hours after upload. When no record of the
   account references an image's CID any more (`idx.record_blob`), our copies are released and deleted 7 days later,
   so a quick undo or a second use keeps it. A failed upload deletes what it wrote before answering. Erasure deletes
   the member's rows and the `drafts/<did>/` prefix (ADR 0041 Decision 7); export lists every live image. A mass-delete
   governor stops a sweep that would delete more than its cap in one run.
7. **Production refuses to publish images while the inspection port is empty.** Outside production (dev, local,
   staging, tests) an image may be published with nothing mounted. In production the publish stage answers "not
   available" until a real inspection is mounted; there is no flag that skips it. Before real members, P5.01's store
   gates (ADR 0041 Decision 6 and 7) also hold.

## Alternatives
- **Keep the step book's order: fingerprint gate first (P2.16), then the pipeline.** Rejected by Alex: moderation is a
  later feature. The empty inspection port is where it mounts, so no stage moves when it arrives.
- **Upload to the PDS at upload time and preview from it.** Simpler, but the PDS never deletes an unreferenced
  upload, so every abandoned upload would stay in the member's repository storage for good.
- **Store our own format only (WebP or AVIF) as the PDS blob.** Smaller, but JPEG is the one format every atproto app
  and every browser decodes; the small modern formats are our display versions instead.
- **A 2000 px, 1,000,000-byte main version, as Bluesky's apps make.** Fits net-guard's 1 MiB cap with no change, but
  Alex wants decent quality for photographers; 2560 px at up to 2,000,000 bytes stays inside Bluesky's own lexicon
  limit for post images.
- **Resize on request, as Bluesky's image service does.** A CPU and cache service we do not need yet; three widths
  made once at upload serve the pages.
- **Keep wide-gamut (Display P3) colour.** Possible with sharp; left for later if photographers ask, since sRGB is what
  every screen shows the same.

## Consequences
- Loosenings, each its own pull request on Alex's typed line (ADR 0059): web's adapter body cap rises from 2 MiB to
  31 MiB for the upload route alone (every other route keeps its own cap at the gate); net-guard's request body cap
  rises from 1 MiB to 2 MiB for the PDS upload call only; the app CSP's `img-src` gains the media origin; the edge's
  `blob_upload` zone rises to 3,000 per 5 minutes.
- Superseded step-book text, edited in this record's pull request: P2.16 (the gate before storage and the production
  boot refusal; the PDQ hasher P2.16b is parked, its rebased commit kept outside the repository), P2.17's purposes and
  variant table, P2.18's profile and section draft tables and avatar/cover purposes, the image half of P2.21, and the
  scan-record rule ADR 0029 assigns to P3.09a.
- ADR 0029 (Proposed) says no image is public anywhere until a passing record from the real checker exists. Under this
  record that holds for production only: outside production a published image is served with the inspection port
  empty. 0029's paragraph is replaced by this one when both are accepted; 0029 is not edited.
- The media domain (ADR 0029) is still needed and still undecided. Until it is, staging shows no images; the local
  stack uses a `.test` origin.
- A save that fails after the PDS upload leaves one unreferenced blob in the PDS's temporary store. It is rare and
  harmless to others; a later pds-admin cleanup removes such blobs.
- Personal data: members' pictures and their alt text. Purpose: showing them where the member placed them. Basis:
  the member's own action. Retention: as above. Erasure and export: point 6. The privacy notice paragraph is written
  with the moderation explanation, before production.
- If production uses a hosted object store, an outside company would hold members' pictures; P5.01 seals them first
  (ADR 0041 Decision 6).

## Compliance
Tests in each step's pull request: processing refuses malformed, truncated, oversized, too-many-pixel, animated and
mismatched files, removes every metadata block, applies orientation, survives a child crash and a timeout, and answers
"busy" when the queue is full; storage checks ownership on every key and row, quota and limits under concurrency, the
24-hour and 7-day expiries, a shared CID kept while used, erasure and export; publish is refused in production with no
inspection mounted; media serves only referenced, visible images with the sandbox headers. `shared/lexicons` tests pin
the new shapes. Reviewed when the first inspection mounts and before production.
