# 0070 — One shared image foundation: processing apart from web, an empty inspection port

Status: Accepted by Alex, 2026-11-20 02:50Z, against d1e6117 (his line "Merge 1819 at d1e6117", typed in this record's
thread after the coordinator had reviewed that head and CI was green); #1819 merged at cfd2a6e as b6fdb75 after two
merges of main, the second resolving a row-order conflict in the decisions index. This status paragraph, the index row
and the ADR 0001 acceptance line were added afterwards in the next P2.17 pull request. Steps P2.17 to P2.19c. Alex asked
for it on 2026-11-20 01:12:01Z ("Build one reusable image foundation for profile cards, galleries, project screenshots,
and future posts/blog content") and set its direction at 01:23:11Z: no moderation or fingerprint check for now, a
cleanly separated foundation that later checks mount onto, decent quality for photographers, every picture converted to
a proper format with all metadata stripped, and moderation in place before production rather than an upload switch. It
supersedes step-book text (listed under Consequences) and replaces one paragraph of ADR 0029, which is still Proposed.
Decision 9 supersedes one line of ADR 0012 (the licence record). It contradicts no other accepted record: ADR 0041 (the
object store) and ADR 0039 (sign-in scopes) stand as they are.

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
   card, a `#gallery` card (at most 12 images, in order) and an optional `image` on `#entry`; readers that do not know
   a kind hide the card (`readCard` returns null), so older code shows nothing rather than an error. Posts and blogs
   will embed the same `#image`. The profile's avatar keeps its published field. Because the PDS keeps a blob while
   any record uses it, removing one use never deletes a picture used elsewhere, and our own copies follow the same
   rule (point 6).
2. **One pipeline in five stages, each behind its own boundary.**
   1. *Intake*, in web's upload route: a signed-in member, the CSRF gate, the declared size and type checked before
      the body is read, the member's upload limits and storage quota, and the production refusal (point 7).
   2. *Processing*, in its own process, `review` (the guideline's `interfaces/review/`, "upload checks, no-network
      compute"), never inside web. Web sends the bytes and gets the versions back; nothing else crosses. `review`
      holds no secret, no database role, no store key and no session; it runs as a non-root user on a read-only file
      system with one temporary directory, on one internal network, `review_web`, shared only with web (no route out;
      the preflight refuses `review` on any other network or with any secret), and
      starts its own killable child processes with an empty environment and no inherited descriptors, each with a
      time limit, an address-space limit and a bounded queue. A codec exploit (the libwebp CVE-2023-4863 class) can
      then reach only the bytes it was sent. Inside the child the bytes are sniffed by magic number, only the four
      accepted libvips loaders may run (sharp's `block`/`unblock`), the picture is decoded under a pixel cap, turned
      upright from its orientation tag, converted to sRGB, stripped of every metadata block, and written out as the
      versions in point 3. sharp is imported in one adapter folder, `infrastructure/image/`, and only `review` uses it.
   3. *Inspection*, a port with no implementation mounted. It receives the processed versions and answers with one
      of the results below. Moderation, fingerprints, AI alt-text suggestions, descriptions and categories mount there
      later,
      each in its own step, from a closed list of named implementations wired only in web's composition root. Their
      results attach to the image as our own metadata in a table that step adds; nothing is reserved now. The result
      type and the image's states are designed now for what a later check must be able to say, though none is built:
      *pass*; *held for review* (a close match or an uncertain answer: the picture is neither published nor shown
      back to the uploader, who sees a neutral message with no reason, and a reviewer releases it or blocks it);
      *blocked* (a confirmed match: kept as evidence under a legal hold that erasure and ADR 0067's 30 days cannot
      remove, never served); and, beside any of them, *freeze the uploader's uploads* (repeated close matches, or a
      confirmed one). An image's states are therefore `uploaded`, `held`, `blocked`, `published` and `released`.
      `blocked` is a new retention category, so the step that builds it adds its row to the record of processing and
      its line to the privacy notice. The research of 2026-11-20 (the plan, "Moderation, later") points the first
      check at a small PDQ client on our side calling Arachnid Shield's hash-only endpoint (`POST /v1/pdq`, OpenAPI
      v1.1.0: hashes leave, never the picture), not Meta's Hasher-Matcher-Actioner, which needs a list we could hold
      locally and Shield gives none.
   4. *Storage*: the versions go to our private store under `drafts/<did>/i/<imageId>/` (ADR 0041's key convention and
      web's existing key). That prefix holds an image's copies for its whole life, published display copies included,
      so web keeps one key and media its existing read-only grant. One row per image in `app` (owner, sizes, state,
      timestamps) and one row per use (the record that uses it). The bytes as uploaded are never stored: they live
      only in web's request and in `review`'s child.
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
4. **Limits.** Per member, in web: one upload at a time, 120 images an hour, 1,000 a day, and the account's
   `storage_quota_bytes` (default 2 GiB) for every live image. Site-wide, in web: at most 4 upload bodies in flight
   (about 124 MiB of memory at the cap); a fifth waits or is refused as busy. The edge's `blob_upload` zone rises from
   60 to 3,000 per 5 minutes (point 8). Each limit gets a test that normal use fits inside it.
5. **Serving through the media origin only.** Before a save, the owner sees previews through short-lived signed links
   (book P2.19). After publishing, `media` serves `/b/<did>/<cid>` for a visible account's indexed record that
   references the CID (book P3.09), and its display versions for pages. No page ever links a raw PDS `getBlob` or the
   store. `img-src` in the app's CSP gains the media origin; public pages stay script-free.
6. **Lifecycle.** An image no save has used is deleted with its row 24 hours after upload. Web records each use when
   it writes a record and removes it when a save drops it; when an image has no use left, its copies are deleted 7
   days later, so a quick undo or a second use keeps it. The count lives in `app` because `idx` can be dropped and
   rebuilt (rule DA-1); a use removed by another client is reconciled from the indexer later, and until then media
   still serves only what an indexed record references. A failed upload deletes what it wrote before answering. A
   mass-delete governor stops a sweep that would delete more than its cap in one run. Account deletion (ADR 0067):
   from the request, media serves none of the member's images (the account is not visible); our copies stay until
   day 30, so an undo restores them; at erasure the rows and the `drafts/<did>/` prefix go (ADR 0041 Decision 7). A
   self-deletion on the PDS is erased at once by the indexer's `eraseDid`, copies included. Export lists every live
   image. The privacy notice's retention lines change in the step that builds storage, in the same pull request.
7. **Uploads with no real inspection are allowed only where we say so; everywhere else they are refused.** The
   rule fails closed: web refuses image uploads at intake while no real inspection is mounted, unless its own
   `PUBLIC_ORIGIN` is on a closed list of origins that hold only test accounts. Today the list is `localhost` and
   `*.test` origins (development, tests and the local stack) and `https://staging.unset.sh`. Any other origin, an
   unknown one included, refuses: nothing is accepted, processed, stored or previewed there before a check exists. As
   extra refusals, never as permissions, uploads are also refused when `UNSET_ENV` is `prod` or the configured PDS is
   our production PDS (`PDS_HOSTNAME` is `unset.ac`), so a production stack with a mistaken origin still refuses. A
   real inspection is one of the closed list in point 2.3; a test double or a pass-everything implementation is never
   on it, and wiring one with a production origin, environment or PDS refuses to boot. The stack's preflight refuses
   to start a stack whose origin is off the list with no inspection configured.
   The staging entry holds only while staging has test accounts alone. Staging is reachable from the internet, runs
   with `UNSET_ENV` `dev` and our staging PDS, and members of other PDSes (bsky.social) can already sign in to it, so
   any of them can upload and, once the media host serves `/b/*`, publish unchecked pictures that anyone with the
   exact link could load. Alex accepts that by accepting this record, or keeps `/b/*` closed on staging until an
   inspection exists (ADR 0029's Pangolin rules). The step that opens invitations to real members either mounts an
   inspection or removes `https://staging.unset.sh` from the list, and its tests check that. Before real members,
   P5.01's store gates (ADR 0041 Decisions 6 and 7) also hold.
8. **The loosenings this needs**, each its own pull request on Alex's typed line (ADR 0059), with what still holds:
   - Web's adapter body cap from 2 MiB to 31 MiB, for the upload route alone. Mechanism: the cap is the largest
     route's `maxBody`, and the gate refuses any route's body above its own `maxBody` or without a length. Risk:
     memory, since SvelteKit reads the body into memory; held by point 4's one-per-member and four-site-wide caps.
     Every other route keeps its own cap.
   - net-guard's request body cap from 1 MiB to 32 MiB for web's call to `review` (one internal origin) and to 2 MiB
     for the PDS `uploadBlob` call. Risk: low; both are bound to one call and one destination, and every other request
     keeps 1 MiB.
   - A net-guard `internal` policy for `review`'s one origin. Risk: low; one private address, no route onward.
   - The app CSP's `img-src` gains the media origin. Risk: low; our own origin, served with the sandbox headers; no
     script source changes.
   - The edge's `blob_upload` zone from 60 to 3,000 per 5 minutes. Risk: for web's own calls it is site-wide (all of
     web reaches the PDS from one address, the finding in #1816), so it protects nothing per member; point 4's
     per-member caps in web are the real control, and the zone only stops floods. For other clients of our PDS it
     stays per address.

9. **AGPL-3.0-only packages may depend on LGPL-3.0-or-later libraries.** This is the one licence added to ADR 0012's
   list for AGPL packages, here for libvips, which sharp ships in its prebuilt binaries (`@img/sharp-libvips-*`
   1.3.4); it supersedes that line of ADR 0012. LGPL-3.0 is GPL-3.0 with extra permissions, and GPL-3.0 code may be
   combined with AGPL-3.0 code (AGPL-3.0 section 13), so the combination is distributable under our licence.
   Everything else stays refused: MIT packages still take only permissive licences, and GPL, LGPL-2.1 and any other
   licence still stop the check. The check's allowed list changes in the pull request that adds sharp.

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
- **Decode in a child process of web, as book P2.17 planned.** Simpler, but a codec exploit would run with web's
  database role, keys and network; `review` holds none of them.
- **Resize on request, as Bluesky's image service does.** A CPU and cache service we do not need yet; three widths
  made once at upload serve the pages.
- **Keep wide-gamut (Display P3) colour.** Possible with sharp; left for later if photographers ask, since sRGB is what
  every screen shows the same.

## Consequences
- `review` is a new process and image, with its own compose service, internal network, preflight checks and a test
  that it cannot read web's secrets or open a connection. It is the guideline's reserved home, created by its first
  real step, and moderation inspections that need the pixels can later run there too.
- sharp 0.35.5 (Apache-2.0, the established Node image library, maintained by lovell with releases in 2026) brings
  prebuilt libvips binaries (`@img/sharp-*`, LGPL-3.0 libvips) that parse untrusted input. Pinned exactly with
  integrity hashes, past the 7-day release age, audit green when added; Renovate raises it, and a libvips CVE is a
  severity-2 update. It runs only in `review`'s children, behind the sandbox in point 2.2.
- Superseded step-book text, edited in this record's pull request: P2.16 (the gate before storage and the production
  boot refusal; the PDQ hasher P2.16b is parked, its rebased commit kept outside the repository), P2.17's purposes and
  variant table and its child inside web, P2.18's profile and section draft tables and avatar/cover purposes, the
  image half of P2.21, and the scan-record rule ADR 0029 assigns to P3.09a outside production.
- ADR 0029 (Proposed) says no image is public anywhere until a passing record from the real checker exists. Under this
  record that holds for production, where uploads are refused outright until an inspection exists; outside production
  a published image is served with the inspection port empty. 0029's paragraph is replaced by this one when both are
  accepted; 0029 is not edited.
- The media domain (ADR 0029) is still needed and still undecided. Until it is, staging shows no images; the local
  stack uses a `.test` origin.
- A save that fails after the PDS upload leaves one unreferenced blob in the PDS's temporary store. The stock PDS has
  no call that removes it; this is an open item, not solved here.
- Personal data: members' pictures and their alt text. Purpose: showing them where the member placed them. Basis:
  the member's own action. Retention and erasure: point 6. Export: every live image. The privacy notice's image lines
  change with the storage step; how pictures are moderated is added when moderation is built, before production.
- If production uses a hosted object store, an outside company would hold members' pictures; P5.01 seals them first
  (ADR 0041 Decision 6).

## Compliance
Tests in each step's pull request: `review`'s child cannot read web's secrets or open a socket; production wiring with
no inspection or with a test double refuses intake and boot; processing refuses malformed, truncated, oversized,
too-many-pixel, animated and
mismatched files, removes every metadata block, applies orientation, survives a child crash and a timeout, and answers
"busy" when the queue is full; storage checks ownership on every key and row, quota and limits under concurrency, the
24-hour and 7-day expiries, a shared CID kept while used, erasure and export; publish is refused in production with no
inspection mounted; media serves only referenced, visible images with the sandbox headers. `shared/lexicons` tests pin
the new shapes. Reviewed when the first inspection mounts and before production.
