-- phase: expand
-- The chat account follows the Unset account's state (build step 11; ADR 0096 decisions 1, 2 and 4). `locked` is what
-- chat-admin last confirmed for the MAS account; app.chat_lock_due lists each ready chat account whose `locked`
-- differs from what its member's state asks for, and web brings it in line through chat-admin's lock or unlock. The
-- state, not an event, says what is due, so nothing can be missed and a failed call is simply due again; the indexer,
-- which records the PDS state (P3.06), needs no new grant. lock_due_at, lock_attempts and lock_lease are the job's own
-- backoff and lease, apart from the creation job's, which only touches pending rows. Concurrency (rule DA-4): the claim
-- locks app.chat_account rows with SKIP LOCKED in one statement, and only the lease holder may settle a row.
--
-- A member's state asks for a lock on positive evidence only: a moderator's suspension (mod.account_state), or an
-- inactive status our PDS reported (idx.account.pds_status: suspended, deactivated, takendown, deleted; ADR 0067 rules
-- 1, 2 and 5). A row with no status recorded (an account not yet confirmed, or an inactive one whose status the
-- stream left empty) is left as it is; its web sessions already end with the status (migration 0027).
-- The view runs with its owner's rights (security_invoker false by default, PostgreSQL 18 CREATE VIEW), so web needs
-- no grant on idx or mod; security_barrier keeps web's own predicates from seeing rows the view leaves out
-- (https://www.postgresql.org/docs/18/rules-privileges.html). It holds no row of its own, and rebuilding idx (DA-1)
-- drops and recreates it with the idx views. No new personal data: the lock is a fact about the chat account,
-- erased with app.chat_account.
ALTER TABLE app.chat_account
  ADD COLUMN locked boolean NOT NULL DEFAULT false,
  ADD COLUMN lock_due_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN lock_attempts integer NOT NULL DEFAULT 0 CHECK (lock_attempts >= 0),
  ADD COLUMN lock_lease uuid;

CREATE VIEW app.chat_lock_due WITH (security_barrier) AS
  SELECT c.did, w.want_locked
    FROM app.chat_account c
    CROSS JOIN LATERAL (
      SELECT EXISTS (
        SELECT 1 FROM idx.account a
          LEFT JOIN mod.account_state m USING (did)
         WHERE a.did = c.did
           AND (coalesce(m.mod_suspended, false)
                OR (NOT a.pds_active AND a.pds_status IN ('suspended', 'deactivated', 'takendown', 'deleted')))
      ) AS want_locked
    ) w
   WHERE c.state = 'ready' AND c.locked IS DISTINCT FROM w.want_locked;

GRANT SELECT (did, want_locked) ON app.chat_lock_due TO web;
GRANT SELECT (locked, lock_due_at, lock_attempts, lock_lease) ON app.chat_account TO web;
GRANT UPDATE (locked, lock_due_at, lock_attempts, lock_lease) ON app.chat_account TO web;
