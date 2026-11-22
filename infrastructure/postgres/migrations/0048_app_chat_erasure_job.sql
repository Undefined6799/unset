-- phase: expand
-- The erased members' chat accounts become web's queued "deactivate chat account" job (build step 11; ADR 0096
-- decisions 3 and 4). core.erase_did keeps writing app.chat_erasure as its owner (migration 0044's version), with the
-- chat user and no DID; web claims a due row under a fresh lease, asks chat-admin to deactivate the account (which ends
-- every session and asks the homeserver to erase it), then deletes the row, or puts it back with a wait. Rows are
-- never given up: chat cannot be forgotten. The claim reads due rows with no index: one row per erased member, gone
-- once done; an index comes with a measurement (rule PF-1). Concurrency (rule DA-4): the claim locks due rows with SKIP
-- LOCKED in one statement, and only the holder of the lease may delete or put back the row.
-- Personal data: the chat user is pseudonymous (ADR 0010), kept only until the deactivation is done, then deleted;
-- purpose and lawful basis as erasure itself (GDPR Art. 17).
ALTER TABLE app.chat_erasure
  ADD COLUMN due_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  ADD COLUMN lease_token uuid;

GRANT SELECT (chat_user, due_at, attempts, lease_token) ON app.chat_erasure TO web;
GRANT UPDATE (due_at, attempts, lease_token) ON app.chat_erasure TO web;
GRANT DELETE ON app.chat_erasure TO web;
