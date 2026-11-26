// A member's chat account (ADR 0010; ADR 0093 decision 3; build plan step 2). The chat user is an opaque random name,
// drawn once when the member accepts the terms and never derived from the handle or the DID, so a key query cannot
// confirm who has chat. web keeps the DID to chat user mapping; creating the account in MAS is a queued job that
// chat-admin runs, retried here until it is created or can never be. The ports are I/O only (rule AB-2).
import type { Did, Handle } from "@unset/domains-identity";

declare const chatUserBrand: unique symbol;
/** The chat account's username, the MAS localpart: "u" and 20 base32 characters, 100 random bits. */
export type ChatUser = string & { readonly [chatUserBrand]: true };

export const CHAT_USER = /^u[a-z2-7]{20}$/;
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

/**
 * A new chat user from `random` (crypto.randomBytes in production): "u" then lower-case RFC 4648 base32 of 13 bytes,
 * cut to 20 characters. It fits MAS 1.26.0's username rule (crates/handlers/src/admin/v1/users/add.rs
 * `username_valid`: a-z, 0-9 and `=_-./+`, not starting with `_`) and chat-admin's `[a-z0-9]{12,64}`.
 */
export function newChatUser(random: (bytes: number) => Uint8Array): ChatUser {
  let bits = 0;
  let value = 0;
  let out = "u";
  for (const byte of random(13)) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < 21) {
      bits -= 5;
      out += BASE32[(value >>> bits) & 31];
    }
    value &= (1 << bits) - 1;
  }
  return out as ChatUser;
}

export function parseChatUser(raw: unknown): ChatUser | null {
  return typeof raw === "string" && CHAT_USER.test(raw) ? (raw as ChatUser) : null;
}

/** One claimed creation: whose, the stored user, the attempts already failed, and the lease that fences its writes. */
export type ChatAccountJob = {
  readonly did: Did;
  readonly user: ChatUser;
  readonly attempts: number;
  readonly lease: string;
};

/**
 * chat-admin's answer to account.create: `created` (also for an account MAS already holds, so a lost reply retries
 * safely), `taken` (the name is someone else's), `rejected` (our request was malformed), or `unavailable`.
 */
export type ChatAccountCreation =
  | { readonly kind: "created" }
  | { readonly kind: "taken" }
  | { readonly kind: "rejected" }
  | { readonly kind: "unavailable" };

export type JobSettlement =
  | { readonly state: "ready" }
  | { readonly state: "failed" }
  | { readonly state: "pending"; readonly retryInS: number };

export type ChatAccountPorts = {
  /** Claims one due job under a fresh lease, in a short transaction of its own; null when none is due. */
  readonly claim: () => Promise<ChatAccountJob | null>;
  /** The member's handle when verifyHandle verifies it now, else null. */
  readonly verifiedHandle: (did: Did) => Promise<Handle | null>;
  readonly create: (user: ChatUser, name: Handle) => Promise<ChatAccountCreation>;
  /** Writes the outcome if the job still holds its lease; false when it no longer does (erased, or re-claimed). */
  readonly settle: (job: ChatAccountJob, settlement: JobSettlement) => Promise<boolean>;
  /** A monotonic clock in milliseconds (performance.now in production). */
  readonly nowMs: () => number;
};

/**
 * The longest a job may take from its claim to its create call; one slower is not sent and waits for the next claim.
 * A claim only finds a member not yet erased, so this bounds how late a create can still reach MAS after an erasure
 * (chat-lifecycle.ts CREATE_LANDS_WITHIN_S).
 */
export const CREATE_CALL_WITHIN_MS = 60_000;

/** After this many failed attempts (about a day at the hourly step) the job stops and needs an operator. */
export const MAX_ATTEMPTS = 24;
/**
 * After this many failed attempts (about 12 minutes at the first three steps) the signup step stops saying "getting
 * ready" and says setup is stuck, while the job keeps trying (Alex's staging list, 2026-11-23, item 8).
 */
export const STALLED_AFTER_ATTEMPTS = 3;
const BACKOFF_S = [30, 120, 600, 3600] as const;

/** The wait after the `attempts`-th failure (1-based). */
export const retryDelayS = (attempts: number): number => BACKOFF_S[Math.min(attempts, BACKOFF_S.length) - 1] ?? 3600;

function retry(job: ChatAccountJob): JobSettlement {
  const attempts = job.attempts + 1;
  return attempts >= MAX_ATTEMPTS ? { state: "failed" } : { state: "pending", retryInS: retryDelayS(attempts) };
}

/**
 * What one job comes to, and whether it waits for its handle. The display name is the verified handle; with none,
 * nothing is sent and the job waits.
 */
async function settlementFor(
  ports: ChatAccountPorts,
  job: ChatAccountJob,
): Promise<{ settlement: JobSettlement; unverified: boolean }> {
  const claimedAt = ports.nowMs();
  const handle = await ports.verifiedHandle(job.did);
  if (handle === null) return { settlement: retry(job), unverified: true };
  if (ports.nowMs() - claimedAt > CREATE_CALL_WITHIN_MS) return { settlement: retry(job), unverified: false };
  const answer = await ports.create(job.user, handle);
  if (answer.kind === "created") return { settlement: { state: "ready" }, unverified: false };
  if (answer.kind === "unavailable") return { settlement: retry(job), unverified: false };
  return { settlement: { state: "failed" }, unverified: false };
}

/** Per run; `unverified` counts the jobs that waited because the member's handle did not verify both ways. */
export type CreationCounts = { ready: number; retry: number; failed: number; lost: number; unverified: number };

/**
 * Creates up to `limit` due chat accounts, one at a time. Each job is claimed just before its call, so a lease only
 * has to outlast one job; it is called with no transaction or connection held (rule DA-4), then settled only if its
 * lease still holds. An unexpected error is not caught: the job keeps its lease and is claimed again when it lapses.
 */
export async function createDueAccounts(ports: ChatAccountPorts, limit: number): Promise<CreationCounts> {
  const counts: CreationCounts = { ready: 0, retry: 0, failed: 0, lost: 0, unverified: 0 };
  for (let n = 0; n < limit; n++) {
    const job = await ports.claim();
    if (job === null) break;
    const { settlement, unverified } = await settlementFor(ports, job);
    if (unverified) counts.unverified += 1;
    if (!(await ports.settle(job, settlement))) counts.lost += 1;
    else if (settlement.state === "pending") counts.retry += 1;
    else counts[settlement.state] += 1;
  }
  return counts;
}
