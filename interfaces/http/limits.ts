// The web server's rate-limit policies (P1.06p; plan §5.2, values from the book's P1.06). Each entry is a token
// bucket: `capacity` requests at once, refilled at `refillPerSec`. "N per minute" is capacity N refilled at N/60 per
// second; `default` per IP allows a burst of 60 at 300 per minute. Per-DID entries apply only on routes that require a
// session. A feature step adds its own policy here, in the same PR as its route.
import { definePolicies, type PolicyTable } from "@unset/shared-http";

export const policies = definePolicies({
  default: [
    { capacity: 60, refillPerSec: 300 / 60, scope: "ip" },
    { capacity: 3000, refillPerSec: 3000 / 60, scope: "global" },
  ],
  login: [{ capacity: 10, refillPerSec: 10 / 60, scope: "ip" }],
  search: [
    { capacity: 60, refillPerSec: 60 / 60, scope: "ip" },
    { capacity: 60, refillPerSec: 60 / 60, scope: "did" },
  ],
  report: [
    { capacity: 5, refillPerSec: 5 / 60, scope: "ip" },
    { capacity: 10, refillPerSec: 10 / 60, scope: "did" },
  ],
  follow: [{ capacity: 120, refillPerSec: 120 / 60, scope: "did" }],
  like: [{ capacity: 120, refillPerSec: 120 / 60, scope: "did" }],
  // The daily upload cap is a database counter (P4.03), not a bucket.
  upload: [{ capacity: 10, refillPerSec: 10 / 60, scope: "did" }],
});

/**
 * The site-wide ceiling on sign-in steps (`POST /login`, `/oauth/callback`, `POST /verify-email/reconsent`) when the
 * edge is the per-client layer (ADR 0042): 120 at once, refilled at 120 per minute, about 60 complete sign-ins a
 * minute. The edge's `app_signin` zone holds one client to 5 per 5 minutes (deployment/edge/limits.json), so it takes
 * about 120 addresses at their full allowance to hold this bucket empty.
 */
const SIGN_IN_CEILING = { capacity: 120, refillPerSec: 120 / 60, scope: "global" } as const;

/**
 * The table without its per-address entries, for a server that is told no client address (ADR 0042). Behind the edge
 * in socket mode every request has the edge's address, so an `ip` entry is one bucket shared by all visitors: a few
 * clients inside their edge allowance empty it for everyone. The edge limits each client; this table is the ceiling
 * behind it. `default` keeps its `global` entry, `login` gets the sign-in ceiling, and the per-DID entries stay.
 */
function withoutAddressEntries(table: PolicyTable): PolicyTable {
  const kept = Object.entries(table).map(([name, policy]) => {
    const entries = policy.filter((entry) => entry.scope !== "ip");
    return [name, name === "login" ? [...entries, SIGN_IN_CEILING] : entries] as const;
  });
  return definePolicies(Object.fromEntries(kept));
}

const ceilings = withoutAddressEntries(policies);

/**
 * The table for how this server learns the client address (`TRUSTED_PROXY_MODE`, shared/http/config.ts): per address
 * in `header` mode, where a trusted proxy names the client; ceilings only in `socket` mode, where the address is the
 * peer's and, behind the edge, the same for everyone.
 */
export const policiesFor = (mode: "header" | "socket"): PolicyTable => (mode === "socket" ? ceilings : policies);
