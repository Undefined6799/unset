// The sign-in history's rows (P2.27c, ADR 0082; migration 0038). Every statement names the member's DID, so an id a
// form sends never reaches another member's row (rule SE-2). `record` runs on the connection the caller gives, so the
// OAuth callback writes it in the sign-in's own transaction.
import type { Did, SignIn, SignInId } from "@unset/domains-identity";
import { SIGN_IN_KEEP_DAYS } from "@unset/domains-identity";
import type { Db } from "./singleUse/store.ts";

const LIST = "SELECT id, signed_in_at FROM app.sign_in WHERE did = $1 ORDER BY signed_in_at DESC, id LIMIT $2";

const REMOVE = "DELETE FROM app.sign_in WHERE did = $1 AND id = ANY($2::uuid[])";

/** "Delete all": the newest sign-in the page listed and every older one, never one after the page was drawn. */
const REMOVE_UP_TO = `DELETE FROM app.sign_in s WHERE s.did = $1
   AND s.signed_in_at <= (SELECT u.signed_in_at FROM app.sign_in u WHERE u.did = $1 AND u.id = $2::uuid)`;

/** A member with no account row yet (their first sign-in, before the terms step) has no history kept. */
const RECORD = `INSERT INTO app.sign_in (did) SELECT $1::text
   WHERE EXISTS (SELECT 1 FROM app.account a WHERE a.did = $1::text)`;

/** The 30-day ceiling, for every member; one fixed, idempotent statement, like the other sweeps. */
const SWEEP = "DELETE FROM app.sign_in WHERE signed_in_at <= now() - make_interval(days => $1)";

type Row = { id: string; signed_in_at: Date };

export function createSignInStore() {
  return {
    async record(db: Db, did: Did): Promise<void> {
      await db.query(RECORD, [did]);
    },
    async list(db: Db, did: Did, limit: number): Promise<SignIn[]> {
      const { rows } = await db.query<Row>(LIST, [did, limit]);
      return rows.map((row) => ({ id: row.id as SignInId, at: row.signed_in_at }));
    },
    async remove(db: Db, did: Did, ids: readonly SignInId[]): Promise<number> {
      if (ids.length === 0) return 0;
      return (await db.query(REMOVE, [did, ids])).rowCount ?? 0;
    },
    async removeUpTo(db: Db, did: Did, upTo: SignInId): Promise<number> {
      return (await db.query(REMOVE_UP_TO, [did, upTo])).rowCount ?? 0;
    },
    /** `keepDays` is SIGN_IN_KEEP_DAYS in service; a test passes 0, as web may not backdate a row. */
    async sweep(db: Db, keepDays: number = SIGN_IN_KEEP_DAYS): Promise<number> {
      return (await db.query(SWEEP, [keepDays])).rowCount ?? 0;
    },
  };
}

export type SignInStore = ReturnType<typeof createSignInStore>;
