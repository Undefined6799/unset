// The door's browser list (ADR 0081 decision 4; ADR 0083 decision 4): which chat device each browser holds for each
// account signed in on it, and the storage lock key that opens that device's local key store. A browser is named by a
// random value in the door's own cookie and kept only as its sha256, so a stored row is not a cookie. Rows are per
// browser and account: a second account on the same browser gets its own device and key, and the first stays locked
// (ADR 0083). The list is a port; infrastructure/postgres keeps it, with the lock key sealed (ADR 0081 decision 4).
import type { Did } from "@unset/domains-identity";
import type { ChatUser } from "./chat-account.ts";
import type { SessionRef } from "./sign-in.ts";

declare const deviceBrand: unique symbol;
/** A Matrix device ID as chat-admin makes it: 10 of A-Z0-9 (interfaces/chat-admin/commands.ts newDeviceId). */
export type DeviceId = string & { readonly [deviceBrand]: true };
declare const browserBrand: unique symbol;
/** sha256 of the door cookie's 32 random bytes: the browser, as the list names it. */
export type BrowserKey = Uint8Array & { readonly [browserBrand]: true };
declare const lockBrand: unique symbol;
/** 32 random bytes the chat page passes to matrix-js-sdk 43.0.0 `initRustCrypto({ storageKey })` (ADR 0083). */
export type LockKey = Uint8Array & { readonly [lockBrand]: true };

export const DEVICE_ID = /^[A-Z0-9]{10}$/;
export const LOCK_KEY_BYTES = 32;

export function parseDeviceId(raw: unknown): DeviceId | null {
  return typeof raw === "string" && DEVICE_ID.test(raw) ? (raw as DeviceId) : null;
}

/** One account on one browser. `id` is the row's own key, which the lock key's seal is bound to. */
export type BrowserEntry = {
  readonly id: string;
  readonly did: Did;
  readonly user: ChatUser;
  readonly device: DeviceId;
  readonly lockKey: LockKey;
};

export type BrowserList = {
  /** The entry for `did` on `browser`, or null. */
  find(browser: BrowserKey, did: Did, deadline: AbortSignal): Promise<BrowserEntry | null>;
  /** The entry holding `device` on `browser`, or null: a device is only ever found through its own browser. */
  findDevice(browser: BrowserKey, device: DeviceId, deadline: AbortSignal): Promise<BrowserEntry | null>;
  /** Adds a new entry; `taken` when `browser` already holds one for that account (a concurrent sign-in won). */
  add(browser: BrowserKey, entry: BrowserEntry, sid: SessionRef, deadline: AbortSignal): Promise<"added" | "taken">;
  /** Records a renewal on the entry's own device from web session `sid`; false when the entry is gone or changed. */
  renew(entry: BrowserEntry, sid: SessionRef, deadline: AbortSignal): Promise<boolean>;
  /** Whether web session `sid` is the one that last added or renewed the entry; false when the entry is gone. */
  signedInFrom(entry: BrowserEntry, sid: SessionRef, deadline: AbortSignal): Promise<boolean>;
  /** Deletes the entry and its lock key; deleting one already gone is no error. */
  remove(entry: BrowserEntry, deadline: AbortSignal): Promise<void>;
  /** Whether `browser` still holds any entry. */
  holdsAny(browser: BrowserKey, deadline: AbortSignal): Promise<boolean>;
};
