// app.account behind the AccountRepository contract domains/identity defines (P2.12; moved here from interfaces/http
// by P2.12g so admin, the API, jobs and erasure can be handed the same store). The birth date never reaches a
// parameter: an adult row stores now() in age_confirmed_at, and a block stores only the state.
import type {
  AccountRepository,
  Did,
  Onboarding,
  OnboardingAccount,
  UnderageBlockRecord,
} from "@unset/domains-identity";
import type { ChatAccountStore } from "./chatAccountStore.ts";
import type { Pool, PoolClient } from "./pool.ts";
import { withClient } from "./pool.ts";
import { withTransaction } from "./tx.ts";

/**
 * The block's open transaction, as the audit writer sees it: one `query`, nothing else. It cannot commit, roll back,
 * release the client or reach the pool. `infrastructure/audit`'s `AuditDb` has this shape.
 */
export type BlockTransaction = {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
};

export type AccountRepositoryOptions = {
  /**
   * Writes the audit row for an under-age block. The composition root passes it: this folder may not import
   * infrastructure/audit (architecture matrix row `infrastructure`).
   *
   * It must write through `tx` and nowhere else. `tx` is the transaction that holds the block, so a throw here rolls
   * the block back and a row written through `tx` is rolled back with it. A writer that used a client of its own
   * would leave an audit row for a block that never happened, or a block with no audit row. No type can enforce
   * that; `age.audit_failure_rolls_block_back` (tests/integration/http/onboarding.test.ts) pins the rollback.
   */
  readonly recordUnderageBlock: (tx: BlockTransaction, did: Did, hosted: boolean) => Promise<UnderageBlockRecord>;
  /**
   * Queues the member's chat account in the terms transaction (build step 5; ADR 0081 decision 3), so an accepted
   * account always has its chat user and no failed acceptance leaves one. Required: no repository can forget it.
   */
  readonly chatAccounts: Pick<ChatAccountStore, "request">;
};

const STEPS = ["age", "terms", "chat", "done", "blocked_underage"] as const;

function accountOf(raw: Record<string, unknown>): OnboardingAccount {
  const onboarding = raw.onboarding;
  if (typeof onboarding !== "string" || !(STEPS as readonly string[]).includes(onboarding)) {
    throw new Error("onboarding state");
  }
  const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
  return {
    onboarding: onboarding as Onboarding,
    termsVersion: text(raw.terms_version),
    privacyVersion: text(raw.privacy_version),
    privacyNoticeSeenVersion: text(raw.privacy_notice_seen_version),
  };
}

const READ =
  "SELECT onboarding, terms_version, privacy_version, privacy_notice_seen_version FROM app.account WHERE did = $1";

export function createAccountRepository(pool: Pool, options: AccountRepositoryOptions): AccountRepository {
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
      const rows = await write(deadline, async (tx) => {
        const accepted = await tx.query<{ onboarding: string }>(
          "UPDATE app.account SET terms_version = $2, privacy_version = $3, terms_accepted_at = now(), " +
            "onboarding = CASE WHEN onboarding = 'done' THEN 'done' ELSE 'chat' END " +
            "WHERE did = $1 AND onboarding IN ('terms', 'done') RETURNING onboarding",
          [did, terms, privacy],
        );
        // A finished member accepting new terms is queued too, so members from before chat get their account; a
        // second request keeps the chat user already drawn.
        if (accepted.rows.length === 1) await options.chatAccounts.request(tx, did);
        return accepted.rows;
      });
      const onboarding = rows[0]?.onboarding;
      return onboarding === "chat" || onboarding === "done" ? onboarding : null;
    },
    async finishChat(did, deadline) {
      return write(deadline, async (tx) => {
        const { rows } = await tx.query(
          "UPDATE app.account SET onboarding = 'done' WHERE did = $1 AND onboarding = 'chat' RETURNING onboarding",
          [did],
        );
        if (rows.length !== 1) return false;
        // The member is now 16 or over and has accepted the terms and privacy notice, so the indexer may track them
        // (migration 0026; book P3.02s). In this transaction: a failed finish queues nothing. `web` may only insert
        // into the queue, so a repeat is a no-op that reads nothing back.
        await tx.query("INSERT INTO idx.track_request (did, requested_at) VALUES ($1, now()) ON CONFLICT DO NOTHING", [
          did,
        ]);
        return true;
      });
    },
    async markPrivacyNoticeSeen(did, privacy, deadline) {
      // Only a finished account sees the banner (requireOnboarded), so only one may dismiss it.
      const { rows } = await write(deadline, (tx) =>
        tx.query(
          "UPDATE app.account SET privacy_notice_seen_version = $2 WHERE did = $1 AND onboarding = 'done' " +
            "RETURNING onboarding",
          [did, privacy],
        ),
      );
      return rows.length === 1;
    },
    async blockUnderage(did, hosted, deadline) {
      return write(deadline, async (tx) => {
        // Only the age step may become blocked. A concurrent adult confirmation or an earlier block
        // leaves the row alone, and this transaction then writes no audit row.
        // https://www.postgresql.org/docs/18/sql-insert.html (read 2026-10-17): a row the WHERE
        // clause does not update is absent from RETURNING.
        const { rows } = await tx.query(
          "INSERT INTO app.account (did, first_seen_at, onboarding) VALUES ($1, now(), 'blocked_underage') " +
            "ON CONFLICT (did) DO UPDATE SET onboarding = 'blocked_underage' " +
            "WHERE app.account.onboarding = 'age' RETURNING onboarding",
          [did],
        );
        if (rows.length !== 1) return null;
        const audit: BlockTransaction = { query: (text, values) => tx.query(text, values) };
        return options.recordUnderageBlock(audit, did, hosted);
      });
    },
  };
}
