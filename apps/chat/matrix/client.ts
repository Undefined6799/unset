// The one place the chat page talks to matrix-js-sdk 43.0.0 (guideline §1; dependency-cruiser vendor-sdk-one-adapter;
// ADR 0088 decision 3). It starts a client on the session the door handed over, used as the SDK ships it:
//   createClient({ baseUrl, accessToken, userId, deviceId, cryptoCallbacks, localTimeoutMs }) src/matrix.ts:149
//   initRustCrypto({ storageKey, cryptoDatabasePrefix })                              src/client.ts:2014-2063
//   getCrypto().setDeviceIsolationMode(new AllDevicesIsolationMode(false))            src/crypto-api/index.ts:91,811
//   startClient({ lazyLoadMembers: true }), the default in-memory store               src/client.ts:1479
// in Element's order: crypto, then the isolation mode, then startClient (element-web v1.12.35
// apps/web/src/MatrixClientPeg.ts:321-331, 357). The import is lib/matrix.js, not the package's browser entry, which
// would also open a legacy crypto store named "matrix-js-sdk:crypto" for every account (src/browser-index.ts:36-41);
// Element imports matrix-js-sdk/src/matrix for the same reason (apps/web/src/utils/createMatrixClient.ts:9-19).
// Screens get our ChatState only, never an SDK object.
import { AllDevicesIsolationMode, type CryptoCallbacks, CryptoEvent } from "matrix-js-sdk/lib/crypto-api/index.js";
import { ClientEvent, createClient, HttpApiEvent, type MatrixClient, SyncState } from "matrix-js-sdk/lib/matrix.js";
import type { ChatSession, ChatState, UnlockOutcome } from "../core/chat.ts";
import type { PushTarget } from "../core/push.ts";
import type { ClaimOutcome } from "../core/setup-claim.ts";
import { createConversations, forgetLocalChoices } from "./conversation-service.ts";
import { BACKUP_WAIT_MS, backupSettled } from "./log-out.ts";
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
  readonly onState: (state: ChatState) => void;
  /** The server stopped taking the token (HttpApiEvent.SessionLoggedOut, src/http-api/fetch.ts:183-196). */
  readonly onSignedOut: () => void;
  /** The door's setup claim for this browser's device (ADR 0089). */
  readonly setup: { readonly claim: () => Promise<ClaimOutcome>; readonly release: () => Promise<void> };
  /** The door's pushkey for this device (ADR 0090 decision 1), asked for once this browser is ready. */
  readonly pushKey: () => Promise<PushTarget | null>;
  /** The door's Log out for this device (core/sign-out.ts): true once the device and its lock key are gone. */
  readonly signOut: () => Promise<boolean>;
  /** The door's public name for a chat partner (core/public-name.ts, ADR 0096), passed on to the page as is. */
  readonly names: (chatId: string) => Promise<string | null>;
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
    fetchFn: sameOriginFetch,
  });
}

/**
 * The homeserver is this page's own origin, and on staging that origin sits behind Pangolin's login (Alex, 2026-11-21
 * ~19:30Z: "the chat page's own calls ride that login"), so its calls carry same-origin cookies. matrix-js-sdk 43.0.0
 * sends every homeserver call with credentials "omit" (src/http-api/fetch.ts:302-315) through `fetchFn` when one is
 * given (fetch.ts:69-74; createClient's option, src/client.ts:313, 1358); this changes that one field and nothing else.
 * The token still goes in the Authorization header.
 */
const sameOriginFetch: typeof globalThis.fetch = (input, init) =>
  globalThis.fetch(input, { ...init, credentials: "same-origin" }); // guard-allow: egress browser-own-origin-homeserver

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
  const tell = (state: ChatState) => stopped || options.onState(state);
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
  if (session.newDevice) await client.clearStores({ cryptoDatabasePrefix });
  try {
    await client.initRustCrypto({ storageKey: session.storageKey, cryptoDatabasePrefix });
  } catch {
    return fail("chat.keys_unavailable"); // IndexedDB refused, WASM blocked, or a store this key cannot open
  }
  const crypto = client.getCrypto();
  if (crypto === undefined) return fail("chat.keys_unavailable");
  // Element's default (ADR 0093): feature_exclude_insecure_devices off (element-web v1.12.35
  // apps/web/src/settings/Settings.tsx:508-517) sets this mode (settings/controllers/DeviceIsolationModeController.ts:
  // 32-39), so a message decrypts whichever of the sender's devices sent it, and one from a device its owner has not
  // signed shows a warning (matrix/conversations.ts unconfirmedDevice). Keys go to every device of the members, as the
  // SDK's globalBlacklistUnverifiedDevices default false (src/rust-crypto/rust-crypto.ts:428) and Element's
  // blacklistUnverifiedDevices default false (Settings.tsx:1144-1153) leave it.
  crypto.setDeviceIsolationMode(new AllDevicesIsolationMode(false));
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
    await backupSettled(client, BACKUP_WAIT_MS);
    chat.stop();
    if (!(await options.signOut())) return options.onState({ kind: "error", code: "chat.sign_out_unavailable" });
    await client.clearStores({ cryptoDatabasePrefix });
    forgetLocalChoices(globalThis.localStorage, session.userId);
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
        ? { kind: "ready", conversations, names: options.names, me: session.userId, logOut: leave }
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
