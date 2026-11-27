# Erasing a person

When a member asks to be erased, or an account must go, an owner runs one database function by hand. The current
`core.erase_did` is `infrastructure/postgres/migrations/0042_idx_page.sql`. The indexer also calls it, through
`idx.erase_deleted_account` (migration 0029), when a confirm pass finds the account gone on our PDS (`not_found`,
or inactive with status `deleted`; `infrastructure/postgres/accountStore.ts`): the reason is fixed to `account_deleted`,
the index row must already be hidden as deleted (`pds_status` `deleted` and not `pds_active`), and at most 20 of those
erasures run in any hour. Past that cap `idx.erase_deleted_account` returns NULL and erases nothing, and the job tries
again an hour later. A member's own request does not call the function; this runbook is that path.

What the function deletes, in this order. The five cascade tables have no statement of their own: they go when
`idx.account` is deleted (`ON DELETE CASCADE` in migrations 0025 and 0042) and are not named in `counts`. It
then writes one audit record, `account.erased`, with the reason and no DID, and upserts `core.erased_did` with a keyed
HMAC of the DID, never the DID (migration 0028). That is not every row that ever named the person; the limits are
listed next.

| Table | How it goes |
| --- | --- |
| `app.single_use` | `DELETE` where `bind_did` is this DID |
| `app.session` | `app.end_sessions_for_did(did, 'deleted')` (migration 0014) |
| `app.oauth_session` | the same call; reason `deleted` also deletes the token set |
| `app.invite` | `DELETE` where `inviter_did` is this DID |
| `app.discoverability` | `DELETE` where `did` is this DID |
| `app.image_use` | `DELETE` of uses of this DID's images |
| `app.image_record` | `DELETE` where `did` is this DID |
| `app.image` | `DELETE` where `did` is this DID |
| `app.image_upload` | `DELETE` where `did` is this DID |
| `app.notification` | `DELETE` where `did` is this DID |
| `app.sign_in` | `DELETE` where `did` is this DID |
| `app.account` | `DELETE` where `did` is this DID |
| `idx.track_request` | `DELETE` where `did` is this DID |
| `idx.dead_letter` | `DELETE` where `did` is this DID |
| `idx.account` | `DELETE` where `did` is this DID |
| `idx.account_job` | cascade from `idx.account` |
| `idx.profile` | cascade from `idx.account` |
| `idx.page` | cascade from `idx.account` |
| `idx.section` | cascade from `idx.account` |
| `idx.record_blob` | cascade from `idx.account` |
| `mod.account_state` | `DELETE` where `did` is this DID |
| `audit.event_body` | `audit.erase_subject`: security-lane rows (`lane = 'sec'`) whose subject or actor is this DID |

What it does not remove, and who does:
- **The PDS account** (repository, blobs, email, password). Delete it in the PDS yourself (step 6).
- **Moderation audit rows** about the person. They keep the DID by design until their retention class ends (admin
  design 8). `audit.erase_subject` never deletes `lane = 'mod'`.
- **A sign-in in progress.** Its state row (`app.oauth_state`) holds no DID column; it leaves with the hourly sweep,
  and a sign-in that completes after the run creates new rows. That is why step 6 says to run the function again.
- **Files in the object store.** The function deletes database rows only. `POST /images` stores a member's pictures
  at `drafts/<did>/i/<uuid>/<version file>` (`interfaces/web/src/routes/images/+server.ts` prefixes `drafts/<did>/i/`;
  `upload.server.ts` writes `<uuid>/<name>.<format>`). After those `app.image` rows are gone, the web job
  `sweep.image_orphan` removes the orphaned objects on a later run (`interfaces/web/src/lib/server/compose.ts` calls
  `sweepOrphanImages` in `interfaces/web/src/lib/server/image-orphans.ts`). It runs when web starts and then every
  hour. It lists `drafts/` and deletes each folder `drafts/<did>/i/<uuid>/` that no image row names, for every such
  orphan, not only the DID just erased. A key that is not that shape is left. `sweepAllowed`
  (`domains/content/images/library.ts`) lets one run delete at most the greater of 500 and a tenth of the live
  `app.image` rows, rounded down. More orphans make it throw and delete none of them. The failure is logged as job
  `sweep.image_orphan` with the error's class name only, and the next hour tries the same set again. That sweep
  is not the hand step. On the SeaweedFS dev, local and staging stacks, step 7 follows the object-store runbook
  (`docs/human/runbooks/object-store.md`): delete the member's folders, including `drafts/<did>`, then purge the
  filer's metadata log and force the vacuum. A delete only tombstones the bytes until that vacuum (ADR 0041
  Decision 7; `objects_erase_removes_bytes` in `deployment/images/objects-erasure.image.test.ts`).
- **Legal holds.** None. The migrations through `0043_app_notification_seen_at.sql` define no hold table, and the
  function does not skip a row for one. Every accepted reason, including `legal_hold_closed`, runs the same deletes
  and records outcome `erased`.
- **Backups.** They age out on the backup schedule.
- **Copies of the public page.** `/@handle` reads as not found as soon as the account is erased, taken down,
  delisted or deactivated, but a visitor's browser or a cache may keep the last copy for up to 60 seconds
  (`Cache-Control: public, max-age=60`, P3.12s). Nothing purges it; wait the minute.

The function refuses to run (`erase_uncovered_did_column`) while the database has a column of the DID or AT-URI type
it has no statement for, so it never reports a person erased while a newer table still names them. That check goes by
column type only: a DID kept in a plain text column is invisible to it. The other half is the CI check on column names
and the coverage test, which run before merge.

## Steps
1. Confirm the request and the DID. Resolve the handle to its DID in both directions; never erase by handle.
2. When the person asked us to delete their account (not a takedown or a PDS deletion they made themselves),
   deactivate the account in the PDS and note the date with the request. Run the steps below 30 days later, and only
   if the account is still deactivated; if the person reactivated it, the request is withdrawn (ADR 0067 rule 2;
   P5.08b automates this).
3. Open `psql` on the `unset` database, logged in as `migrator` itself (the credentials the `migrate` service uses).
   No other role may run the function, and a superuser who switches with `SET ROLE migrator` is refused at the audit
   step: the audit records the login role, and only `migrator` may write this record.
4. Keep the DID out of the shell history, the `psql` history and the server log (SE-7). Type these three lines; the
   second asks for the DID, so paste it at the prompt and never on a command line:
   `\set HISTFILE /dev/null`
   `\prompt 'DID: ' did`
   `SHOW log_statement; SHOW log_parameter_max_length_on_error;`
   The last line must answer `none` and `0` (the defaults). If it does not, stop: the server would log the DID.
5. Run it with one of the reasons `user_request`, `account_deleted`, `moderator_foreign`, `legal_hold_closed`:
   `SELECT core.erase_did($1, $2) \bind :did user_request \g`
   The DID travels as a bound parameter, so the statement text the server logs when a call fails holds only `$1`.
   Never write the DID into the statement as a literal: a failed call would copy the whole statement, DID included,
   into the server log, and `migrator` may not turn that logging off for its session.
   It answers with `"outcome": "erased"` and a `counts` object for each table deleted by its own statement. The five
   cascade children are not in that object. Any error removes nothing. A second run is safe and answers with zeros
   (it writes a second audit record).
6. Delete the account in the PDS. Do this after step 5, so a session cannot recreate rows in between; if the person
   signs in again before the PDS account is gone, or was part-way through a sign-in, run step 5 again.
7. On a SeaweedFS dev, local or staging stack, follow the object-store runbook
   (`docs/human/runbooks/object-store.md`) for this batch. Delete the member's folders, including `drafts/<did>`,
   then purge the filer's metadata log and force the vacuum. Do it even when the orphan sweep has already run or
   has refused: that sweep only tombstones image-shaped folders, and the bytes stay in the volume until the vacuum.
8. If the handle is one of ours (under `unset.name`, or `staging.unset.name` on staging), an owner logged in to deSEC
   removes its `_atproto.<name>` TXT record by hand, until the ADR 0063 writer does it (ADR 0067). Resolvers may
   serve the old record until its TTL runs out; the indexer's check on our PDS covers that time. Do the same when an
   account is taken down; write it again if the takedown is reversed. Do not tombstone the DID unless the person
   explicitly asked for their identity to be ended (ADR 0067 decision 4).
9. Add the name, lower-cased, to the burned-name file: a file of its own outside the repository, holding bare names
   only, with no DID, no date and no link to the privacy request records, until P3.08n builds the list. Before
   writing any new TXT record by hand, check the name is not there: a used name is never issued again.
10. Record the request, the date and the reason where privacy requests are tracked. Do not record the DID in the
   repository, in a PR or in a log. Close `psql` when done.

## If it fails
- `erase_bad_input`: the reason is not on the list, or the DID is empty.
- `permission denied for schema core`: the session is not `migrator`.
- `audit_writer_denied`: you logged in as another role and used `SET ROLE`.
- `erase_uncovered_did_column`: a newer table holds DIDs and the function was not extended. Nothing was removed;
  this needs a migration, so stop and report it.
- Anything else: nothing was removed. Keep the error text without the DID and ask before retrying.
