-- phase: expand
-- The door's setup claim (build step 8; ADR 0095 decision 2, ADR 0100): at most one browser at a time runs the
-- "Save your recovery key" setup for an account, so two browsers can never each make a different signing identity
-- and vault for it. One row per account (the chat user) while a setup runs: which browser entry holds it and until
-- when. A claim is one statement, an INSERT whose conflict on the primary key takes the row only when it is the
-- holder's own or its time has passed (rule DA-4: the primary key serialises concurrent claims; no transaction is
-- held open). Release deletes the holder's own row. A row of a browser entry that is deleted (Log out, a device that
-- ended, erasure through core.erase_did's delete of door.browser) goes with it by the foreign key.
-- Personal data: the pseudonymous chat user and a browser entry's id, kept for at most the claim's few minutes or
-- until the setup ends; purpose, to keep a member's encryption setup to one browser; lawful basis, the contract (chat
-- is part of the service); erased with the member's browser entries (ON DELETE CASCADE). Export: nothing lasting.

CREATE TABLE door.chat_setup (
  chat_user text PRIMARY KEY CHECK (chat_user ~ '^u[a-z2-7]{20}$'),
  browser_id uuid NOT NULL REFERENCES door.browser (id) ON DELETE CASCADE,
  claimed_until timestamptz NOT NULL
);
-- The foreign key's own index, so deleting a browser entry finds its claim without a scan.
-- query: infrastructure/postgres/browserListStore.ts:REMOVE
-- why: foreign-key
CREATE INDEX chat_setup_browser ON door.chat_setup (browser_id);

-- The door claims (INSERT ... ON CONFLICT DO UPDATE reads the row it may take, so SELECT on its columns), re-claims
-- its own and releases it; it reads nothing else here.
GRANT SELECT (chat_user, browser_id, claimed_until) ON door.chat_setup TO chat_auth;
GRANT INSERT (chat_user, browser_id, claimed_until) ON door.chat_setup TO chat_auth;
GRANT UPDATE (browser_id, claimed_until) ON door.chat_setup TO chat_auth;
GRANT DELETE ON door.chat_setup TO chat_auth;
