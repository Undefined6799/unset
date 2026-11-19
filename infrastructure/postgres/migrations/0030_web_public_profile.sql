-- phase: expand
-- What the public profile page (book P3.12s, docs/ai/book/phase-3.md "P3.00 refinement for the own-PDS profile slice")
-- reads, and nothing more. `web` gets no grant on any idx table: it reads two views, owned by migrator, that show only
-- accounts in idx.visible_account (active on our PDS, not delisted, not suspended), so a hidden, deactivated, deleted
-- or erased account's rows cannot be read by web whatever query it sends. The views run with their owner's rights
-- (https://www.postgresql.org/docs/18/sql-createview.html, "security_invoker" defaults to false), so web needs nothing
-- on mod.account_state either. `security_barrier` keeps a function in web's own WHERE clause from seeing a row the
-- view's join leaves out (https://www.postgresql.org/docs/18/rules-privileges.html).
--
-- A handle is shown only when the indexer verified it (P3.08s); otherwise the view gives null and the page uses the
-- DID. The record is the member's published sh.unset.profile and sh.unset.section records as the indexer stored them;
-- domains/profile reads them again on the way out. Cards show only beside a published profile, as on the page. Both
-- views name a DID only for a visible account, and hold no row of their own: core.erase_did deletes the rows under
-- them.
CREATE VIEW idx.public_profile WITH (security_barrier) AS
  SELECT v.did,
         CASE WHEN v.handle_status = 'verified' THEN v.handle END AS handle,
         v.moderation_version, p.cid, p.record
    FROM idx.visible_account v
    JOIN idx.profile p USING (did);

CREATE VIEW idx.public_section WITH (security_barrier) AS
  SELECT s.did, s.rkey, s.cid, s.record
    FROM idx.visible_account v
    JOIN idx.profile p USING (did)
    JOIN idx.section s USING (did);

GRANT SELECT (did, handle, moderation_version, cid, record) ON idx.public_profile TO web;
GRANT SELECT (did, rkey, cid, record) ON idx.public_section TO web;
