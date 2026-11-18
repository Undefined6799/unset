// The email gate's refresh (P2.11, P2.11g), ported from interfaces/http/email-refresh.ts (P1.20f; the Hono copy goes
// at P1.20k): when the cached confirmation is stale, ask the PDS again through P2.07's pdsSessionInfo and cache a fresh
// answer on this session. A PDS that does not answer is not asked again for the same member for `PDS_HOLD_MS`; during
// a hold the gate hears "transient", exactly what the PDS call would have said. The hold is this process's memory only.
// One change from the Hono copy: /verify-email reads the hold too (`onHold`), because the gate now sends a member past
// the cache cap there instead of drawing that page itself, and that page must not wait out the same PDS call again.
import type { Did, EmailRefresh } from "@unset/domains-identity";
import type { PdsResult, SessionInfo } from "@unset/infrastructure-pds";
import type { Session } from "@unset/infrastructure-session";

export type EmailRefreshDeps = {
  /** P2.07 pdsSessionInfo. On a dead grant it has already ended the DID's sessions (pds-call.ts `authDead`). */
  sessionInfo: (did: Did, deadline: AbortSignal, deadlineAt: number) => Promise<PdsResult<SessionInfo>>;
  setEmailConfirmed: (idHash: Buffer, value: boolean, deadline: AbortSignal) => Promise<void>;
  /** A monotonic clock in milliseconds (`performance.now`) for the hold; never wall time. */
  now: () => number;
};

export type EmailRefresher = {
  refresh: (session: Session, deadline: AbortSignal, deadlineAt: number) => Promise<EmailRefresh>;
  /** True while a PDS that did not answer is not asked again for `did`. */
  onHold: (did: Did) => boolean;
  /** Starts the hold after a transient answer that was not our own lock (verify-email's fresh read). */
  hold: (did: Did, info: PdsResult<SessionInfo>) => void;
};

/** How long one member's recheck is not repeated after the PDS failed to answer. */
export const PDS_HOLD_MS = 30_000;
/** The most members held at once. A full table is emptied, so the cost of overflow is asking the PDS again. */
export const PDS_HOLD_MAX_MEMBERS = 10_000;

export function emailRefresher(deps: EmailRefreshDeps): EmailRefresher {
  const until = new Map<Did, number>();
  const onHold = (did: Did): boolean => {
    const end = until.get(did);
    if (end === undefined) return false;
    if (deps.now() < end) return true;
    until.delete(did);
    return false;
  };
  const hold = (did: Did, info: PdsResult<SessionInfo>): void => {
    // lock_timeout is our own sign-in lock, held by another request of this member: the PDS was not asked.
    if (info.kind !== "transient" || info.code === "lock_timeout") return;
    if (until.size >= PDS_HOLD_MAX_MEMBERS) until.clear();
    until.set(did, deps.now() + PDS_HOLD_MS);
  };
  const refresh = async (session: Session, deadline: AbortSignal, deadlineAt: number): Promise<EmailRefresh> => {
    if (onHold(session.did)) return "transient";
    const info = await deps.sessionInfo(session.did, deadline, deadlineAt);
    switch (info.kind) {
      case "transient":
        hold(session.did, info);
        return "transient";
      case "ok": {
        if (info.value.emailConfirmed === undefined) return "unconfirmed";
        const confirmed = info.value.emailConfirmed;
        await deps.setEmailConfirmed(session.idHash, confirmed, deadline);
        return confirmed ? "confirmed" : "unconfirmed";
      }
      case "auth_dead":
        // The sessions are already gone (pds-call.ts `authDead`): this browser signs in again (P2.11a).
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
  return { refresh, onHold, hold };
}
