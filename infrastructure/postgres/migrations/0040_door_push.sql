-- phase: expand
-- The chat count (build step 10; ADR 0082, ADR 0090): one row per browser entry whose chat page registered a pusher.
-- The pushkey the door issued that entry, kept only as its sha256 (a row is not a key), and the latest number of chats
-- with new messages the homeserver sent for it, overwritten each time, with when. A new key replaces the entry's
-- last one and keeps the number, so a pusher left behind by an older page is answered `rejected` and dropped. The
-- member's number is the one counted last over their entries, read through door.browser's (did, device_id) index.
-- The row names no member itself: it goes with its browser entry by the foreign key, so Log out, an ended device and
-- erasure (core.erase_did deletes door.browser) take it along, and core.erase_did needs no change.
-- Personal data: a count per browser entry of a member; purpose, to show the member on unset.sh how many of their chats
-- have new messages; lawful basis, the contract the member accepted with the terms (chat is part of the service);
-- overwritten on each change and erased with the member's browser entries (ON DELETE CASCADE). Export: the latest
-- number, with the browser list (ADR 0081 Consequences; no export exists yet).

CREATE TABLE door.push (
  browser_id uuid PRIMARY KEY REFERENCES door.browser (id) ON DELETE CASCADE,
  pushkey_hash bytea NOT NULL UNIQUE CHECK (octet_length(pushkey_hash) = 32),
  unread integer CHECK (unread >= 0),
  counted_at timestamptz,
  CHECK ((unread IS NULL) = (counted_at IS NULL))
);

-- The door issues and replaces a key (INSERT ... ON CONFLICT DO UPDATE, which reads the row, so SELECT), records a
-- number by the key's hash, and reads the latest number. Rows go only with their browser entry, so no DELETE.
GRANT SELECT (browser_id, pushkey_hash, unread, counted_at) ON door.push TO chat_auth;
GRANT INSERT (browser_id, pushkey_hash) ON door.push TO chat_auth;
GRANT UPDATE (pushkey_hash, unread, counted_at) ON door.push TO chat_auth;
