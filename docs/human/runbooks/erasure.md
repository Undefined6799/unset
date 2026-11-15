# Erasing a person (manual, until Phase 3)

When a member asks to be erased, or an account must go, an owner runs one database function by hand. It removes
everything the app's database holds about one DID (`core.erase_did`, P3.07k, migration 0022). Nothing calls it
automatically yet: the indexer, the admin action and the member's own request get it in Phases 3 to 5.

What it removes: the app account row, every browser session, the OAuth token set, one-time tokens bound to the person,
and the security-lane audit rows that name them as subject or actor. It writes one audit record, `account.erased`, with
the reason and no DID.

What it does not remove, and who does:
- **The PDS account** (repository, blobs, email, password). Delete it in the PDS yourself (step 4).
- **Moderation audit rows** about the person. They stay until their retention class ends (admin design 8).
- **Files in the object store.** The app stores none per person today. When it does, that part of erasure is gated on
  the store's forced vacuum (ADR 0041 Decision 7).
- **Backups.** They age out on the backup schedule.

## Steps
1. Confirm the request and the DID. Resolve the handle to its DID in both directions; never erase by handle.
2. Open `psql` on the `unset` database as `migrator` (the credentials the `migrate` service uses). No other role may
   run the function.
3. Run it with one of the reasons `user_request`, `account_deleted`, `moderator_foreign`, `legal_hold_closed`:
   `SELECT core.erase_did('did:plc:…', 'user_request');`
   It answers with `"outcome": "erased"` and the number of rows removed per table. Any error removes nothing. A second
   run is safe and answers with zeros (it writes a second audit record).
4. Delete the account in the PDS. Do this after step 3, so a session cannot recreate rows in between; if the person
   signs in again before the PDS account is gone, run step 3 again.
5. Record the request, the date and the reason where privacy requests are tracked. Do not record the DID in the
   repository, in a PR or in a log.

## If it fails
- `erase_bad_input`: the reason is not on the list, or the DID is empty.
- `permission denied for schema core`: the session is not `migrator`.
- Anything else: nothing was removed. Keep the error text without the DID and ask before retrying.
