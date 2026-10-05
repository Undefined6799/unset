// Rate-limit policies (P1.06; plan §5.2): the shape and its startup check only. The values live with the interface
// that owns the routes (`interfaces/<name>/limits.ts`, P1.06p), so no policy value lives in the kit.

export type PolicyScope = "ip" | "did" | "global";
/** One token bucket: `capacity` requests at once, refilled at `refillPerSec`, keyed by the client's IP, DID or neither. */
export type PolicyEntry = Readonly<{ capacity: number; refillPerSec: number; scope: PolicyScope }>;
/** Every entry must have a token for a request to pass. */
export type Policy = readonly PolicyEntry[];
export type PolicyName = string;
export type PolicyTable = Readonly<Record<PolicyName, Policy>>;

const SCOPES: readonly PolicyScope[] = ["ip", "did", "global"];

function checkEntry(name: PolicyName, entry: PolicyEntry): void {
  const { capacity, refillPerSec, scope } = entry;
  if (!Number.isInteger(capacity) || capacity < 1) throw new Error(`policy ${name}: capacity must be an integer ≥ 1`);
  if (!Number.isFinite(refillPerSec) || refillPerSec <= 0) throw new Error(`policy ${name}: refillPerSec must be > 0`);
  if (!SCOPES.includes(scope)) throw new Error(`policy ${name}: scope must be ip, did or global`);
}

/** The table, checked: it has `default`, and every policy has at least one entry with a positive capacity and rate. */
export function definePolicies(table: PolicyTable): PolicyTable {
  if (!Object.hasOwn(table, "default")) throw new Error("policy table has no default policy");
  for (const [name, policy] of Object.entries(table)) {
    if (!Array.isArray(policy) || policy.length === 0) throw new Error(`policy ${name} has no entries`);
    for (const entry of policy) checkEntry(name, entry);
  }
  return Object.freeze({ ...table });
}

/** Whether a policy limits per DID, which only a route that requires a session can apply (`rateLimitDid`). */
export const hasDidEntry = (policy: Policy): boolean => policy.some((entry) => entry.scope === "did");
