-- phase: expand
-- P2.03n (ADR 0048): the origin of the sign-in server OAuth recorded for this session, so the account pages draw the
-- "Your account on ..." link from the session row they already read and no longer unseal the token set for it.
-- Nullable: sessions created before this column keep null and the pages fall back to the token set until they expire.
-- The check keeps the shape interfaces/http's issuerOrigin already enforces before the write: an https origin on a
-- DNS name with no port, path, user or query. It is not new personal data: the same origin sits in the sealed token
-- set and in the sign-out cookie, and it leaves with the row (sign-out, expiry, app.end_sessions_for_did, erasure).
-- Adding a nullable column with no default rewrites nothing
-- (https://www.postgresql.org/docs/18/sql-altertable.html, Notes).
-- No grant here: web's SELECT and INSERT on the column are the next migration (0020). Until then no role can read
-- or write it.
ALTER TABLE app.session ADD COLUMN issuer_origin text
  CHECK (issuer_origin ~ '^https://[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$');
