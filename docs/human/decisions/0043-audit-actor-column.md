# 0043 — The audit side row names its actor in a DID column

Status: Accepted by Alex, 2026-11-15 23:25:58Z, against 90ac137 ("accept ADR 0043 at 90ac137", typed in reply to
the coordinator's project-chat post, on the head it had verified). From here the record changes only to be marked
superseded. Alex approved writing this record and its migration on 2026-11-15 20:52:18Z ("do what is recomended",
on the decision "Audit actor column, added now with a new ADR").

## Context
Each audit event is two rows (migrations 0008 to 0010; plan §5.7; admin design §7.1). `audit.chain` holds no
personal data and carries the hash chain. `audit.event_body` is the side row: the body text that was MACed, its key,
and one DID column, `subject`, the event's target.

`audit.append` also takes the actor (`p_actor_did`), but until now it wrote the actor only inside `body_text`.
Erasure finds a person's rows by DID columns, not by reading bodies (`docs/human/db/erasure.md`: "A DID inside a
JSONB body is invisible to the catalog"), and the planned `audit.erase_subject` (book P1.15a) matches `subject` only.

The whole-project review of 2026-11-15 (security finding 3) showed the gap. For `age_gate.blocked`, the only action
written so far, actor and subject are the same person. For `report.submitted` the actor is the reporter and the
subject is the reported account. When a reporter asks for erasure, nothing finds their rows.

The tables are append-only: a trigger refuses every UPDATE, even for the owner. A column added after rows exist can
never be filled for those rows. Today the only rows are age-gate rows on staging, so the column costs one small
migration now and cannot be done properly later.

What may hold a DID: logs may not (rule SE-7). The audit store may: it is the record of who did what to whom, kept
for a stated period per retention class (plan §6) and for a stated purpose (accountability for moderation and
security events), with erasure and export through the DID-column registry. The actor's DID was already stored, in
the body. This record changes where it can be found, not whether it is kept.

## Decision
1. `audit.event_body` gains `actor types.did`, nullable (migration 0016). `audit.append` fills it from
   `p_actor_did`. Its signature does not change, so `appendAudit` and its callers do not change.
2. **What an actor is.** The person who caused the event, as the writing process asserts it from a verified session.
   The database cannot verify it, as 0008 already says of `p_actor_did`.
   - A member: actions with rate class `user_triggered` (written by `web`). The actor is the signed-in member.
   - An admin: actions with rate class `operator` (written by `admin`). The actor is the roster member, and the body
     also carries their credential id.
   - System work: actions with rate class `system` (the indexer, review, scheduled jobs). No person caused it, so
     the actor is null and `chain.writer`, the database role, names the process. A system action that does act for
     a person may name them (`account.erased` written by `admin`).
   There is no actor-kind column: the action's rate class and the writer role already say which of the three it is.
3. **A person's event must name the person.** `audit.append` refuses a `user_triggered` or `operator` action with a
   null actor (`audit_bad_input`, UA003). A writer that forgets the actor fails its first test, not an erasure
   request two years later.
4. **Where it is stored.** In the side row only, beside `subject`. Never in `audit.chain`, never in a log line. The
   row hash and the body MAC are unchanged, because `body_text` has always included the actor; the chain's test
   vector stays as it is.
5. **Erasure.** The column has its own row in `erasure-registry.json` (`audit_redact`, as `subject`). Erasing a
   person removes the side rows of lane `sec` where they are the subject **or the actor**; lane `mod` rows stay
   until their retention class ends, for an admin actor as for a moderated target (book P1.15a, admin design §8).
   Removing a side row removes both DIDs, the body and the key, so a report row goes when either the reporter or the
   reported account is erased. P1.15a builds the function to this rule.
6. **Existing rows.** They keep a null actor. They cannot be updated, and switching the append-only trigger off to
   back-fill them is the tampering the chain exists to expose. Every row written before 0016 is `age_gate.blocked`
   (the only call to `appendAudit` is `interfaces/http/account.ts`), where the actor is the subject, so erasure by
   subject already reaches them. The rule for readers: a null actor on a row older than 0016 means "not recorded in
   the column"; the body still has it.

## Alternatives
- **Leave the actor in the body and have erasure read bodies.** Rejected: it needs a scan and a JSON parse of every
  body, the registry and its catalog test cannot see it, and a redacted body can no longer be read at all.
- **Add the column later, with the first report writer.** Rejected: any step that writes an audit row first makes
  the old rows permanent, and nothing in the code would stop that order.
- **A separate actor table keyed by (lane, seq).** Rejected: a second side row to delete in step with the first,
  for one nullable column.
- **Put the actor in `audit.chain`.** Rejected: the chain holds no personal data so it can outlive erasure.
- **Allow a null actor everywhere and trust writers.** Rejected: a silent miss is exactly the failure found.

## Consequences
- Adding a column whose type is a domain with a check rewrites `audit.event_body` under an exclusive lock
  (PostgreSQL 18, ALTER TABLE, Notes). The table is tiny today. The rewrite is not an UPDATE, so the trigger does
  not fire and stored bytes are kept; `rows_before_actor_column_survive` proves old rows still match their MAC and
  the next row links to them.
- Decision 3 is stricter than before: a `web` or `admin` writer of a person's action without `actorDid` now fails.
  The one writer today passes it.
- The check lives in SQL only. `appendAudit` does not repeat it, because the TS action list mirrors lanes, not rate
  classes; a refusal there costs one round trip.
- `report.submitted` is in lane `sec`. So a reporter's erasure removes the side row of their report about someone
  else, and the reported account's erasure removes it too. What remains is the chain entry: time, action, writer
  and hashes, with no body and no DID. If moderation needs a report for longer than that, the report's case record
  must hold it, under its own retention rule; the audit row is not that record.
- No index on `actor`. P1.15a adds one with its query if erasure needs it.
- The audit export (P4.26) can find a person's rows as actor as well as subject through the same registry.

## Compliance
`tests/integration/postgres/audit.test.ts`: `append_as_admin` and `member_event_fills_actor_column` (the column is
filled), `system_event_has_no_actor`, `person_event_needs_actor`, `rows_before_actor_column_survive`,
`registry_rows`. `tests/integration/postgres/did-columns.test.ts` fails while the column has no registry row.
