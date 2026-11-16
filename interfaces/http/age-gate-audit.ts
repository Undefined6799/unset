// The audit row an under-age block writes (P2.12): `age_gate.blocked`, with the member as actor and target, and the
// hosted reason when the account is on our PDS. The account repository calls this on the block's own transaction, so
// a failed audit rolls the block back. It sits in the interface because infrastructure/postgres may not import
// infrastructure/audit; the composition root joins the two.
import type { Did, UnderageBlockRecord } from "@unset/domains-identity";
import { type AuditDb, appendAudit } from "@unset/infrastructure-audit";
import type { PoolClient } from "@unset/infrastructure-postgres";

/** PoolClient satisfies AuditDb; the wrapper keeps the call typed without a cast of the client. */
function asAuditDb(tx: PoolClient): AuditDb {
  return { query: (text, values) => tx.query(text, values) };
}

export async function recordUnderageBlock(tx: PoolClient, did: Did, hosted: boolean): Promise<UnderageBlockRecord> {
  const appended = await appendAudit(asAuditDb(tx), {
    action: "age_gate.blocked",
    outcome: "succeeded",
    actorDid: did,
    target: did,
    ...(hosted ? { reason: "age_gate_hosted" as const } : {}),
  });
  return { lane: appended.lane, seq: appended.seq };
}
