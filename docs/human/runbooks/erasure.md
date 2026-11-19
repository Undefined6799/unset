# Erasing a person (manual, until Phase 3)

When a member asks to be erased, or an account must go, an owner runs one database function by hand. It removes
everything the app's database holds about one DID (`core.erase_did`, P3.07k, migration 0022). Nothing calls it
automatically yet: the indexer, the admin action and the member's own request get it in Phases 3 to 5.

What it removes: the app account row, every browser session, the OAuth token set, one-time tokens bound to the person,
and the security-lane audit rows that name them as subject or actor. It writes one audit record, `account.erased`, with
the reason and no DID. That is not every row that ever named the person; the limits are listed next.

What it does not remove, and who does:
- **The PDS account** (repository, blobs, email, password). Delete it in the PDS yourself (step 6).
- **Moderation audit rows** about the person. They keep the DID by design until their retention class ends (admin
  design 8).
- **A sign-in in progress.** Its state row (`app.oauth_state`) holds no DID column; it leaves with the hourly sweep,
  and a sign-in that completes after the run creates new rows. That is why step 6 says to run the function again.
- **Files in the object store.** The app stores none per person today. When it does, that part of erasure is gated on
  the store's forced vacuum (ADR 0041 Decision 7).
- **Indexed network data and legal holds.** Neither exists yet. When the indexer stores records (Phase 3) and holds
  exist (Phase 4), their steps extend the function; until then it knows nothing about them.
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
   It answers with `"outcome": "erased"` and the number of rows removed per table. Any error removes nothing. A second
   run is safe and answers with zeros (it writes a second audit record).
6. Delete the account in the PDS. Do this after step 5, so a session cannot recreate rows in between; if the person
   signs in again before the PDS account is gone, or was part-way through a sign-in, run step 5 again.
7. If the handle is one of ours (under `unset.name`, or `staging.unset.name` on staging), an owner logged in to deSEC
   removes its `_atproto.<name>` TXT record by hand, until the ADR 0063 writer does it (ADR 0067). Resolvers may
   serve the old record until its TTL runs out; the indexer's check on our PDS covers that time. Do the same when an
   account is taken down; write it again if the takedown is reversed. Do not tombstone the DID unless the person
   explicitly asked for their identity to be ended (ADR 0067 decision 4).
8. Add the name, lower-cased, to the burned-name file: a file of its own outside the repository, holding bare names
   only, with no DID, no date and no link to the privacy request records, until P3.08n builds the list. Before
   writing any new TXT record by hand, check the name is not there: a used name is never issued again.
9. Record the request, the date and the reason where privacy requests are tracked. Do not record the DID in the
   repository, in a PR or in a log. Close `psql` when done.

## If it fails
- `erase_bad_input`: the reason is not on the list, or the DID is empty.
- `permission denied for schema core`: the session is not `migrator`.
- `audit_writer_denied`: you logged in as another role and used `SET ROLE`.
- `erase_uncovered_did_column`: a newer table holds DIDs and the function was not extended. Nothing was removed;
  this needs a migration, so stop and report it.
- Anything else: nothing was removed. Keep the error text without the DID and ask before retrying.
