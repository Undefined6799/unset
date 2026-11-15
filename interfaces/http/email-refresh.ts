// The email gate's refresh (P2.11, wired by P2.12): when the cached confirmation is stale, ask the PDS again through
// P2.07's pdsSessionInfo and cache a fresh answer on this session. The gate in app-gate.ts turns the answer into a
// redirect; the decision of when to ask is `emailGate` in the identity domain.
// P2.11g: a PDS that does not answer is not asked again for the same member for `PDS_HOLD_MS`. Without it every page
// view of a member with a stale cache waits out the PDS call again (review 2026-11-15, finding F2). During a hold the
// gate hears "transient", exactly what the PDS call would have said, so its rules are unchanged: the cached
// confirmation is served only inside P2.11d's cap, and past it the unavailable page is shown. The hold is this
// process's memory only: a restart or another replica asks again.
import type { Did } from "@unset/domains-identity";
import type { PdsResult, SessionInfo } from "@unset/infrastructure-pds";
import type { AppGate } from "./app-gate.ts";

export type EmailRefreshDeps = {
  /** P2.07 pdsSessionInfo. On a dead grant it has already ended the DID's sessions (pds-call.ts `authDead`). */
  sessionInfo: (did: Did, deadline: AbortSignal, deadlineAt: number) => Promise<PdsResult<SessionInfo>>;
  setEmailConfirmed: (idHash: Buffer, value: boolean, deadline: AbortSignal) => Promise<void>;
  /** A monotonic clock in milliseconds (`performance.now`) for the hold; never wall time. */
  now: () => number;
};

/**
 * How long one member's recheck is not repeated after the PDS failed to answer. It is also the longest a revoked
 * grant or a withdrawn confirmation can go unnoticed beyond today's bound, and only after such a failure.
 */
export const PDS_HOLD_MS = 30_000;
/** The most members held at once. A full table is emptied, so the cost of overflow is asking the PDS again. */
export const PDS_HOLD_MAX_MEMBERS = 10_000;

/** Which members are on hold, and until when on `now`'s clock. */
function pdsHold(now: () => number) {
  const until = new Map<Did, number>();
  return {
    active(did: Did): boolean {
      const end = until.get(did);
      if (end === undefined) return false;
      if (now() < end) return true;
      until.delete(did);
      return false;
    },
    start(did: Did): void {
      if (until.size >= PDS_HOLD_MAX_MEMBERS) until.clear();
      until.set(did, now() + PDS_HOLD_MS);
    },
  };
}

export function emailRefresh(deps: EmailRefreshDeps): AppGate["refreshEmail"] {
  const hold = pdsHold(deps.now);
  return async (session, deadline, deadlineAt) => {
    if (hold.active(session.did)) return "transient";
    const info = await deps.sessionInfo(session.did, deadline, deadlineAt);
    switch (info.kind) {
      case "transient":
        // lock_timeout is our own sign-in lock, held by another request of this member: the PDS was not asked.
        if (info.code !== "lock_timeout") hold.start(session.did);
        return "transient";
      case "ok": {
        if (info.value.emailConfirmed === undefined) return "unconfirmed";
        const confirmed = info.value.emailConfirmed;
        await deps.setEmailConfirmed(session.idHash, confirmed, deadline);
        return confirmed ? "confirmed" : "unconfirmed";
      }
      case "auth_dead":
        // The sessions are already gone (pds-call.ts `authDead`); "unconfirmed" would send this browser to
        // /verify-email with a cookie that no longer names a session (P2.11a).
        return "ended";
      case "scope_missing":
      case "rejected":
        return "unconfirmed";
      default: {
        const unexpected: never = info;
        return unexpected;
      }
    }
  };
}
