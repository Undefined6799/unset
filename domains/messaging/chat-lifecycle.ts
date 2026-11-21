// The chat account follows the Unset account (ADR 0084). Erasure: core.erase_did keeps an erased member's chat user,
// with no DID, in a queue (migration 0037), and this job asks chat-admin to deactivate each one, which ends every
// session and asks the homeserver to erase the account (decision 3). It retries until chat-admin has done it and never
// gives up (decision 4: chat cannot be forgotten); a row stuck long is counted so the log shows it. Suspension: a
// chat account is locked while its member is not active and unlocked when they are again (decisions 1 and 2). The
// ports are I/O only (rule AB-2).
import type { Did } from "@unset/domains-identity";
import type { DeviceId } from "./browser.ts";
import { type ChatUser, CREATE_CALL_WITHIN_MS, retryDelayS } from "./chat-account.ts";
import type { EndOutcome } from "./door.ts";

/** chat-admin's answer to a lock, unlock or deactivate: done, an account it never made, refused, or no answer. */
export type ChatAccountChange =
  | { readonly kind: "done" }
  | { readonly kind: "no_account" }
  | { readonly kind: "rejected" }
  | { readonly kind: "unavailable" };

/** One claimed erasure: the chat user, the attempts already failed, the lease that fences its writes, and how long
 * ago (seconds, by the database's clock) the erasure queued it. */
export type ChatErasureJob = {
  readonly user: ChatUser;
  readonly attempts: number;
  readonly lease: string;
  readonly queuedForS: number;
};

export type ChatErasurePorts = {
  /** Claims one due erasure under a fresh lease, in a short transaction of its own; null when none is due. */
  readonly claim: () => Promise<ChatErasureJob | null>;
  readonly deactivate: (user: ChatUser) => Promise<ChatAccountChange>;
  /** Deletes the row if the job still holds its lease; false when it no longer does. */
  readonly finish: (job: ChatErasureJob) => Promise<boolean>;
  /** Puts the row back, one attempt more, due in `inS` seconds, if the job still holds its lease. */
  readonly retry: (job: ChatErasureJob, inS: number) => Promise<boolean>;
};

/** After this many failed attempts (about a day at the hourly step) a row counts as stuck, and still retries. */
export const ERASE_STUCK_ATTEMPTS = 24;

/**
 * How long after an erasure a creation claimed before it can still reach MAS: the creation calls within
 * CREATE_CALL_WITHIN_MS of its claim, its envelope lives 60 s and chat-admin refuses it after that before calling MAS
 * (interfaces/chat-admin/server.ts `abandoned`), whose calls end after 5 s (outbound.ts). About two minutes, doubled.
 * Until then an account MAS does not hold may still appear, so "no account" is asked again rather than finished.
 */
export const CREATE_LANDS_WITHIN_S = 2 * (CREATE_CALL_WITHIN_MS / 1000 + 60 + 5);

export type ErasureCounts = { erased: number; retry: number; lost: number; stuck: number };

/**
 * Deactivates up to `limit` due chat accounts, one at a time, each claimed just before its call and settled only if
 * its lease still holds; no transaction or connection is held across the call (rule DA-4). An account chat-admin
 * never made has nothing to erase once no creation can land any more (CREATE_LANDS_WITHIN_S). An unexpected error is
 * not caught: the row keeps its lease and comes back.
 */
export async function eraseDueAccounts(ports: ChatErasurePorts, limit: number): Promise<ErasureCounts> {
  const counts: ErasureCounts = { erased: 0, retry: 0, lost: 0, stuck: 0 };
  for (let n = 0; n < limit; n++) {
    const job = await ports.claim();
    if (job === null) break;
    const answer = await ports.deactivate(job.user);
    const gone = answer.kind === "done" || (answer.kind === "no_account" && job.queuedForS >= CREATE_LANDS_WITHIN_S);
    const kept = gone ? await ports.finish(job) : await ports.retry(job, retryDelayS(job.attempts + 1));
    if (!kept) counts.lost += 1;
    else if (gone) counts.erased += 1;
    else counts.retry += 1;
    if (!gone && job.attempts >= ERASE_STUCK_ATTEMPTS) counts.stuck += 1;
  }
  return counts;
}

/**
 * One claimed state change: lock the account (its member is suspended, deactivated or taken down; ADR 0084 decision
 * 1) or unlock it (active again; decision 2). Lock keeps every session, so no key is lost.
 */
export type ChatLockJob = {
  readonly did: Did;
  readonly user: ChatUser;
  readonly lock: boolean;
  readonly attempts: number;
  readonly lease: string;
};

export type ChatLockPorts = {
  /** Claims one ready account whose lock differs from its member's state, under a fresh lease; null when none. */
  readonly claim: () => Promise<ChatLockJob | null>;
  readonly change: (user: ChatUser, lock: boolean) => Promise<ChatAccountChange>;
  /** Records that chat-admin now holds `job.lock`, if the job still holds its lease. */
  readonly settle: (job: ChatLockJob) => Promise<boolean>;
  readonly retry: (job: ChatLockJob, inS: number) => Promise<boolean>;
};

export type LockCounts = { changed: number; retry: number; lost: number };

/**
 * Brings up to `limit` chat accounts in line with their members' state, one at a time, each claimed just before its
 * call and settled only if its lease still holds (rule DA-4). The state, not an event, says what is due, so a change
 * that happens again before the call is done is caught on the next claim, and a failed call is simply due again.
 */
export async function followAccountStates(ports: ChatLockPorts, limit: number): Promise<LockCounts> {
  const counts: LockCounts = { changed: 0, retry: 0, lost: 0 };
  for (let n = 0; n < limit; n++) {
    const job = await ports.claim();
    if (job === null) break;
    const answer = await ports.change(job.user, job.lock);
    const done = answer.kind === "done";
    const kept = done ? await ports.settle(job) : await ports.retry(job, retryDelayS(job.attempts + 1));
    if (!kept) counts.lost += 1;
    else if (done) counts.changed += 1;
    else counts.retry += 1;
  }
  return counts;
}

/** One claimed device to end: whose, which, the attempts already failed, and the lease that fences its writes. */
export type ChatSessionEndJob = {
  readonly user: ChatUser;
  readonly device: DeviceId;
  readonly attempts: number;
  readonly lease: string;
};

export type ChatSessionEndPorts = {
  /** Claims one due device under a fresh lease; null when none is due. */
  readonly claim: () => Promise<ChatSessionEndJob | null>;
  /** chat-admin's session.end for the device, signed with web's key. */
  readonly end: (user: ChatUser, device: DeviceId) => Promise<EndOutcome>;
  /** Deletes the queued row and the door's entry, with its lock key, if the job still holds its lease. */
  readonly finish: (job: ChatSessionEndJob) => Promise<boolean>;
  readonly retry: (job: ChatSessionEndJob, inS: number) => Promise<boolean>;
};

/** After this many failed attempts (about a day at the hourly step) a device counts as stuck, and still retries. */
export const END_STUCK_ATTEMPTS = 24;

export type EndCounts = { ended: number; retry: number; lost: number; stuck: number };

/**
 * Ends up to `limit` devices queued when web ended a session (ADR 0083 decision 5) or a grant was revoked (ADR 0084
 * decision 7), one at a time, each claimed just before its call and settled only if its lease still holds (rule
 * DA-4). The lock key goes only once the device has ended, so a failure leaves both for the next try; nothing gives
 * up, since a session left running is a member still signed in after logging out.
 */
export async function endDueSessions(ports: ChatSessionEndPorts, limit: number): Promise<EndCounts> {
  const counts: EndCounts = { ended: 0, retry: 0, lost: 0, stuck: 0 };
  for (let n = 0; n < limit; n++) {
    const job = await ports.claim();
    if (job === null) break;
    const done = (await ports.end(job.user, job.device)).kind === "ended";
    const kept = done ? await ports.finish(job) : await ports.retry(job, retryDelayS(job.attempts + 1));
    if (!kept) counts.lost += 1;
    else if (done) counts.ended += 1;
    else counts.retry += 1;
    if (!done && job.attempts >= END_STUCK_ATTEMPTS) counts.stuck += 1;
  }
  return counts;
}
