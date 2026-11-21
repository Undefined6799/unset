-- phase: expand
-- Each indexed card's size, so one member's cards together stay within what one page holds (book P3.12v; review of
-- #1911). The indexer writes it with the card, counted as domains/profile `recordBytes` counts it (the record's JSON in
-- UTF-8, as the save counts it), and skips a card that would take the account past MAX_PAGE_BYTES; the public page
-- reads cards in page order and stops at the same number. It is derived from the record and goes with the row (the
-- cascade from idx.account, core.erase_did), so it adds no personal data.
--
-- Rows indexed before this migration get the same count, so the index and the save agree on them at once (Codex
-- review of #1911): the jsonb's text form less the space it puts after each colon and comma
-- (https://www.postgresql.org/docs/18/datatype-json.html), one per object member and one per element or member after
-- a container's first. Strings print as JSON.stringify prints them, and an atproto record holds no floats
-- (https://atproto.com/specs/data-model), so every number prints as an integer in both. An expand migration may not
-- set NOT NULL (sqlLint), and an indexer still on the old code writes no size until it restarts, so readers count a
-- missing one as the jsonb's text, never smaller than the record's JSON.
ALTER TABLE idx.section ADD COLUMN bytes integer;
UPDATE idx.section s SET bytes = octet_length(s.record::text) - extra.spaces
  FROM idx.section t
  CROSS JOIN LATERAL (
    WITH RECURSIVE node(value, member) AS (
      SELECT t.record, false
      UNION ALL
      SELECT child.value, child.member
        FROM node
        CROSS JOIN LATERAL (
          SELECT e.value, true
            FROM jsonb_each(CASE WHEN jsonb_typeof(node.value) = 'object' THEN node.value END) e
          UNION ALL
          SELECT a.value, false
            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(node.value) = 'array' THEN node.value END) a
        ) child(value, member)
    )
    SELECT count(*) FILTER (WHERE member) + count(*) - 1
           - count(*) FILTER (WHERE jsonb_typeof(value) IN ('object', 'array') AND value NOT IN ('{}', '[]')) AS spaces
      FROM node
  ) extra
 WHERE s.uri = t.uri;

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
