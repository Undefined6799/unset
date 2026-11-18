// Ported from interfaces/http/age-gate-audit.ts (P1.20f); the Hono copy went at P1.20k.
// The audit row an under-age block writes (P2.12): `age_gate.blocked`, with the member as actor and target, and the
// hosted reason when the account is on our PDS. The account repository calls this on the block's own transaction, so
// a failed audit rolls the block back. It sits in the interface because infrastructure/postgres may not import
// infrastructure/audit; the composition root joins the two.
import type { Did, UnderageBlockRecord } from "@unset/domains-identity";
import { appendAudit } from "@unset/infrastructure-audit";
import type { BlockTransaction } from "@unset/infrastructure-postgres";

/** `tx` is the block's own transaction; the audit row is written through it and nothing else. */
export async function recordUnderageBlock(
  tx: BlockTransaction,
  did: Did,
  hosted: boolean,
): Promise<UnderageBlockRecord> {
  const appended = await appendAudit(tx, {
    action: "age_gate.blocked",
    outcome: "succeeded",
    actorDid: did,
    target: did,
    ...(hosted ? { reason: "age_gate_hosted" as const } : {}),
  });
  return { lane: appended.lane, seq: appended.seq };
}
