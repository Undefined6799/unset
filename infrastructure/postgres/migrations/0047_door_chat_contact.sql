-- phase: expand
-- The Message link's lookup (build step 10; ADR 0094 decision 6, ADR 0101 decision 3): the chat user of a member whose
-- chat account is ready and whose public page shows, and of no one else. A view owned by migrator, run with its
-- owner's rights (https://www.postgresql.org/docs/18/sql-createview.html, security_invoker defaults to false), so
-- chat_auth reads it with no grant on app.chat_account or idx; security_barrier keeps a function in the door's own
-- WHERE clause from seeing a row the view leaves out (https://www.postgresql.org/docs/18/rules-privileges.html). The
-- page rule is web's own: idx.public_profile shows a visible account (active on our PDS, not delisted, not suspended;
-- migration 0025) with a published profile (migration 0030), so a hidden, deactivated, suspended, erased or
-- profile-less member reads here as missing, as on their page (D7, SE-2). The view holds no row of its own:
-- core.erase_did deletes the rows under it. Rebuilding idx (DA-1) drops and recreates it with the idx views.
-- The door reads it by DID through app.chat_account's primary key.
CREATE VIEW door.chat_contact WITH (security_barrier) AS
  SELECT c.did, c.chat_user
    FROM app.chat_account c
    JOIN idx.public_profile p USING (did)
   WHERE c.state = 'ready';

GRANT SELECT (did, chat_user) ON door.chat_contact TO chat_auth;
