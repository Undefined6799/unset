# 0084 — The chat account follows the Unset account: suspended means locked, deleted means deactivated and erased

Status: Accepted by Alex 2026-11-21 00:55Z: asked in the project chat whether he accepts this record as it stands, he
answered "yes" (P6.00, minimal chat build, 2026-11-21). The rule is Alex's of 2026-11-21 in the chat planning thread,
as the build plan records it: there is no separate chat suspension or chat deletion, and whatever happens to the Unset
account happens to its chat account. The MAS calls that carry it out are accepted by that answer.

## Context
PLAN §5.6 (Alex, 2026-10-03, step-book questions 46 to 49) already says chat follows the account: suspension locks
chat, erasure deletes the chat account, and a freeze, a takedown or erasure end every chat session. The step book's
P6.04a carries this out through `chat-admin` verbs that list and finish sessions. ADR 0067 sets what an Unset account
goes through: deactivation, deletion after 30 days, takedown.

MAS 1.26.0's admin API (`docs/api/spec.json`, read 2026-11-21) has `POST /api/admin/v1/users/{id}/lock`, `.../unlock`,
`.../deactivate` and `.../reactivate`. Deactivate takes `skip_erase`, default false: "Whether to skip requesting the
homeserver to GDPR-erase the user upon deactivation." Lock and deactivate are independent. Synapse's manual says an
erased user's messages "will still be visible by anyone that was in the room when these messages were sent, but
hidden from users joining the room afterwards" (Synapse 1.162.0, `docs/admin_api/user_admin_api.md`, line 364).

## Decision
1. **When the Unset account stops being active** (deactivated, taken down or suspended; ADR 0067 rules 1, 2 and 5),
   `chat-admin` calls `lock`. Sessions are kept, not ended, so no key is lost. `web` signs no new tickets for the
   member and hides their Message button.
2. **When it is active again**, `chat-admin` calls `unlock`. The same browsers work again with their keys and history;
   no new sign-in or recovery key is needed.
3. **When it is deleted for good** (ADR 0067 rules 2 and 3, the point where `eraseDid` runs), `chat-admin` calls
   `deactivate` with no body, so Synapse is asked to erase the account. That ends every session and makes the account
   leave every conversation. The same job deletes our mapping row, the browser list, the lock keys and the count. A
   locked account is deactivated directly, with no unlock first.
4. **These are queued jobs from the same place that changes the Unset account** (`eraseDid`'s chat hook for deletion),
   retried until they succeed; each call is safe to repeat. Chat cannot be forgotten, and a chat outage never fails
   the account change.
5. **There is no way back from deletion.** `chat-admin` offers no reactivate command. The chat name stays reserved in
   MAS, so nobody can take it later.
6. **A member cannot rename or deactivate the chat account on their own**: MAS `account.displayname_change_allowed`
   and `account.account_deactivation_allowed` are false.
7. **A grant revoked at the PDS** (`auth_dead`, P2.11a) ends every chat session of the account and deletes its lock
   keys, as PLAN §5.6 already says.

## Alternatives
- **Separate chat suspension and deletion controls.** More states to keep in step; declined by Alex on 2026-11-21.
- **End every chat session on suspension**, as PLAN §5.6 said for a freeze or takedown. Keys not yet backed up would be
  lost, and an un-suspended member would sign in and unlock again. Declined for lock.
- **Deactivate with `skip_erase`.** Leaves the account's profile and data on the server after deletion, against
  erasure. Rejected.

## Consequences
- Supersedes PLAN §5.6's "a freeze, a takedown or erasure end every chat session" for a freeze or takedown, which now
  lock; erasure still ends every session. Step book P6.04a shrinks to these three calls.
- The other person keeps their copy of the conversation, the deleted member's messages included; the server keeps only
  encrypted copies, and only while someone who was there stays in the conversation. During a suspension the other
  person can still send; their messages wait. Whether to block sending to a suspended member is a later product choice.
- Settled in build step 11, not yet verified: how fast a lock stops an open chat page; what Synapse's erase removes
  beyond sessions, rooms and the erased mark (display name, vault, key backup; if any stays, `chat-admin` adds the
  matching delete); what name the other person sees on the deleted member's old messages.
- Changing a display name when a handle changes has no MAS admin call in 1.26.0 and is not in the minimal version.

## Compliance
- Erasure registry: the mapping row, the browser list, the lock keys and the count are listed with `eraseDid`, and the
  chat account's erasure is the `deactivate` call (GDPR Art. 17, PIPEDA principle 4.5).
- Build step 11: tests that suspend locks without ending sessions, unsuspend restores the same browser, delete
  deactivates and erases and removes our rows, a retried job is harmless, and no route reactivates.

## Follow-up

2026-11-21: MAS pinned at 1.29.0 (Alex, 2026-11-21, 'use the latest version'), re-checked: `docs/api/spec.json` and `crates/handlers/src/admin/v1/users/` (`add.rs`, `lock.rs`, `unlock.rs`) are identical to 1.26.0 and `deactivate.rs` changed only in its tests, so lock, unlock, deactivate and the username rule hold as written; 1.29.0 still has no admin call that changes a display name. Read from the v1.26.0 and v1.29.0 source trees on 2026-11-21; no live run of 1.29.0 was possible here (the image pull and the release binary download were both refused), so the 1.29.0 behaviour is unverified until the image test runs it.
