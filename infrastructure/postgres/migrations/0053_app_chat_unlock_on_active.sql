-- phase: expand
-- A chat lock is lifted only on positive evidence too (ADR 0096 decisions 1 and 2; Codex review of migration 0048).
-- 0048's view asked for an unlock whenever its lock evidence was missing, so a locked account whose member stayed
-- inactive with no status or one we do not know (the indexer stores the stream's status as it comes,
-- infrastructure/postgres/indexStore.ts hideAccount; a confirmed deletion clears it and keeps the account hidden,
-- accountStore.ts confirmDeletion), or whose idx row was gone, was unlocked. want_locked is now three-valued: true on
-- a moderator's suspension or a known inactive status, false only when the PDS reports the account active and no
-- moderator suspends it, NULL otherwise, and a NULL leaves the chat account as it is, locked or not (fail closed).
-- Same columns, so CREATE OR REPLACE keeps the view's grants (PostgreSQL 18 docs, sql-createview.html: "the new query
-- must generate the same columns"). No new personal data.
CREATE OR REPLACE VIEW app.chat_lock_due WITH (security_barrier) AS
  SELECT c.did, w.want_locked
    FROM app.chat_account c
    CROSS JOIN LATERAL (
      SELECT CASE
               WHEN coalesce(m.mod_suspended, false)
                 OR (NOT a.pds_active AND a.pds_status IN ('suspended', 'deactivated', 'takendown', 'deleted'))
                 THEN true
               WHEN a.pds_active THEN false
             END AS want_locked
        FROM (SELECT c.did) d
        LEFT JOIN idx.account a ON a.did = d.did
        LEFT JOIN mod.account_state m ON m.did = d.did
    ) w
   WHERE c.state = 'ready' AND w.want_locked IS NOT NULL AND c.locked <> w.want_locked;
