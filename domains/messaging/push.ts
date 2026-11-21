// The chat count (build step 10; ADR 0082, ADR 0090): the number of chats with new messages that unset.sh shows on its
// chat icon. The chat page registers a pusher with a key the door issued to its browser entry, so the homeserver tells
// the door the member's number and nothing else; the door keeps the latest one. A browser gets a key only through the
// device it holds (rule SE-2), a new key replaces its last one, and only the key's sha256 is kept, so a stored row is
// not a key. A notification for a key the door does not hold is rejected, which makes the homeserver drop that pusher
// (Matrix spec v1.18 push gateway API, `rejected`). The member is never named by the key: the store finds the member
// through the entry.
import { createHash } from "node:crypto";
import type { Did } from "@unset/domains-identity";
import type { BrowserEntry, BrowserKey, BrowserList, DeviceId } from "./browser.ts";

declare const pushKeyBrand: unique symbol;
/** 32 random bytes in base64url: the pushkey of one browser entry's pusher. */
export type PushKey = string & { readonly [pushKeyBrand]: true };
declare const pushHashBrand: unique symbol;
/** sha256 of a pushkey, as the door keeps it. */
export type PushKeyHash = Uint8Array & { readonly [pushHashBrand]: true };

const PUSH_KEY = /^[A-Za-z0-9_-]{43}$/;
/** The largest number kept: Postgres `integer`. */
export const MAX_COUNT = 2 ** 31 - 1;

export function parsePushKey(raw: unknown): PushKey | null {
  return typeof raw === "string" && PUSH_KEY.test(raw) ? (raw as PushKey) : null;
}

export const pushKeyHash = (key: PushKey): PushKeyHash =>
  new Uint8Array(createHash("sha256").update(key).digest()) as PushKeyHash;

export type PushKeys = {
  /** Gives `entry` the key `hash`, replacing its last one; the entry's number is kept. */
  issue(entry: BrowserEntry, hash: PushKeyHash, deadline: AbortSignal): Promise<void>;
  /** Records `unread` for the entry holding `hash` (null only checks it); false when no entry holds it. */
  record(hash: PushKeyHash, unread: number | null, deadline: AbortSignal): Promise<boolean>;
  /** The member's most recently counted number over all their browsers, or null when none was counted. */
  latest(did: Did, deadline: AbortSignal): Promise<number | null>;
  /** Whether any browser of the member holds a key: one was ready, so its recovery key was saved (ADR 0083 d2). */
  registered(did: Did, deadline: AbortSignal): Promise<boolean>;
};

export type IssueOutcome = { readonly kind: "issued"; readonly key: PushKey } | { readonly kind: "no_session" };

type IssuePorts = { readonly list: BrowserList; readonly keys: PushKeys; readonly random: (bytes: number) => Buffer };
type IssueRequest = { readonly browser: BrowserKey; readonly device: DeviceId; readonly deadline: AbortSignal };

export async function issuePushKey(
  ports: IssuePorts,
  { browser, device, deadline }: IssueRequest,
): Promise<IssueOutcome> {
  const entry = await ports.list.findDevice(browser, device, deadline);
  if (entry === null) return { kind: "no_session" };
  const key = ports.random(32).toString("base64url") as PushKey;
  await ports.keys.issue(entry, pushKeyHash(key), deadline);
  return { kind: "issued", key };
}

type Notification = {
  readonly keys: readonly PushKey[];
  readonly unread: number | null;
  readonly deadline: AbortSignal;
};

/** Records the number for each key the door holds; returns the keys it does not hold. */
export async function recordCount(ports: { readonly keys: PushKeys }, { keys, unread, deadline }: Notification) {
  const rejected: PushKey[] = [];
  for (const key of keys) if (!(await ports.keys.record(pushKeyHash(key), unread, deadline))) rejected.push(key);
  return rejected;
}

export const chatCount = (ports: { readonly keys: PushKeys }, did: Did, deadline: AbortSignal) =>
  ports.keys.latest(did, deadline);

/**
 * Whether the member has set up chat, for web's onboarding chat step (ADR 0083 decision 2): the chat page asks for a
 * pushkey only once its browser is ready, which is after the recovery key was saved and the vault and backup written
 * (apps/chat/matrix/client.ts), and registers the count's pusher with it (ADR 0082 decision 1).
 */
export const chatSetUp = (ports: { readonly keys: PushKeys }, did: Did, deadline: AbortSignal) =>
  ports.keys.registered(did, deadline);
