-- phase: expand
-- A browser session cannot outlive its DID's token set (P2.03t; ADR 0049). Until now that rule lived only in the
-- session store's read (infrastructure/session/store.ts `lookup`, `has_token_set`): a session row stayed in the table
-- after its token set was deleted, read as signed out, and became valid again when the member's next sign-in stored
-- a new set. Any path that deleted the set but failed to end the sessions left such rows: sign out everywhere, the
-- under-16 block and a dead grant (Codex on #1566, 2026-11-15). A copied cookie the member had just ended would work
-- again after they signed back in.
--
-- The foreign key makes the rule the database's: deleting a token set deletes that DID's sessions in the same
-- statement, a session cannot be inserted for a DID with no token set, and the token sets cannot be truncated alone.
-- The cascade runs as the table owner, so no grant changes. A token refresh and a replacing sign-in update the set
-- in place (oauthStores.ts `set` is an upsert; sign-in-lock.ts drops the library's delete when a store follows), so
-- they end no session; tests/integration/session/store.test.ts and tests/integration/http/logout.test.ts hold both.
--
-- First the rows the old rule left behind: sessions whose DID has no token set. Each already reads as signed out, so
-- nobody loses a working session. It runs before the constraint, in this migration's transaction, or the constraint
-- could not validate.
DELETE FROM app.session s WHERE NOT EXISTS (SELECT 1 FROM app.oauth_session o WHERE o.did = s.did);

-- ADD FOREIGN KEY takes SHARE ROW EXCLUSIVE on both tables and scans app.session once to validate
-- (https://www.postgresql.org/docs/18/sql-altertable.html, read 2026-11-15): reads continue, and writes to the two
-- tables wait for the commit. app.session holds one small row per signed-in browser and is indexed on did (0012).
ALTER TABLE app.session
  ADD CONSTRAINT session_did_token_set FOREIGN KEY (did) REFERENCES app.oauth_session (did) ON DELETE CASCADE;
