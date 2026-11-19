// The audit row a refused invite writes (book P2.10 step 3, `denied`): pds-admin would not issue for this member, a
// security event in web's lane, with the member as actor and target. It sits in the interface because
// infrastructure/postgres may not import infrastructure/audit (age-gate-audit.ts does the same for the age gate).
import type { Did } from "@unset/domains-identity";
import { appendAudit } from "@unset/infrastructure-audit";
import { type Pool, withTransaction } from "@unset/infrastructure-postgres";

export async function recordInviteDenied(pool: Pool, did: Did, deadline: AbortSignal): Promise<void> {
  await withTransaction(pool, deadline, (tx) =>
    appendAudit(tx, { action: "invite.denied", outcome: "denied", actorDid: did, target: did }),
  );
}
