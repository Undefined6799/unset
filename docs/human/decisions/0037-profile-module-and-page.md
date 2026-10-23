# 0037 — The profile is its own module, stored on the member's PDS, edited by its owner

Status: Proposed (awaiting Alex)

## Context
On 2026-10-23 Alex designed the profile page in Figma (file 4hrOlzQ1d0lA8Acm4KyLVf, page Profile) and asked for it on
staging the same night. The page is GitHub-like: a side column with the avatar, display name, `@handle` with a
`[ VERIFIED ]` tag, headline, Copy link, location, website, the DID and the member's own links, beside a free-form
README. Several choices behind it are expensive to reverse (D8): a new top-level domain folder, the shape of the
`sh.unset.profile` record (lexicon P2.20q), where the profile is stored, and script on a profile page.

Alex's words, 2026-10-23 (profile page thread): 02:59Z "it feel like the profile should be a module ... Identity is
the atproto session etc."; 02:56Z the markdown renderer "may be used in other features later as well"; 02:40Z JS on
the owner's page is fine; 03:58Z typed edits save to the draft with no field Save; 04:06Z handle, verified tag and DID
are not editable, members add their own links; 04:29Z "have all the stuff in the left pane modifiable in settings".

## Decision
1. **A profile module.** `domains/profile` holds what a member may write on their page, read once from untrusted
   input (DM-1), and the record built from it. Identity keeps sign-in, sessions and handle checks. The PDS adapter
   (`infrastructure/pds/profile-record.ts`) reads and writes the record; `interfaces/http` composes them.
2. **The member's PDS holds the profile; we keep no copy.** The record is `sh.unset.profile` with record key `self`
   in the member's own repository. A save reads the stored record, replaces only the fields the form sent (an emptied
   field is removed), keeps every other field, validates the result with the lexicon's strict validator, and writes
   it with `swapRecord` set to the CID it read, so a concurrent change elsewhere is a conflict (409), never a silent
   overwrite (DA-4: compare-and-swap; no network I/O inside a transaction, since there is none). A record another
   client broke is refused, never written back. Reads are lenient field by field, so one bad field does not hide the
   page.
3. **No new personal data on our side.** The profile lives on the member's PDS, under their account; erasure and
   export are the PDS's account deletion and repository export. Drafts live only in the owner's open tab. Logs carry
   the route, status and error code only (SE-7): never a field value, a DID or a handle.
4. **The README is typed blocks; BlockNote edits them in the owner's browser** (Alex, 21:08Z: "the real blocknote
   experience", with the logic on the backend). The record stores our own small block model (P2.20w): paragraph,
   heading, list item, quote, code block and two or three columns, with text runs (bold, italic, underline, strike,
   code) and link runs. It is not BlockNote's JSON, so any client can read it and the editor can be replaced. The
   server never trusts the editor: it reads the posted blocks into this model once (DM-1), drops what the model does
   not hold, checks every link with `safeHref`, writes the record as in point 2, and renders visitor HTML itself with
   no script. Raw HTML is never stored or rendered; links carry `rel="nofollow ugc noopener noreferrer"`; no image is
   loaded until uploads go through the media proxy.
5. **Script only for the owner, and BlockNote only on the owner's editor page.** A profile page, the owner's included,
   runs no script (its CSP has no `script-src`, plan §5.4), so the README is edited on its own page,
   `GET /profile/readme`, under the app pages' CSP unchanged: scripts only from our assets, and Trusted Types with no
   policy at all. That page loads a separate owner-only chunk with BlockNote 0.56.0's core (`@blocknote/core`,
   MPL-2.0, on TipTap and ProseMirror, MIT), pinned exactly, bundled and served from our origin, never fetched from
   a CDN. The chunk is outside the 15 KB per-island and 80 KB total island budget, which still holds for every other
   island and page (Alex, 21:29Z: "approve BlockNote 0.56.0 as an owner-only editor chunk outside the island budget").
   The exception is a folder, not one file: every browser entry under `apps/web/src/editor/`, with the JS only those
   entries reach, shares one cap of 256 KiB gzip, and only that folder may import BlockNote, TipTap or ProseMirror
   (P2.20z). BlockNote's engine does the editing; its toolbar, slash menu and block handle are our own
   components on the design sheet, because BlockNote's ready-made menus write raw HTML (a closing popover's snapshot,
   pasted HTML), which Trusted Types refuses (Alex, 21:40Z: make it follow our rules, it may be reused). So paste is
   plain text. Columns are our own custom block on BlockNote's core, not `@blocknote/xl-multi-column` (GPL-3.0 or
   paid).
6. **The side column is edited in Settings › Profile**, a plain form that posts with no script to `POST /profile` and
   returns there. Handle, verified tag and DID are never editable; they come from the session and the two-way handle
   check (P2.02). Links are up to 12 http(s) addresses, a scheme-less one gaining `https://`, each shown through
   `safeHref` with `rel="nofollow ugc noopener noreferrer me"`.
7. **Two save routes, form bodies only.** `POST /profile` saves the side column (96 KiB body cap) and
   `POST /profile/readme` the README (one `readme` field holding the editor's document, at most 100,000 bytes, with a
   294 KiB body cap since form encoding can triple it). Both run the session and CSRF gate, take the DID from the
   session (never the request), refuse a repeated field, and answer 303 to the member's page or to Settings › Profile
   (the only other place they return to). A README larger than 100,000 bytes of JSON is refused on save and read as
   none, since the lexicon cannot state a total.
8. **A README the staging preview stored as markdown is kept.** The first night's preview wrote `readme` as a string;
   the reader takes such a string as plain paragraphs, so the page still shows it and the next save writes it back as
   blocks. Without that, the strict validator would refuse every save for that member (P2.20x).

## Alternatives
- **Keep the profile inside `domains/identity`.** Fewer folders, but identity would mix session security with page
  content that changes for different reasons. Rejected by Alex 02:59Z.
- **Store profiles in our Postgres.** Faster reads and search, but a second copy of member data with its own erasure,
  export and retention, and a profile that no longer travels with the account. Rejected: the PDS is the source of
  truth, and a later index can be rebuilt from it (DA-1).
- **A server-side draft table.** Survives a closed tab, but stores unpublished personal text with its own lawful
  basis, erasure and export. Rejected for now; the tab keeps the draft.
- **Markdown as the stored README.** Ran on staging the first night; Alex chose BlockNote editing at 21:08Z, and a
  block model maps to it without a lossy text round trip.
- **Our own BlockNote-style editor, no dependency.** Fits the island budget, but rich text across blocks, paste,
  mobile keyboards and undo are what ProseMirror exists for; Alex wants the real BlockNote experience.
- **BlockNote's own menus, with a Trusted Types policy on the editor page.** Works (tried in Chromium, 21:31Z), but
  loosens the page's CSP for one library; Alex chose our own menus at 21:40Z.
- **Store BlockNote's JSON as is.** Less mapping, but ties the record to one editor's internal format and its version.
- **Edit everything in place on the page.** Tried on staging the same night; Alex moved the side column to Settings
  at 04:29Z.

## Consequences
- New folder `domains/profile` (CLAUDE.md "Where does this go" gains the row with the first code PR).
- `sh.unset.profile` gains `readme` and `links` (P2.20q); `readme` becomes typed blocks (P2.20w).
- A new runtime dependency on the owner's edit chunk only: BlockNote 0.56.0 and what it brings (TipTap,
  ProseMirror, Floating UI), with a supply-chain note in the dependency PR. The markdown renderer (#1317) is no longer
  needed for the README.
- The Profile component (and the block renderer) need Alex's approval on the design sheet before their PRs merge.
- A profile page needs its PDS to answer; when it does not, the page says so and offers no editing, so a save can
  never blank a record it could not read.

## Compliance
The P2.20 tests hold this record: the profile module's parse and record tests (only sent fields change, a broken
stored record is refused, a profile needs a display name, links are http(s) and bounded), `POST /profile`'s tests (the
session's own DID, CSRF refusal, a repeated field refused, conflict on a swapped record, Settings return), the page
tests (no script before hydration, unsafe links never linked, an unreadable profile offers no editing), the block
reader's tests (unknown blocks dropped, unsafe links refused, bounds held) and the island budget test, which fails if
any chunk outside `apps/web/src/editor/` goes over the island budget or that folder goes over its own cap, and an e2e test that the editor page runs with Trusted Types
and no policy. Acceptance is Alex's line on the pull request
that adds this record; ADR 0001 notes the proposal at its end and gains the acceptance paragraph when he accepts. The
status line stays Proposed until then.
