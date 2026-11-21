-- phase: expand
-- Each indexed card's size, so one member's cards together stay within what one page holds (book P3.12v; review of
-- #1911). The indexer writes it with the card, counted as domains/profile `recordBytes` counts it (the record's JSON in
-- UTF-8, as the save counts it), and skips a card that would take the account past MAX_PAGE_BYTES; the public page
-- reads cards in page order and stops at the same number. It is derived from the record and goes with the row (the
-- cascade from idx.account, core.erase_did), so it adds no personal data.
--
-- Rows indexed before this migration get the size of their stored jsonb as text, which is never smaller than the
-- record's JSON (jsonb's text form adds a space after each comma and colon:
-- https://www.postgresql.org/docs/18/datatype-json.html), so an old card is never counted as smaller than it is. The
-- next write of the card, or a backfill, stores the exact size. An expand migration may not set NOT NULL (sqlLint),
-- and an indexer still on the old code writes none until it restarts, so readers count a missing size the same way.
ALTER TABLE idx.section ADD COLUMN bytes integer;
UPDATE idx.section SET bytes = octet_length(record::text);

GRANT SELECT (bytes), INSERT (bytes), UPDATE (bytes) ON idx.section TO indexer;

-- idx.public_section (0030) gains the card's place in the profile's order and its size, so web reads cards in page
-- order and stops at the budget. A view may gain columns at the end of its list and keeps its grants when replaced
-- (https://www.postgresql.org/docs/18/sql-createview.html); security_barrier is restated.
CREATE OR REPLACE VIEW idx.public_section WITH (security_barrier) AS
  SELECT s.did, s.rkey, s.cid, s.record, s.position, coalesce(s.bytes, octet_length(s.record::text)) AS bytes
    FROM idx.visible_account v
    JOIN idx.profile p USING (did)
    JOIN idx.section s USING (did);

GRANT SELECT (position, bytes) ON idx.public_section TO web;
