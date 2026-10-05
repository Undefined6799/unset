// The rate-limit primitive (P1.06; plan §5.2, §6): token buckets held only in process memory, under keys that are a
// salted HMAC of the client's IP rate key or DID, so the map is never a record of who visited. The salt is 32 random
// bytes, replaced every 24 h; it is never written, logged or exported.
import { createHmac, randomBytes } from "node:crypto";
import type { ClientIp } from "../clientIp.ts";
import { definePolicies, type PolicyEntry, type PolicyName, type PolicyTable } from "./policy.ts";

export type RateSubject = { ip: ClientIp | null } | { did: string };
export type RateVerdict = { ok: true } | { ok: false; retryAfterS: number };

export type RateLimiterOptions = {
  /** RATE_LIMIT_MAX_KEYS: past it, a new key shares its policy's strict overflow bucket instead of being added. */
  maxKeys: number;
  /** Called when `consume` fails and denies (it logs `ratelimit.error`). */
  onError: () => void;
  /** Milliseconds; injectable for tests. */
  now?: () => number;
};

type Bucket = { tokens: number; lastRefill: number; lastSeen: number; capacity: number; refillPerSec: number };

const SALT_TTL_MS = 24 * 60 * 60 * 1000;
/** A bucket is swept once it has refilled and stood idle this long (the plan's 60 s TTL). */
const IDLE_MS = 60_000;
/** The unknown client and the overflow bucket get a tenth of the policy's capacity, at least 1. */
const strict = (capacity: number) => Math.max(1, Math.floor(capacity / 10));

export function createRateLimiter(table: PolicyTable, options: RateLimiterOptions) {
  const policies = definePolicies(table);
  const now = options.now ?? (() => performance.now());
  const buckets = new Map<string, Bucket>();
  const overflow = new Map<string, Bucket>();
  let salt = randomBytes(32);
  let saltAt = now();

  const pseudonym = (text: string) => createHmac("sha256", salt).update(text).digest("base64url").slice(0, 22);

  /** Step 1: the bucket key and capacity for one entry, or none when the entry's scope is not this subject's. */
  function keyFor(prefix: string, entry: PolicyEntry, subject: RateSubject): { key: string; capacity: number } | null {
    if (entry.scope === "global") return "ip" in subject ? { key: `${prefix}g`, capacity: entry.capacity } : null;
    if (entry.scope === "did")
      return "did" in subject ? { key: `${prefix}did:${pseudonym(subject.did)}`, capacity: entry.capacity } : null;
    if (!("ip" in subject)) return null;
    if (subject.ip === null) return { key: `${prefix}ip:unknown`, capacity: strict(entry.capacity) };
    return { key: `${prefix}ip:${pseudonym(subject.ip.rateKey())}`, capacity: entry.capacity };
  }

  /** Step 2: the bucket, refilled to `at`. A new key past the cap shares the entry's strict overflow bucket. */
  function bucketFor(key: string, prefix: string, capacity: number, entry: PolicyEntry, at: number): Bucket {
    let bucket = buckets.get(key);
    if (bucket === undefined) {
      const full = (cap: number) => ({
        tokens: cap,
        lastRefill: at,
        lastSeen: at,
        capacity: cap,
        refillPerSec: entry.refillPerSec,
      });
      if (buckets.size < options.maxKeys) {
        bucket = full(capacity);
        buckets.set(key, bucket);
      } else {
        bucket = overflow.get(prefix) ?? full(strict(entry.capacity));
        overflow.set(prefix, bucket);
      }
    }
    const elapsedS = Math.max(0, at - bucket.lastRefill) / 1000; // a clock that jumps back refills nothing
    bucket.tokens = Math.min(bucket.capacity, bucket.tokens + elapsedS * bucket.refillPerSec);
    bucket.lastRefill = at;
    return bucket;
  }

  /** Steps 1–4: deny if any of the subject's buckets is empty, consuming from none; else take one token from each. */
  function take(policy: PolicyName, subject: RateSubject): RateVerdict {
    const at = now();
    const entries = policies[policy] ?? [];
    const held = entries.flatMap((entry, i) => {
      const prefix = `${policy}#${i}:`;
      const found = keyFor(prefix, entry, subject);
      return found ? [bucketFor(found.key, prefix, found.capacity, entry, at)] : [];
    });
    const empty = held.find((bucket) => bucket.tokens < 1);
    if (empty) return { ok: false, retryAfterS: Math.max(1, Math.ceil((1 - empty.tokens) / empty.refillPerSec)) };
    for (const bucket of held) {
      bucket.tokens -= 1;
      bucket.lastSeen = at;
    }
    return { ok: true };
  }

  return {
    /** One request by `subject` under `policy`. An unknown policy name is a bug and throws; any other error denies. */
    consume(policy: PolicyName, subject: RateSubject): RateVerdict {
      if (!Object.hasOwn(policies, policy)) throw new Error(`unknown rate-limit policy: ${policy}`);
      try {
        return take(policy, subject);
      } catch {
        options.onError();
        return { ok: false, retryAfterS: 1 }; // fail closed (OWASP A10)
      }
    },
    /**
     * Steps 5–6, run every 10 s: drop a bucket only once refill alone has filled it and it has been idle 60 s, so a
     * pause never resets a longer window; every 24 h, replace the salt and clear the map.
     */
    sweep(): void {
      const at = now();
      if (at - saltAt >= SALT_TTL_MS) {
        salt = randomBytes(32);
        saltAt = at;
        buckets.clear();
        overflow.clear();
        return;
      }
      for (const [key, b] of buckets) {
        const refilled = Math.max(0, at - b.lastRefill) / 1000 >= (b.capacity - b.tokens) / b.refillPerSec;
        if (refilled && at - b.lastSeen > IDLE_MS) buckets.delete(key);
      }
    },
    /** The current bucket keys (tests and diagnostics): pseudonyms only, never an address or a DID. */
    keys: (): string[] => [...buckets.keys()],
  };
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;
