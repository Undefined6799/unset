-- phase: expand
-- unset.sh's Log out reaching the chat page (ADR 0083 decision 5, note of 2026-11-21): web signs a session.mint ticket
-- for the web session it just ended, and the door spends it only on the entry this browser holds for the member
-- (domains/messaging door.ts redeemForSignOut). The ticket's session must also be the one that last signed that entry
-- in (door.browser.web_session, migration 0038), so a ticket from the member's Log out in one browser cannot be spent
-- in another browser of the same member and log that one out. The door could write the column but not read it; it now
-- reads that one column, compared in the query (infrastructure/postgres browserListStore.ts SIGNED_IN_FROM), and still
-- cannot change who an entry is, its device or its key. No new personal data: a session reference the door already
-- stores (an HMAC of web's session id, never the id), erased with the row.
GRANT SELECT (web_session) ON door.browser TO chat_auth;
