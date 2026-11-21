// The commands (ADR 0081 decision 1, ADR 0084; build plan steps 2 and 4), after the envelope has passed. MAS is the record of
// which device IDs exist: a new browser gets an ID no session of the account ever held, and a renewal only names a
// device that still has a live session, so an ended device is never revived. Expected failures are results.
import { randomInt } from "node:crypto";
import type { AccountVerb, ChatUser, DeviceId, DisplayName } from "./envelope.ts";
import { type Mas, MasUnavailable } from "./mas.ts";

/** The one scope a chat session gets; never taken from a caller (an admin client can mint any scope, urn:mas:admin
 * included, so this constant is what keeps a minted token to the client API of one device). */
export const sessionScope = (device: DeviceId): string => `urn:matrix:client:api:* urn:matrix:client:device:${device}`;

export type Result<T> =
  | ({ readonly kind: "ok" } & T)
  | { readonly kind: "refused"; readonly status: 403 | 409; readonly reason: string }
  | { readonly kind: "unavailable"; readonly reason: string };

/** Why the request should stop before its next write (its envelope expired, its caller hung up), or null. */
export type Abandoned = () => string | null;

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const DEVICE_TRIES = 3;

/** 10 characters from A-Z0-9, each from crypto.randomInt, a CSPRNG without modulo bias (Node 26 docs,
 * https://nodejs.org/docs/latest-v26.x/api/crypto.html#cryptorandomintmin-max-callback). */
export const newDeviceId = (): DeviceId =>
  Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("") as DeviceId;

async function guarded<T>(work: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof MasUnavailable) return { kind: "unavailable", reason: `mas_${error.message}` };
    throw error;
  }
}
const refused = (status: 403 | 409, reason: string) => ({ kind: "refused", status, reason }) as const;

/** Creates the account; a retry for an account MAS already holds is success, a name it reserved is refused. */
export const createAccount = (mas: Mas, user: ChatUser, name: DisplayName): Promise<Result<{ created: boolean }>> =>
  guarded<{ created: boolean }>(async () => {
    if ((await mas.createUser(user, name)) === "created") return { kind: "ok", created: true };
    // 409 is UserAlreadyExists or UsernameReserved (MAS 1.26.0 handlers admin/v1/users/add.rs); only a user tells.
    return (await mas.findUser(user)) === null ? refused(409, "username_taken") : { kind: "ok", created: false };
  });

type Minted = { token: string; device: DeviceId; expiresIn: number };

/** Mints a session: on a fresh device, or (renewal) on `device`, minting before revoking so the device stays. */
export const mintSession = (
  mas: Mas,
  ttl: number,
  user: ChatUser,
  device: DeviceId | null,
  abandoned: Abandoned,
): Promise<Result<Minted>> =>
  guarded<Minted>(async () => {
    const account = await mas.findUser(user);
    if (account === null) return refused(409, "no_account");
    if (account.locked || account.deactivated) return refused(403, "account_inactive");
    const target = device === null ? await unusedDevice(mas, account.id) : await liveDevice(mas, account.id, device);
    if (target.kind !== "ok") return target;
    const gone = abandoned();
    if (gone !== null) return refused(403, gone);
    const { token } = await mas.mint(account.id, sessionScope(target.device), ttl);
    for (const id of target.old) await mas.revoke(id);
    return { kind: "ok", token, device: target.device, expiresIn: ttl };
  });

type Target = Result<{ device: DeviceId; old: readonly string[] }>;

/** A renewal's device: only one that still has a live session, whose sessions are revoked after the new mint. */
async function liveDevice(mas: Mas, userId: string, device: DeviceId): Promise<Target> {
  const old = await mas.sessions(userId, device, "active");
  return old.length === 0 ? refused(409, "device_ended") : { kind: "ok", device, old };
}

/** A new browser's device: an ID no session of this account has ever held, so none is reused after a revoke. */
async function unusedDevice(mas: Mas, userId: string): Promise<Target> {
  for (let i = 0; i < DEVICE_TRIES; i++) {
    const candidate = newDeviceId();
    if ((await mas.sessions(userId, candidate, "ever")).length === 0) return { kind: "ok", device: candidate, old: [] };
  }
  return { kind: "unavailable", reason: "device_collision" };
}

/** Ends every live session on `device`, which removes the device; safe to repeat. */
export const endSessions = (mas: Mas, user: ChatUser, device: DeviceId): Promise<Result<{ ended: number }>> =>
  guarded<{ ended: number }>(async () => {
    const account = await mas.findUser(user);
    if (account === null) return { kind: "ok", ended: 0 };
    const live = await mas.sessions(account.id, device, "active");
    for (const id of live) await mas.revoke(id);
    return { kind: "ok", ended: live.length };
  });

const CALLS = { "account.lock": "lock", "account.unlock": "unlock", "account.deactivate": "deactivate" } as const;
type AccountAnswer = { locked: boolean } | { deactivated: boolean };

/**
 * Lock, unlock or deactivate the account (ADR 0084 decisions 1 to 3); each is safe to repeat. Lock keeps every session,
 * so no key is lost; deactivate ends them and asks the homeserver to erase. An account MAS never made is already gone
 * for a deactivate and 409 for the others. There is no reactivate (decision 5).
 */
export const changeAccount = (mas: Mas, user: ChatUser, verb: AccountVerb): Promise<Result<AccountAnswer>> =>
  guarded<AccountAnswer>(async () => {
    const account = await mas.findUser(user);
    if (account === null)
      return verb === "account.deactivate" ? { kind: "ok", deactivated: false } : refused(409, "no_account");
    await mas.setState(account.id, CALLS[verb]);
    return verb === "account.deactivate"
      ? { kind: "ok", deactivated: true }
      : { kind: "ok", locked: verb === "account.lock" };
  });
