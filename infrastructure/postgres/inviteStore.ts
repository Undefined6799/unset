// A member's invites (book P2.10; migration 0033): the rows behind the invite rule's ports (domains/identity
// invites.ts) and the Invite page's list. Each code is sealed to its own row (sealed-columns.json), so a dump yields
// no usable code and a value moved to another row does not open. Every statement carries the caller's DID, so no id
// a form sends reaches another member's row (rule SE-2). Each call is one statement; none holds a transaction open.
import { randomUUID } from "node:crypto";
import type { Did, InviteClaim, InviteId, SubmissionId } from "@unset/domains-identity";
import { SealError, type Sealer } from "@unset/infrastructure-seal";
import type { Logger } from "@unset/shared-log";
import { type Pool, withClient } from "./pool.ts";
import { sealedContext } from "./sealedColumns.ts";

/** One issued invite as the Invite page shows it; `code` is null when its seal does not open (a rotated-out key). */
export type InviteListItem = {
  readonly id: InviteId;
  readonly code: string | null;
  readonly createdAt: Date;
  readonly expiresAt: Date;
};

/** How long an invite lasts (Alex 2026-11-19); the list and the sweep both count from `created_at`. */
const LIFETIME = "interval '7 days'";

type Options = { readonly pool: Pool; readonly sealer: Sealer; readonly log: Logger };

/** Unexpired invites, newest first, at most 20; pending rows hold no code, cleared ones no longer, and neither shows. */
const LIST = `
  SELECT id, sealed_code, created_at, created_at + ${LIFETIME} AS expires_at FROM app.invite
   WHERE inviter_did = $1 AND state = 'issued' AND created_at > now() - ${LIFETIME}
   ORDER BY created_at DESC, id
   LIMIT 20`;

/**
 * The expiry sweep: every member's codes past their 7 days are deleted from our rows. It has no DID predicate because
 * it acts for no member; like the session sweeps it is one fixed, idempotent statement, safe on every replica.
 */
const CLEAR_EXPIRED = `
  UPDATE app.invite SET state = 'cleared', sealed_code = NULL
   WHERE state = 'issued' AND created_at <= now() - ${LIFETIME}`;

export function createInviteStore({ pool, sealer, log }: Options) {
  const context = (id: InviteId) => sealedContext("app.invite.sealed_code", id);
  const run = <T>(deadline: AbortSignal | undefined, fn: Parameters<typeof withClient<T>>[2]) =>
    withClient(pool, deadline ?? null, fn);

  const opened = (id: InviteId, sealed: string): string | null => {
    try {
      return Buffer.from(sealer.unseal(sealed, context(id))).toString("utf8");
    } catch (error) {
      if (!(error instanceof SealError)) throw error;
      log.warn("invite.unseal_failed", {});
      return null;
    }
  };

  return {
    /** A new pending row for the submission, or what the row an earlier send of the same form left says. */
    async claim(did: Did, submission: SubmissionId, deadline?: AbortSignal): Promise<InviteClaim> {
      const id = randomUUID() as InviteId;
      return run(deadline, async (db) => {
        const inserted = await db.query(
          "INSERT INTO app.invite (id, inviter_did, submission_id, state, created_at) " +
            "VALUES ($1, $2, $3, 'pending', now()) ON CONFLICT (inviter_did, submission_id) DO NOTHING",
          [id, did, submission],
        );
        if (inserted.rowCount === 1) return { kind: "claimed", id };
        const { rows } = await db.query<{ state: string }>(
          "SELECT state FROM app.invite WHERE inviter_did = $1 AND submission_id = $2",
          [did, submission],
        );
        // No row: the first send was refused and dropped its row a moment ago; that send still answers the member.
        return rows[0]?.state === "issued" ? { kind: "issued" } : { kind: "pending" };
      });
    },

    /** Seals `code` onto the caller's pending row; throws when that row is not there to take it. */
    async store(did: Did, id: InviteId, code: string, deadline?: AbortSignal): Promise<void> {
      const sealed = sealer.seal(Buffer.from(code, "utf8"), context(id));
      const updated = await run(deadline, (db) =>
        db.query(
          "UPDATE app.invite SET state = 'issued', sealed_code = $3 " +
            "WHERE id = $1 AND inviter_did = $2 AND state = 'pending'",
          [id, did, sealed],
        ),
      );
      if (updated.rowCount !== 1) throw new Error("invite store: no pending row to store the code on");
    },

    /** Deletes the caller's pending row `id`, so the same form can be sent again. */
    async drop(did: Did, id: InviteId, deadline?: AbortSignal): Promise<void> {
      await run(deadline, (db) =>
        db.query("DELETE FROM app.invite WHERE id = $1 AND inviter_did = $2 AND state = 'pending'", [id, did]),
      );
    },

    async list(did: Did, deadline?: AbortSignal): Promise<InviteListItem[]> {
      const { rows } = await run(deadline, (db) =>
        db.query<{ id: InviteId; sealed_code: string; created_at: Date; expires_at: Date }>(LIST, [did]),
      );
      return rows.map((row) => ({
        id: row.id,
        code: opened(row.id, row.sealed_code),
        createdAt: row.created_at,
        expiresAt: row.expires_at,
      }));
    },

    /** Hides the caller's own issued row `id` and deletes our copy of its code; false when they have no such row. */
    async hide(did: Did, id: InviteId, deadline?: AbortSignal): Promise<boolean> {
      const updated = await run(deadline, (db) =>
        db.query(
          "UPDATE app.invite SET state = 'cleared', sealed_code = NULL, hidden_at = now() " +
            "WHERE id = $1 AND inviter_did = $2 AND state = 'issued'",
          [id, did],
        ),
      );
      return updated.rowCount === 1;
    },

    /** Deletes every code past its 7 days from its row (web's sweep); returns how many. */
    async clearExpired(): Promise<number> {
      const updated = await run(undefined, (db) => db.query(CLEAR_EXPIRED));
      return updated.rowCount ?? 0;
    },
  };
}

export type InviteStore = ReturnType<typeof createInviteStore>;
