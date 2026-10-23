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
4. **The README format is open.** Staging runs a small markdown subset (headings, paragraphs, lists, quotes, code,
   rules, bold, italic, inline code and http(s) links, plus `:::` for a column and `---` for a row), parsed by
   `shared/ui/components/Markdown` into React elements. Alex is weighing a BlockNote-style block editor instead (card
   of 2026-10-23 04:33Z); his pick decides the stored format, and this point is amended before acceptance. Either way:
   raw HTML is never rendered, links go through `safeHref` with `rel="nofollow ugc noopener noreferrer"`, no image is
   loaded until uploads go through the media proxy, and visitors' pages are rendered by our own server-side code.
5. **Script only for the owner.** The owner's page hydrates one island, `profile-editor`, served from our own origin
   under the existing CSP (`script-src 'self'`); it edits the README in place, keeps a draft with undo and redo, and
   posts to `POST /profile` with the literal path. A visitor's page (the public page, a later step) renders the same
   markup with no script. Before hydration the owner's page is exactly the static page.
6. **The side column is edited in Settings › Profile**, a plain form that posts with no script to `POST /profile` and
   returns there. Handle, verified tag and DID are never editable; they come from the session and the two-way handle
   check (P2.02). Links are up to 12 http(s) addresses, a scheme-less one gaining `https://`, each shown through
   `safeHref` with `rel="nofollow ugc noopener noreferrer me"`.
7. **One save route.** `POST /profile` takes a form body only (400 KiB cap), runs the session and CSRF gate, takes the
   DID from the session (never the request), refuses a repeated field, and answers 303 to the member's page or to
   Settings › Profile (the only other place it returns to).

## Alternatives
- **Keep the profile inside `domains/identity`.** Fewer folders, but identity would mix session security with page
  content that changes for different reasons. Rejected by Alex 02:59Z.
- **Store profiles in our Postgres.** Faster reads and search, but a second copy of member data with its own erasure,
  export and retention, and a profile that no longer travels with the account. Rejected: the PDS is the source of
  truth, and a later index can be rebuilt from it (DA-1).
- **A server-side draft table.** Survives a closed tab, but stores unpublished personal text with its own lawful
  basis, erasure and export. Rejected for now; the tab keeps the draft.
- **Edit everything in place on the page.** Tried on staging the same night; Alex moved the side column to Settings
  at 04:29Z.

## Consequences
- New folder `domains/profile` (CLAUDE.md "Where does this go" gains the row with the first code PR).
- `sh.unset.profile` gains `readme` and `links` (P2.20q).
- Two new shared/ui components, Markdown and Profile, need Alex's approval on the design sheet before their PRs merge.
- A profile page needs its PDS to answer; when it does not, the page says so and offers no editing, so a save can
  never blank a record it could not read.

## Compliance
The P2.20 tests hold this record: the profile module's parse and record tests (only sent fields change, a broken
stored record is refused, a profile needs a display name, links are http(s) and bounded), `POST /profile`'s tests (the
session's own DID, CSRF refusal, a repeated field refused, conflict on a swapped record, Settings return), the page
tests (no script before hydration, unsafe links never linked, an unreadable profile offers no editing) and the
editor's tests (only the README is posted, to the literal `/profile`). Acceptance is Alex's line on the pull request
that adds this record; ADR 0001 notes the proposal at its end and gains the acceptance paragraph when he accepts. The
status line stays Proposed until then.
