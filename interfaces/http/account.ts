// app.account (P2.12; the row P2.06's book specified, written from onboarding because the callback does not create it).
// The birth date never reaches a parameter: an adult row stores now() in age_confirmed_at, and a block stores only
// the state. appendAudit runs in the same transaction as the block, so a failed audit rolls the block back.
import type { Did, Onboarding } from "@unset/domains-identity";
import { type AuditDb, appendAudit } from "@unset/infrastructure-audit";
import type { Pool, PoolClient } from "@unset/infrastructure-postgres";
import { withClient, withTransaction } from "@unset/infrastructure-postgres";

export type AccountRow = {
  readonly onboarding: Onboarding;
  readonly termsVersion: string | null;
  readonly privacyVersion: string | null;
};

export type AccountStore = {
  get(did: Did, deadline: AbortSignal): Promise<AccountRow | null>;
  /** Sets onboarding to terms and age_confirmed_at to now(), only from the age step. */
  confirmAdult(did: Did, deadline: AbortSignal): Promise<boolean>;
  /** Records the accepted versions. From terms the step becomes chat; a finished account stays done. */
  acceptTerms(did: Did, terms: string, privacy: string, deadline: AbortSignal): Promise<"chat" | "done" | null>;
  finishChat(did: Did, deadline: AbortSignal): Promise<boolean>;
  /** Blocks the account and writes age_gate.blocked. A throw rolls both back. */
  blockUnderage(
    did: Did,
    hosted: boolean,
    deadline: AbortSignal,
  ): Promise<{ readonly lane: string; readonly seq: number }>;
};

const STEPS = ["age", "terms", "chat", "done", "blocked_underage"] as const;

function accountOf(raw: Record<string, unknown>): AccountRow {
  const onboarding = raw.onboarding;
  if (typeof onboarding !== "string" || !(STEPS as readonly string[]).includes(onboarding)) {
    throw new Error("onboarding state");
  }
  const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
  return {
    onboarding: onboarding as Onboarding,
    termsVersion: text(raw.terms_version),
    privacyVersion: text(raw.privacy_version),
  };
}

const READ = "SELECT onboarding, terms_version, privacy_version FROM app.account WHERE did = $1";

/** PoolClient satisfies AuditDb; the wrapper keeps the call typed without a cast of the client. */
function asAuditDb(tx: PoolClient): AuditDb {
  return { query: (text, values) => tx.query(text, values) };
}

export function createAccountStore(pool: Pool): AccountStore {
  const read = <T>(deadline: AbortSignal, fn: (db: PoolClient) => Promise<T>) => withClient(pool, deadline, fn);
  const write = <T>(deadline: AbortSignal, fn: (tx: PoolClient) => Promise<T>) => withTransaction(pool, deadline, fn);

  return {
    async get(did, deadline) {
      const { rows } = await read(deadline, (db) => db.query<Record<string, unknown>>(READ, [did]));
      const row = rows[0];
      return row === undefined ? null : accountOf(row);
    },
    async confirmAdult(did, deadline) {
      const { rows } = await write(deadline, (tx) =>
        tx.query(
          "INSERT INTO app.account (did, first_seen_at, onboarding, age_confirmed_at) " +
            "VALUES ($1, now(), 'terms', now()) " +
            "ON CONFLICT (did) DO UPDATE SET onboarding = 'terms', age_confirmed_at = now() " +
            "WHERE app.account.onboarding = 'age' RETURNING onboarding",
          [did],
        ),
      );
      return rows.length === 1;
    },
    async acceptTerms(did, terms, privacy, deadline) {
      const { rows } = await write(deadline, (tx) =>
        tx.query<{ onboarding: string }>(
          "UPDATE app.account SET terms_version = $2, privacy_version = $3, terms_accepted_at = now(), " +
            "onboarding = CASE WHEN onboarding = 'done' THEN 'done' ELSE 'chat' END " +
            "WHERE did = $1 AND onboarding IN ('terms', 'done') RETURNING onboarding",
          [did, terms, privacy],
        ),
      );
      const onboarding = rows[0]?.onboarding;
      return onboarding === "chat" || onboarding === "done" ? onboarding : null;
    },
    async finishChat(did, deadline) {
      const { rows } = await write(deadline, (tx) =>
        tx.query(
          "UPDATE app.account SET onboarding = 'done' WHERE did = $1 AND onboarding = 'chat' RETURNING onboarding",
          [did],
        ),
      );
      return rows.length === 1;
    },
    async blockUnderage(did, hosted, deadline) {
      return write(deadline, async (tx) => {
        await tx.query(
          "INSERT INTO app.account (did, first_seen_at, onboarding) VALUES ($1, now(), 'blocked_underage') " +
            "ON CONFLICT (did) DO UPDATE SET onboarding = 'blocked_underage'",
          [did],
        );
        const appended = await appendAudit(asAuditDb(tx), {
          action: "age_gate.blocked",
          outcome: "succeeded",
          actorDid: did,
          target: did,
          ...(hosted ? { reason: "age_gate_hosted" as const } : {}),
        });
        return { lane: appended.lane, seq: appended.seq };
      });
    },
  };
}
