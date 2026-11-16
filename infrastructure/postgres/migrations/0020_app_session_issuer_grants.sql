-- phase: expand
-- P2.03p (ADR 0048): web may write the sign-in server origin once, when it creates a session, and read it back with
-- the session. No UPDATE: the origin never changes for the life of a session, so a changed value means a new row.
-- Column grants only, like the rest of app.session (0011); no other role gets the column
-- (https://www.postgresql.org/docs/18/sql-grant.html, column privileges).
-- The column's check (0019) is a coarse shape guard and still admits consecutive dots in the host; the real check
-- is interfaces/http's issuerOrigin, which runs before the write.
GRANT SELECT (issuer_origin), INSERT (issuer_origin) ON app.session TO web;
