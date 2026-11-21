-- phase: expand
-- P2.19b: the CID the member's PDS gave an image's main version (com.atproto.repo.uploadBlob's answer), noted when a
-- card first publishes it; NULL until then. After a card write lands, web keeps the use of the image the record
-- shows, found by this CID, and takes back the others (below). A CID is no personal data beyond the image it names,
-- and goes with its row (erased with the member by core.erase_did and the cascade from app.account).
-- Base32 CIDv1 (https://atproto.com/specs/data-model, "Link and CID Formats": multibase `b`).
ALTER TABLE app.image ADD COLUMN blob_cid text CHECK (blob_cid ~ '^b[a-z2-7]{20,200}$');

GRANT SELECT (blob_cid), UPDATE (blob_cid) ON app.image TO web;

-- Settling a card's uses after a write (Codex review of #1860). `lease` changes whenever a save asks for the use or a
-- write settles it, so a save that made a use takes it back only if nothing touched it since. `settled_rev` is the
-- PDS commit revision (a TID, so it sorts by time; https://atproto.com/specs/tid) of the write that last settled the
-- card's uses: a write's settling runs only if its revision is newer than every one the card's uses hold, and then
-- leaves the record exactly the picture it shows. NULL until a landed write settles it. No personal data beyond the
-- row it is on, erased with it.
ALTER TABLE app.image_use
  ADD COLUMN lease uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN settled_rev text CHECK (settled_rev ~ '^[2-7a-z]{13}$');

GRANT SELECT (lease, settled_rev), INSERT (lease, settled_rev), UPDATE (lease, settled_rev) ON app.image_use TO web;
