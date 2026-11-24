-- phase: expand
-- A browser entry cannot outlive its member's erasure (Codex review on ad2dbf0e). The door's redeem mints the device at
-- chat-admin first and writes door.browser after (domains/messaging/door.ts keep), with no transaction across the call
-- (rule DA-4). If core.erase_did commits in between, the insert would write the erased person's DID, chat user and lock
-- key back after step 4 removed them, and nothing would remove them again: door.browser has no foreign key to the
-- account, and migration 0051's trigger looks only at ended web sessions. This trigger takes the erasure's own advisory
-- lock (core.erase_did step 3, 'erase:' || DID), so an insert waits for a running erasure to commit, then refuses the
-- row when the DID is erased and the entry's chat user is no longer the member's. Refused, the insert writes nothing,
-- the store reads `taken`, and redeem ends the device it minted (door.ts keep, "chat.busy"). A member who signs up again
-- after an erasure has a new chat user in app.chat_account, so that entry is taken as usual.
-- A VOLATILE function obtains a fresh snapshot at the start of each query it executes (PostgreSQL 18 docs,
-- xfunc-volatility.html, read 2026-11-23), so the reads after the lock see the erasure's commit; the door runs in
-- READ COMMITTED, where each such snapshot holds every commit before it.
-- The HMAC is computed on its own first, as idx.is_erased does (migration 0028): a missing key raises, never "not
-- erased". No new personal data.
CREATE FUNCTION door.refuse_erased_member() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_hmac bytea;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('erase:' || NEW.did::text));
  IF EXISTS (SELECT 1 FROM app.chat_account WHERE did = NEW.did AND chat_user = NEW.chat_user) THEN
    RETURN NEW;
  END IF;
  v_hmac := core.erased_did_hmac(NEW.did);
  IF EXISTS (SELECT 1 FROM core.erased_did WHERE did_hmac = v_hmac) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END
$$;

-- Named to run after browser_refuse_ended_session (triggers fire in name order), so the two locks are always taken in
-- one order: the web session's, then the erasure's. Nothing takes them the other way round.
CREATE TRIGGER browser_refuse_erased BEFORE INSERT ON door.browser
  FOR EACH ROW EXECUTE FUNCTION door.refuse_erased_member();
