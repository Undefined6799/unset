// The door's rules (build step 6; ADR 0081 decision 4, ADR 0083 decisions 4 and 5; security pass finding 8). Redeem
// checks, in order, that this browser holds the hop's one-time value, that it is the ticket's, and that the ticket is
// still alive, all before chat-admin is asked; chat-admin then checks web's signature and burns the jti, so a replay
// fails there even if a browser kept its value. The ticket's DID chooses only which of this browser's entries to
// renew; it is trusted for the entry it writes only once chat-admin has accepted the signature over it. An entry keeps
// its device and lock key for good (expiry locks; the next sign-in reopens with no unlock). Log out ends the device
// first and forgets the key only then, so a failure leaves the entry for another try.
import { timingSafeEqual } from "node:crypto";
import { type Did, parseDid } from "@unset/domains-identity";
import type { BrowserEntry, BrowserKey, BrowserList, DeviceId, LockKey } from "./browser.ts";
import { type ChatUser, parseChatUser } from "./chat-account.ts";
import { type DoorState, parseDoorState, type SessionRef } from "./sign-in.ts";

declare const tokenBrand: unique symbol;
/** A chat access token as chat-admin returns it; only the browser it was minted for ever sees it. */
export type AccessToken = string & { readonly [tokenBrand]: true };

/** web's ticket as the door reads it: the envelope for chat-admin, untouched, and the payload fields the door uses. */
export type Ticket = {
  readonly envelope: Readonly<Record<string, unknown>>;
  readonly did: Did;
  readonly user: ChatUser;
  readonly sid: SessionRef;
  readonly state: DoorState;
  readonly exp: number;
};

const SID = /^[A-Za-z0-9_-]{43}$/;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** base64url of the envelope's JSON (interfaces/web chat-sign-in.ts), parsed once; null for anything else. */
export function readTicket(encoded: string): Ticket | null {
  let envelope: unknown;
  try {
    envelope = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!isRecord(envelope) || !isRecord(envelope.payload) || envelope.payload.verb !== "session.mint") return null;
  const { did, user, sid, state, exp } = envelope.payload;
  const parsed = {
    did: typeof did === "string" ? parseDid(did) : null,
    user: parseChatUser(user),
    state: typeof state === "string" ? parseDoorState(state) : null,
  };
  if (parsed.did === null || parsed.user === null || parsed.state === null) return null;
  if (typeof sid !== "string" || !SID.test(sid) || typeof exp !== "number" || !Number.isSafeInteger(exp)) return null;
  return { envelope, did: parsed.did, user: parsed.user, sid: sid as SessionRef, state: parsed.state, exp };
}

/** chat-admin's answer to a mint: a session, a device it no longer has, a refusal, or no answer. */
export type MintOutcome =
  | { readonly kind: "minted"; readonly token: AccessToken; readonly device: DeviceId; readonly expiresInS: number }
  | { readonly kind: "device_ended" }
  | { readonly kind: "refused" }
  | { readonly kind: "unavailable" };
export type EndOutcome = { readonly kind: "ended" } | { readonly kind: "unavailable" };

export type DoorPorts = {
  readonly list: BrowserList;
  /** session.mint with web's ticket, on `device` for a renewal or a new one for null. */
  readonly mint: (envelope: Ticket["envelope"], device: DeviceId | null, deadline: AbortSignal) => Promise<MintOutcome>;
  /** session.end signed with the door's own key, for a device in its browser list. */
  readonly end: (user: ChatUser, device: DeviceId, deadline: AbortSignal) => Promise<EndOutcome>;
  readonly newLockKey: () => LockKey;
  readonly newId: () => string;
  readonly nowS: () => number;
};

export type RedeemRefusal =
  | "chat.no_state"
  | "chat.state_mismatch"
  | "chat.ticket_expired"
  | "chat.ticket_refused"
  | "chat.device_ended"
  | "chat.busy"
  | "chat.unavailable";
export type RedeemOutcome =
  | {
      readonly kind: "signed_in";
      readonly entry: BrowserEntry;
      readonly token: AccessToken;
      readonly expiresAtS: number;
      /** True when this browser had no entry for the account: anything it kept for the account is from an ended
       * device, whose lock key no longer exists, so the page wipes it (ADR 0083 decision 5). */
      readonly newDevice: boolean;
    }
  | { readonly kind: "refused"; readonly code: RedeemRefusal };

type Request = {
  readonly ticket: Ticket;
  /** The one-time value in this browser's cookie, or null. */
  readonly state: DoorState | null;
  readonly browser: BrowserKey;
  readonly deadline: AbortSignal;
};

const refused = (code: RedeemRefusal): RedeemOutcome => ({ kind: "refused", code });
const sameState = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function redeem(ports: DoorPorts, request: Request): Promise<RedeemOutcome> {
  const { ticket, browser, deadline } = request;
  if (request.state === null) return refused("chat.no_state");
  if (!sameState(request.state, ticket.state)) return refused("chat.state_mismatch");
  if (ticket.exp < ports.nowS()) return refused("chat.ticket_expired");
  const existing = await ports.list.find(browser, ticket.did, deadline);
  if (existing !== null && existing.user !== ticket.user) return refused("chat.ticket_refused");
  const minted = await ports.mint(ticket.envelope, existing?.device ?? null, deadline);
  if (minted.kind === "device_ended" && existing !== null) await ports.list.remove(existing, deadline);
  if (minted.kind !== "minted")
    return refused(minted.kind === "refused" ? "chat.ticket_refused" : `chat.${minted.kind}`);
  const entry = await keep(ports, request, existing, minted.device);
  if (entry.kind === "refused") {
    await ports.end(ticket.user, minted.device, deadline);
    return entry;
  }
  const expiresAtS = ports.nowS() + minted.expiresInS;
  return { kind: "signed_in", entry: entry.entry, token: minted.token, expiresAtS, newDevice: existing === null };
}

/** Writes what a mint on `device` means for the list: the renewed entry, or a new one (rule DA-4: one statement). */
async function keep(
  ports: DoorPorts,
  { ticket, browser, deadline }: Request,
  existing: BrowserEntry | null,
  device: DeviceId,
): Promise<{ kind: "kept"; entry: BrowserEntry } | { kind: "refused"; code: RedeemRefusal }> {
  if (existing !== null) {
    // chat-admin mints a renewal on the device it was given; any other answer is a fault, never a new key.
    if (device !== existing.device) return { kind: "refused", code: "chat.unavailable" };
    const renewed = await ports.list.renew(existing, ticket.sid, deadline);
    return renewed ? { kind: "kept", entry: existing } : { kind: "refused", code: "chat.busy" };
  }
  const entry = { id: ports.newId(), did: ticket.did, user: ticket.user, device, lockKey: ports.newLockKey() };
  const added = await ports.list.add(browser, entry, ticket.sid, deadline);
  return added === "added" ? { kind: "kept", entry } : { kind: "refused", code: "chat.busy" };
}

export type SignOutRedeemOutcome =
  | {
      readonly kind: "minted";
      readonly entry: BrowserEntry;
      readonly token: AccessToken;
      readonly expiresAtS: number;
    }
  | { readonly kind: "no_session" }
  | { readonly kind: "refused"; readonly code: Exclude<RedeemRefusal, "chat.no_state" | "chat.state_mismatch"> };

/**
 * unset.sh's Log out reaching this browser (ADR 0083 decision 5): web ended the session, queued its devices to end, and
 * signed a ticket for the ended session, which carries no one-time value this browser holds. The ticket is spent only
 * on the entry this browser already holds for its member, and only if that session is the one that last signed the
 * entry in, so a Log out in one browser cannot log out another browser of the same member: a session on that device,
 * so the page can wait for the key backup and then Log out. It never makes a device and never renews the entry, so web's queued end stays due and fires
 * if the page never finishes. chat-admin checks web's signature and burns the jti, as at sign-in.
 */
export async function redeemForSignOut(
  ports: DoorPorts,
  { ticket, browser, deadline }: Omit<Request, "state">,
): Promise<SignOutRedeemOutcome> {
  if (ticket.exp < ports.nowS()) return { kind: "refused", code: "chat.ticket_expired" };
  const entry = await ports.list.find(browser, ticket.did, deadline);
  if (entry === null) return { kind: "no_session" };
  if (entry.user !== ticket.user) return { kind: "refused", code: "chat.ticket_refused" };
  if (!(await ports.list.signedInFrom(entry, ticket.sid, deadline)))
    return { kind: "refused", code: "chat.ticket_refused" };
  const minted = await ports.mint(ticket.envelope, entry.device, deadline);
  if (minted.kind === "device_ended") await ports.list.remove(entry, deadline);
  if (minted.kind === "refused") return { kind: "refused", code: "chat.ticket_refused" };
  if (minted.kind !== "minted") return { kind: "refused", code: `chat.${minted.kind}` };
  // chat-admin mints on the device it was given; any other answer is a fault, and that device is ended at once.
  if (minted.device !== entry.device) {
    await ports.end(ticket.user, minted.device, deadline);
    return { kind: "refused", code: "chat.unavailable" };
  }
  return { kind: "minted", entry, token: minted.token, expiresAtS: ports.nowS() + minted.expiresInS };
}

export type SignOutOutcome =
  | { readonly kind: "signed_out"; readonly browserEmpty: boolean }
  | { readonly kind: "unavailable" };

/** Log out of `device` on `browser`; a device this browser does not hold is already out, and nothing is ended. */
export async function signOut(
  ports: DoorPorts,
  { browser, device, deadline }: { browser: BrowserKey; device: DeviceId; deadline: AbortSignal },
): Promise<SignOutOutcome> {
  const entry = await ports.list.findDevice(browser, device, deadline);
  if (entry !== null) {
    if ((await ports.end(entry.user, entry.device, deadline)).kind === "unavailable") return { kind: "unavailable" };
    await ports.list.remove(entry, deadline);
  }
  return { kind: "signed_out", browserEmpty: !(await ports.list.holdsAny(browser, deadline)) };
}
