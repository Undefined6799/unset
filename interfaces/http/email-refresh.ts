// The email gate's refresh (P2.11, wired by P2.12): when the cached confirmation is stale, ask the PDS again through
// P2.07's pdsSessionInfo and cache a fresh answer on this session. The gate in app-gate.ts turns the answer into a
// redirect; the decision of when to ask is `emailGate` in the identity domain.
import type { Did } from "@unset/domains-identity";
import type { PdsResult, SessionInfo } from "@unset/infrastructure-pds";
import type { AppGate } from "./app-gate.ts";

export type EmailRefreshDeps = {
  /** P2.07 pdsSessionInfo. On a dead grant it has already ended the DID's sessions (pds-call.ts `authDead`). */
  sessionInfo: (did: Did, deadline: AbortSignal) => Promise<PdsResult<SessionInfo>>;
  setEmailConfirmed: (idHash: Buffer, value: boolean, deadline: AbortSignal) => Promise<void>;
};

export function emailRefresh(deps: EmailRefreshDeps): AppGate["refreshEmail"] {
  return async (session, deadline) => {
    const info = await deps.sessionInfo(session.did, deadline);
    switch (info.kind) {
      case "transient":
        return "transient";
      case "ok": {
        if (info.value.emailConfirmed === undefined) return "unconfirmed";
        const confirmed = info.value.emailConfirmed;
        await deps.setEmailConfirmed(session.idHash, confirmed, deadline);
        return confirmed ? "confirmed" : "unconfirmed";
      }
      case "auth_dead":
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
