// The one place the chat page talks to matrix-js-sdk 43.0.0 (guideline §1; dependency-cruiser vendor-sdk-one-adapter;
// ADR 0088 decision 3). It starts a client on the session the door handed over, used as the SDK ships it:
//   createClient({ baseUrl, accessToken, userId, deviceId, cryptoCallbacks, localTimeoutMs }) src/matrix.ts:149
//   initRustCrypto({ storageKey, cryptoDatabasePrefix })                              src/client.ts:2014-2063
//   getCrypto().setDeviceIsolationMode(new OnlySignedDevicesIsolationMode())          src/crypto-api/index.ts:91,840
//   startClient({ lazyLoadMembers: true }), the default in-memory store               src/client.ts:1479
// in Element's order: crypto, then the isolation mode, then startClient (element-web v1.12.35
// apps/web/src/MatrixClientPeg.ts:321-331, 357). The import is lib/matrix.js, not the package's browser entry, which
// would also open a legacy crypto store named "matrix-js-sdk:crypto" for every account (src/browser-index.ts:36-41);
// Element imports matrix-js-sdk/src/matrix for the same reason (apps/web/src/utils/createMatrixClient.ts:9-19).
// Screens get our ChatState only, never an SDK object.
import {
  type CryptoCallbacks,
  CryptoEvent,
  OnlySignedDevicesIsolationMode,
} from "matrix-js-sdk/lib/crypto-api/index.js";
import {
  ClientEvent,
  createClient,
  HttpApiEvent,
  type MatrixClient,
  RoomEvent,
  SyncState,
} from "matrix-js-sdk/lib/matrix.js";
import type { ChatSession, ChatState, UnlockOutcome } from "../core/chat.ts";
import type { PushTarget } from "../core/push.ts";
import type { ClaimOutcome } from "../core/setup-claim.ts";
import { createConversations } from "./conversation-service.ts";
import { BACKUP_WAIT_MS, type BackupWatch, watchBackup } from "./log-out.ts";
import { registerPusher } from "./pusher.ts";
import {
  createKeyHolder,
  type Keys,
  makeKey,
  phaseOf,
  RESTORE_AGAIN_MS,
  readFacts,
  restoreBackup,
  storeKey,
  unlock,
} from "./recovery.ts";

const UNAVAILABLE = "chat.unavailable";
const SETUP_FAILED = "chat.setup_failed";
/** How long the first sync may take before the page says so (book P6.06 step 6: 30 s). */
const FIRST_SYNC_MS = 30_000;

/**
 * The account's own key store: the SDK names its two IndexedDB databases `<prefix>::matrix-sdk-crypto` and
 * `<prefix>::matrix-sdk-crypto-meta` (src/client.ts:1641-1642), so another account in this browser opens other
 * databases and the first one's stays locked (ADR 0083 decision 4). The chat ID is opaque (ADR 0010).
 */
export const storePrefix = (userId: string): string => `unset-chat:${userId}`;

export type Chat = { readonly stop: () => void };
export type ChatOptions = {
  /** The page's own origin: the edge sends /_matrix/client/* to the homeserver (ADR 0081 decision 6). */
  readonly baseUrl: string;
  /** Aborted when another tab takes chat over (core/tab-lock.ts): the client stops, and this store is left alone. */
  readonly takenOver: AbortSignal;
  readonly onState: (state: ChatState) => void;
  /** The server stopped taking the token (HttpApiEvent.SessionLoggedOut, src/http-api/fetch.ts:183-196). */
  readonly onSignedOut: () => void;
  /** The door's setup claim for this browser's device (ADR 0089). */
  readonly setup: { readonly claim: () => Promise<ClaimOutcome>; readonly release: () => Promise<void> };
  /** The door's pushkey for this device (ADR 0090 decision 1), asked for once this browser is ready. */
  readonly pushKey: () => Promise<PushTarget | null>;
  /** The door's Log out for this device (core/sign-out.ts): true once the device and its lock key are gone. */
  readonly signOut: () => Promise<boolean>;
};

/**
 * How long any request may take when its caller sets no timeout of its own (RE-1): createClient's localTimeoutMs, the
 * default every call through the client's FetchHttpApi gets (src/client.ts:359-363, 1374; src/http-api/fetch.ts:267-273).
 * The calls that set their own keep them: /sync its long poll plus 80 s (src/sync.ts:330, 943), the crypto's key
 * requests 60 s (src/rust-crypto/OutgoingRequestProcessor.ts:227). 30 s matches the page's first-sync deadline and the
 * wait for a new conversation; the SDK's own retries (setAccountData's five, client.ts:2290, 2319) each get it.
 */
export const REQUEST_DEADLINE_MS = 30_000;

/** The client for this session, as the SDK ships it, with the request deadline. */
export function chatClient(session: ChatSession, baseUrl: string, cryptoCallbacks: CryptoCallbacks): MatrixClient {
  return createClient({
    baseUrl,
    accessToken: session.accessToken,
    userId: session.userId,
    deviceId: session.deviceId,
    cryptoCallbacks,
    localTimeoutMs: REQUEST_DEADLINE_MS,
  });
}

/** Start the client for this session. Every outcome reaches `onState` until it is stopped; nothing is thrown. */
export async function openChat(session: ChatSession, options: ChatOptions): Promise<Chat> {
  const holder = createKeyHolder();
  // The recovery key, answered only while a setup or an unlock runs (recovery.ts createKeyHolder).
  const client = chatClient(session, options.baseUrl, holder.callbacks);
  // Once stopped, a start still under way reports nothing more, so a later step cannot paint over the outcome.
  let stopped = false;
  let restoreAgain: ReturnType<typeof setTimeout> | undefined;
  const chat = {
    stop: () => {
      stopped = true;
      clearTimeout(restoreAgain);
      client.stopClient();
    },
  };
  options.takenOver.addEventListener("abort", () => chat.stop(), { once: true });
  const tell = (state: ChatState) => stopped || options.onState(state);
  const backup = followBackup(client);
  client.on(HttpApiEvent.SessionLoggedOut, () => {
    chat.stop();
    options.onSignedOut();
  });
  const fail = (code: string) => {
    tell({ kind: "error", code });
    chat.stop();
    return chat;
  };
  const cryptoDatabasePrefix = storePrefix(session.userId);
  // A device new to this browser cannot open a store left by an ended one (its lock key is gone): that store is wiped,
  // as Log out would have (ADR 0083 decision 5). clearStores names the same two databases (src/client.ts:1614-1669).
  // Another tab may have taken chat over while this one started: the store is then that tab's alone.
  if (options.takenOver.aborted) return chat;
  if (session.newDevice) await client.clearStores({ cryptoDatabasePrefix });
  if (options.takenOver.aborted) return chat;
  try {
    await client.initRustCrypto({ storageKey: session.storageKey, cryptoDatabasePrefix });
  } catch {
    return fail("chat.keys_unavailable"); // IndexedDB refused, WASM blocked, or a store this key cannot open
  }
  if (options.takenOver.aborted) return chat;
  const crypto = client.getCrypto();
  if (crypto === undefined) return fail("chat.keys_unavailable");
  crypto.setDeviceIsolationMode(new OnlySignedDevicesIsolationMode());
  await client.startClient({ lazyLoadMembers: true });
  if (!(await firstSync(client, FIRST_SYNC_MS))) return fail("chat.sync_timeout");
  const keys: Keys = { client, crypto, holder };
  const conversations = createConversations(client, crypto, session.userId);
  // While a setup or an unlock runs its own steps, the trust events it causes do not repaint the page.
  let busy = false;
  // The count's pusher, registered once per sign-in when the page is first ready. A failure leaves chat as it is: the
  // count on unset.sh then shows no number, or the last one, until the next sign-in (ADR 0082 Consequences).
  let pusherAsked = false;
  const registerOnce = async () => {
    if (pusherAsked) return;
    pusherAsked = true;
    const target = await options.pushKey();
    if (target !== null && !stopped) await registerPusher(client, target);
  };
  /**
   * Log out (ADR 0083 decision 5), in Element's order of stop then clear (element-web v1.12.35
   * apps/web/src/Lifecycle.ts onLoggedOut, clearStorage): the backup catches up, the client stops, the door ends the
   * device and deletes its lock key, and only then are this account's stores deleted. If the door cannot, nothing is
   * deleted: the store stays locked by a key only the door holds, and the page says so.
   */
  const logOut = async () => {
    busy = true;
    tell({ kind: "logging_out" });
    await backup.settled(BACKUP_WAIT_MS);
    chat.stop();
    // Chat moved to another tab meanwhile: this browser's device stays, for that tab.
    if (options.takenOver.aborted) return;
    if (!(await options.signOut())) return options.onState({ kind: "error", code: "chat.sign_out_unavailable" });
    // A tab that took chat over meanwhile owns the store now; its new device wipes it (ADR 0083 decision 5).
    if (options.takenOver.aborted) return;
    await client.clearStores({ cryptoDatabasePrefix });
    options.onState({ kind: "logged_out" });
  };
  const leave = () => void logOut();
  const report = async () => {
    if (busy) return;
    // A read that fails never leads to setup, which could replace a vault that exists (fail closed).
    const facts = await readFacts(client, crypto, session.userId).catch(() => null);
    if (facts === null) return void fail(UNAVAILABLE);
    const phase = phaseOf(facts);
    if (phase === "setup") return setUp(facts.hasIdentity);
    if (phase === "ready") void registerOnce();
    tell(
      phase === "ready"
        ? { kind: "ready", conversations, me: session.userId, logOut: leave }
        : { kind: "locked", unlock: tryKey, logOut: leave },
    );
  };
  const tryKey = async (typed: string): Promise<UnlockOutcome> => {
    busy = true;
    const outcome = await unlock(keys, session.userId, typed).finally(() => (busy = false));
    if (outcome !== "unlocked") return outcome;
    // Keys the account's other browsers had not uploaded yet are read once more, when they have (RESTORE_AGAIN_MS).
    restoreAgain = setTimeout(() => void restoreBackup(crypto), RESTORE_AGAIN_MS);
    await report();
    return outcome;
  };
  /** ADR 0089 decision 3: claim, make the key (and the signing keys), show it; `save` stores it once checked. */
  const setUp = async (hasIdentity: boolean) => {
    busy = true;
    tell({ kind: "setting_up" });
    const claimed = await options.setup.claim();
    if (claimed !== "claimed") return claimed === "elsewhere" ? tell({ kind: "setup_elsewhere" }) : fail(UNAVAILABLE);
    const key = await makeKey(keys, hasIdentity).catch(() => null);
    if (key?.encodedPrivateKey === undefined) return fail(SETUP_FAILED);
    tell({ kind: "save_key", key: key.encodedPrivateKey, save: () => void store(key) });
  };
  const store = async (key: Parameters<typeof storeKey>[1]) => {
    tell({ kind: "setting_up" });
    // The claim may have run out while the key was being saved; it is taken again before the vault is written.
    const claimed = await options.setup.claim();
    if (claimed !== "claimed") return claimed === "elsewhere" ? tell({ kind: "setup_elsewhere" }) : fail(UNAVAILABLE);
    if (!(await storeKey(keys, key).catch(() => false))) return fail(SETUP_FAILED);
    await options.setup.release();
    busy = false;
    await report();
  };
  // Trust changes are read again (src/crypto-api/CryptoEventHandlerMap.ts:28-32). This device's own signature, made
  // by an unlock, arrives with the next /keys/query for us, which DevicesUpdated reports (rust-crypto.ts:2071-2082);
  // the live run of 2026-11-21 stayed locked without it.
  client.on(CryptoEvent.UserTrustStatusChanged, (userId) => userId === session.userId && void report());
  client.on(CryptoEvent.KeysChanged, () => void report());
  client.on(CryptoEvent.DevicesUpdated, (users) => users.includes(session.userId) && void report());
  await report();
  return chat;
}

/**
 * To-device types that carry a room key to this device (Matrix spec v1.16,
 * https://spec.matrix.org/v1.16/client-server-api/#mroom_key and #mforwarded_room_key).
 */
const ROOM_KEY_TYPES = new Set(["m.room_key", "m.forwarded_room_key"]);

/**
 * The backup's own events, and the new room keys it has to upload, fed to Log out's watch (log-out.ts) from before the
 * crypto starts, so the enable at start is seen. The to-device message arrives decrypted (src/sync.ts:2041-2093,
 * src/sync-accumulator.ts:171-179); a local echo is this browser sending, which makes or uses its room key
 * (src/models/room.ts:2846, re-emitted on the client, src/sync.ts:1964-1970).
 */
function followBackup(client: MatrixClient): BackupWatch {
  const watch = watchBackup();
  client.on(CryptoEvent.KeyBackupStatus, watch.enabled);
  client.on(CryptoEvent.KeyBackupSessionsRemaining, watch.remaining);
  client.on(ClientEvent.ReceivedToDeviceMessage, ({ message }) => ROOM_KEY_TYPES.has(message.type) && watch.keyMade());
  client.on(RoomEvent.LocalEchoUpdated, () => watch.keyMade());
  return watch;
}

/** Resolves true on the first PREPARED or SYNCING (src/sync.ts:80-92), false at the deadline. */
function firstSync(client: MatrixClient, deadlineMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => done(false), deadlineMs);
    const onSync = (state: SyncState) => {
      if (state === SyncState.Prepared || state === SyncState.Syncing) done(true);
    };
    const done = (ok: boolean) => {
      clearTimeout(timer);
      client.off(ClientEvent.Sync, onSync);
      resolve(ok);
    };
    client.on(ClientEvent.Sync, onSync);
  });
}
