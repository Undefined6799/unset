-- phase: expand
-- P2.19b: the CID the member's PDS gave an image's main version (com.atproto.repo.uploadBlob's answer), noted when a
-- card first publishes it; NULL until then. After a card write lands, web takes back the use of the image the
-- replaced record showed, found by this CID. The write swapped on that record at the PDS, so it is exactly the one
-- replaced, and two saves of one card settle correctly in either order. A CID is no personal data beyond the image
-- it names, and goes with its row (erased with the member by core.erase_did and the cascade from app.account).
-- Base32 CIDv1 (https://atproto.com/specs/data-model, "Link and CID Formats": multibase `b`).
ALTER TABLE app.image ADD COLUMN blob_cid text CHECK (blob_cid ~ '^b[a-z2-7]{20,200}$');

GRANT SELECT (blob_cid), UPDATE (blob_cid) ON app.image TO web;
