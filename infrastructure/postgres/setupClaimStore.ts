// door.chat_setup (migration 0044; ADR 0095 decision 2, ADR 0100): the door's setup claim, for chat_auth. A claim is
// one statement (rule DA-4): an INSERT whose conflict on the account's primary key takes the row only when it is this
// entry's own or its time has passed. Concurrent claims serialise on the primary key's index, and each one that waits
// reads the winner's committed row before it decides, so exactly one browser holds an account at a time
// (https://www.postgresql.org/docs/18/sql-insert.html#SQL-ON-CONFLICT, read 2026-11-21: "ON CONFLICT DO UPDATE
// guarantees an atomic INSERT or UPDATE outcome"). Each statement names the entry's own id and chat user (rule SE-2).
import type { SetupClaims } from "@unset/domains-messaging";
import { type Pool, withClient } from "./pool.ts";

const CLAIM = `INSERT INTO door.chat_setup AS c (chat_user, browser_id, claimed_until)
  VALUES ($1, $2, now() + make_interval(secs => $3))
  ON CONFLICT (chat_user) DO UPDATE SET browser_id = excluded.browser_id, claimed_until = excluded.claimed_until
  WHERE c.browser_id = excluded.browser_id OR c.claimed_until < now()`;
const RELEASE = "DELETE FROM door.chat_setup WHERE chat_user = $1 AND browser_id = $2";

export function createSetupClaimStore(pool: Pool): SetupClaims {
  return {
    async claim(entry, leaseS, deadline) {
      const values = [entry.user, entry.id, leaseS];
      const { rowCount } = await withClient(pool, deadline, (db) => db.query(CLAIM, values));
      return rowCount === 1 ? "claimed" : "elsewhere";
    },
    async release(entry, deadline) {
      await withClient(pool, deadline, (db) => db.query(RELEASE, [entry.user, entry.id]));
    },
  };
}
