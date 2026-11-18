// The web process's rate-limit policies, as interfaces/http/limits.ts has them for the routes that exist today
// (P1.06p; plan section 5.2; ADR 0042). Each entry is a token bucket: `capacity` at once, refilled at `refillPerSec`.
// A page names one of these in its policy.ts; a page that needs a new policy adds it here.
import { definePolicies, type PolicyTable } from "@unset/shared-http";

export const policies = definePolicies({
  default: [
    { capacity: 60, refillPerSec: 300 / 60, scope: "ip" },
    { capacity: 3000, refillPerSec: 3000 / 60, scope: "global" },
  ],
  // A profile save writes to the member's PDS: the page limits, and 30 a minute for one member whatever their address.
  profile: [
    { capacity: 60, refillPerSec: 300 / 60, scope: "ip" },
    { capacity: 3000, refillPerSec: 3000 / 60, scope: "global" },
    { capacity: 30, refillPerSec: 30 / 60, scope: "did" },
  ],
  login: [{ capacity: 10, refillPerSec: 10 / 60, scope: "ip" }],
});

export type PolicyName = keyof typeof policies & string;

/** The site-wide ceiling on sign-in steps when the edge is the per-client layer (ADR 0042). */
const SIGN_IN_CEILING = { capacity: 120, refillPerSec: 120 / 60, scope: "global" } as const;

/**
 * The table without its per-address entries, for socket mode (ADR 0042): behind the edge every request has the edge's
 * address, so an `ip` entry would be one bucket for everyone. `login` gets the sign-in ceiling; per-DID entries stay.
 */
function withoutAddressEntries(table: PolicyTable): PolicyTable {
  const kept = Object.entries(table).map(([name, policy]) => {
    const entries = policy.filter((entry) => entry.scope !== "ip");
    return [name, name === "login" ? [...entries, SIGN_IN_CEILING] : entries] as const;
  });
  return definePolicies(Object.fromEntries(kept));
}

/** Per address in `header` mode (the edge names the client); ceilings only in `socket` mode. */
export const policiesFor = (mode: "header" | "socket"): PolicyTable =>
  mode === "socket" ? withoutAddressEntries(policies) : policies;
