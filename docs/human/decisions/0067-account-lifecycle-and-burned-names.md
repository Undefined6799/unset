# 0067 — Deactivation, deletion, takedown and moving away follow atproto's account model; every hosted name is burned

Status: Accepted by Alex, 2026-11-20 00:33Z, against 14f438b (his line "Merge 1814 at 14f438b", typed in the project
chat after the coordinator had reviewed that head and CI was green). This status paragraph, the index row and the ADR
0001 acceptance line were added afterwards in #1808. Step P1.21e (docs only). Alex, 2026-11-19 22:40Z: no PLC tombstone
by default; 30 days before a deletion is final; every name a member ever held is burned; the privacy notice says the PLC
log is permanent; a member who moves to another PDS may keep their name until they change it.

## Context
A member's DID and handle outlive their account in ways the protocol fixes and we do not. The findings, with every
source, are in `/mnt/project-files/reviews/2026-11-19-atproto-deletion/findings.md`. What they rest on (PDS sources
are bluesky-social/atproto at fb16c8e, `@atproto/pds` 0.5.51, the revision `deployment/pds/source.lock.json` pins,
paths under `packages/pds/src/`; specs are bluesky-social/atproto-website at c52d639, the source of atproto.com):

- **Identity and account are separate on purpose.** "Identity metadata (DID documents and handle status), and the
  account hosting status itself, are distinct from hosted content" (https://atproto.com/specs/account). Deletion,
  deactivation and takedown change the account status (`deleted`, `deactivated`, `takendown`, `suspended`) only.
- **The stock PDS never touches PLC on any of them.** `deleteAccount` removes the account rows, emits one `#account`
  event with status `deleted`, and destroys the repo (`api/com/atproto/server/deleteAccount.ts:76-80`,
  `account-manager/helpers/account.ts:181-205`, `sequencer/sequencer.ts:226-236`). It tombstones a DID only when
  account creation fails (`api/com/atproto/server/createAccount.ts:60-63,134-135`). Bluesky's maintainer: PDS account
  deletion "does not result in the identity being deleted by default"
  (https://github.com/bluesky-social/atproto/discussions/2503).
- **A deleted handle is free at once on the stock PDS.** The `actor` row that held it is deleted
  (`account-manager/helpers/account.ts:202-204`); the availability check reads only existing rows
  (`account-manager/account-manager.ts:397-408`). Takedown and deactivation keep the row, so the name stays held.
- **`deleteAfter` is stored, never acted on.** `deactivateAccount` saves it
  (`api/com/atproto/server/deactivateAccount.ts:46`); nothing in the PDS reads it to delete.
- **A member can delete on the PDS directly**, with their password and an emailed code
  (`api/com/atproto/server/deleteAccount.ts:44-80`). That deletion is immediate.
- **A tombstone does not erase the name.** "The full history of DID operations and updates, including timestamps, is
  permanently publicly accessible ... PII encoded in `alsoKnownAs` URIs will be publicly visible even after DID
  deactivation, and can not be redacted or purged" (https://web.plc.directory/spec/v0.1/did-plc, Privacy and Security
  Concerns). A tombstone is final once its 72-hour recovery window passes (same spec, Key Rotation & Account Recovery).
  The account spec expects a deleted account may "reactivate on the same or another host".
- **Handle validity is the two-way check alone** (https://atproto.com/specs/handle); the owner of the handle's domain
  keeps the proof truthful. bsky.social answers `/.well-known/atproto-did` from its account table (`well-known.ts:20`
  uses the lookup that skips deactivated and taken-down accounts), so its handles stop resolving with the account.
  Ours resolve from `_atproto` TXT records at deSEC (ADR 0064), which know nothing of the account, so whoever writes
  them must remove them (ADR 0063 decision 3 already says so for deletion and takedown).
- **PLC cannot be searched by handle.** The directory serves a DID's document and log, and the full export; it has no
  handle index (https://web.plc.directory/spec/v0.1/did-plc, Audit Logs). Reading a DID's log tells us the names that
  DID held, not whether a name was ever held by anyone. "Never reissue" therefore needs our own list keyed by name.
- **Why burn rather than release.** We own the DNS for every hosted name, so a later claimant cannot prove they are
  the earlier holder; reissuing a name hands an old identity's reputation and mentions to a stranger. A member who
  wants a name they can prove and carry uses their own domain. Bluesky reserves a bsky.social handle after it is
  changed away from (reported 2024-12-20, Engadget; Bluesky's own text not found, so unverified).

## Decision
Each rule is marked **protocol** (the protocol or the stock PDS does it), **practice** (what bsky.social does in
effect) or **ours** (our policy). Irreversible steps are marked **final**.

1. **Deactivate** (the member pauses, on the PDS or through us). The PDS sets the status and emits `#account`
   (protocol). The DID is not touched (protocol). The DNS record stays, so the handle stays valid and they can return
   (protocol model, ours to keep the record). The indexer hides the account (protocol; `idx.visible_account`). The
   name stays held, since the PDS row stays (protocol).
2. **Delete, asked of us.** We deactivate at once (open point for Alex: his decision set the 30 days, not whether the
   account is hidden during them; hiding is the reading taken here) and set `deleteAfter` to 30 days later (ours; the
   field is protocol, its meaning is ours). Reactivating in that time withdraws the request. After 30 days,
   `pds-admin` deletes the account (ours to run; the PDS has no sweeper), which removes the repo and emits `deleted`
   (protocol, **final** for the repo). Then the DNS record is removed (practice), `eraseDid` runs (ours; PIPEDA), and
   the name joins the burned list (ours). Backups then age out on their own stated period (30 days in the privacy
   notice), so data can persist up to about 60 days after the request.
3. **Delete, done by the member on the PDS.** Immediate; we cannot add a grace period without changing the PDS, and
   the PDS already asks for the password and an emailed code. On the `deleted` event the same three things follow: DNS
   record removed, `eraseDid` (the indexer already does this, P3.06e), name burned.
4. **No PLC tombstone by default** (protocol default, practice). The DID stays as the PDS left it. A tombstone is done
   only when a member explicitly asks for their identity to be ended, after the deletion is final, with a warning that
   it is **final** after 72 hours and does not remove their name from the public log (ours).
5. **Takedown.** The PDS sets the status and emits `takendown` (protocol). The DNS record is removed (ours, as ADR 0063
   decision 3 says; reversed by writing it again). The name stays held while the account exists (protocol); if the
   account is later deleted, rule 2's last steps apply.
6. **Burned names.** Every hosted name a member held is burned and never issued again: at deletion, and when a
   member's name changes away from one of ours (ours). The list holds a keyed HMAC-SHA256 of the lower-cased name, no
   DID and no date, the key in the same database, like the erasure tombstone (P3.07s). A plain
   hash of a short name could be reversed by guessing; the key stops that for anyone without the database. It is
   checked where a hosted name is claimed (our claim form, for a clear refusal) and where its DNS record is written
   (the ADR 0063 writer, which refuses a burned name), so a name taken directly on the PDS still never verifies. It is
   kept while the service runs and is not part of an erasure, because erasing it would let the name be reissued.
   While the account exists, the name it holds is recorded by DID outside the index, because the indexer's re-check
   clears the index's handle as soon as an account is inactive, which would lose the name during the 30 days; erasure
   turns that record into the hash.
7. **Moving away** (not offered today). A member who moves keeps their hosted name until they change it (ours). We
   keep its DNS record, so the new PDS accepts it like any domain handle; we alone serve that proof, so we alone can
   revoke it by removing the record. When their DID document stops claiming the name, the record is removed and the
   name burned. The old account is deactivated, then deleted under rule 2, never within 72 hours of their PLC update,
   so our PDS can still help recover the identity (https://atproto.com/guides/account-migration). The indexer's
   "document names our PDS" condition (`interfaces/indexer/handles.ts`) must then allow such DIDs.
8. **The indexer's hosted-handle check stays** as the backstop for a stale or failed DNS write; this decision does not
   change it.
9. **The privacy notice says** that the DID and the history of its handles stay in the public PLC directory forever,
   and that a used name is never issued again.

## Not built yet, and what happens until then
- The DNS writer (ADR 0063, Proposed): until it exists, an owner removes the `_atproto.<name>` record at deSEC by hand
  on deletion or takedown (`docs/human/runbooks/erasure.md`).
- The burned-name list (P3.08n): until it exists, burned names are kept as bare lower-cased names in a file of
  their own outside the repository, with no DID, no date and no link to the privacy request records; the owner who
  writes TXT records by hand checks a new name against it. The privacy notice says so.
- The 30-day deletion (P5.08b): until then, deletion is the manual runbook.
- The tombstone on request (P5.08c's runbook) and moving away: not built, not offered.

## Consequences
- This record covers members' accounts. It does not change ADR 0001 decision 24 (the prototype `0x40.space`
  accounts, deactivated and tombstoned) or P2-A3 and the P2.25 test-track wipe (test DIDs deleted and tombstoned
  before launch); those identities were never members' and their tombstones stay.
- The book's P5.08b waits 30 days, not 7, and signs a tombstone only on request; P5.08c's runbook says the same.
- A burned name is personal data we keep after erasure; the RoPA and the privacy notice list it.
- Members cannot get a hosted name back after deleting; they keep their DID and may come back with a new name.
- Threats (SE-1) are for P3.08n: a leaked key lets a backup reader test whether a guessed name was used, which the PLC
  log already shows for any DID they know.

## Compliance
Nothing is built by this record, so nothing is tested yet. `scripts/docs/compliance.test.ts` checks the new RoPA row's
lawful basis and its `step:P3.08n` pointer; P3.08n's tests (a burned name is refused at claim and at write, erasure
keeps the list) and P5.08b's (30 days before `deleteAccount`, no tombstone without a request) prove the rules when they
land. The privacy notice states the permanent PLC history and the burned names (PIPEDA principle 4.8, openness).

## Alternatives
- Tombstone every deleted DID: rejected. It removes nothing from the public log, is final, and takes the identity
  from the member; neither the stock PDS nor Bluesky does it.
- Release names after a quiet period: rejected for the impersonation risk above.
- Find used names by reading PLC: not possible without scanning the whole export; rejected.
- Store the burned name in plain text: rejected; the keyed hash costs nothing more.
