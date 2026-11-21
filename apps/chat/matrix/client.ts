// The one place the chat page talks to matrix-js-sdk 43.0.0 (guideline §1; dependency-cruiser vendor-sdk-one-adapter;
// ADR 0088 decision 3). It starts a client on the session the door handed over, used as the SDK ships it:
//   createClient({ baseUrl, accessToken, userId, deviceId, cryptoCallbacks })        src/matrix.ts:149
//   initRustCrypto({ storageKey, cryptoDatabasePrefix })                              src/client.ts:2014-2063
//   getCrypto().setDeviceIsolationMode(new OnlySignedDevicesIsolationMode())          src/crypto-api/index.ts:91,840
//   startClient({ lazyLoadMembers: true }), the default in-memory store               src/client.ts:1479
// in Element's order: crypto, then the isolation mode, then startClient (element-web v1.12.35
// apps/web/src/MatrixClientPeg.ts:321-331, 357). The import is lib/matrix.js, not the package's browser entry, which
// would also open a legacy crypto store named "matrix-js-sdk:crypto" for every account (src/browser-index.ts:36-41);
// Element imports matrix-js-sdk/src/matrix for the same reason (apps/web/src/utils/createMatrixClient.ts:9-19).
// Screens get our ChatState only, never an SDK object.
import { CryptoEvent, OnlySignedDevicesIsolationMode } from "matrix-js-sdk/lib/crypto-api/index.js";
import { ClientEvent, createClient, HttpApiEvent, type MatrixClient, SyncState } from "matrix-js-sdk/lib/matrix.js";
import type { ChatSession, ChatState, UnlockOutcome } from "../core/chat.ts";
import type { ClaimOutcome } from "../core/setup-claim.ts";
import { createKeyHolder, type Keys, makeKey, phaseOf, readFacts, storeKey, unlock } from "./recovery.ts";

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
};

/** Start the client for this session. Every outcome reaches `onState` until it is stopped; nothing is thrown. */
export async function openChat(session: ChatSession, options: ChatOptions): Promise<Chat> {
  const holder = createKeyHolder();
  const client = createClient({
    baseUrl: options.baseUrl,
    accessToken: session.accessToken,
    userId: session.userId,
    deviceId: session.deviceId,
    // The recovery key, answered only while a setup or an unlock runs (recovery.ts createKeyHolder).
    cryptoCallbacks: holder.callbacks,
  });
  // Once stopped, a start still under way reports nothing more, so a later step cannot paint over the outcome.
  let stopped = false;
  const chat = {
    stop: () => {
      stopped = true;
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
  try {
    await client.initRustCrypto({ storageKey: session.storageKey, cryptoDatabasePrefix: storePrefix(session.userId) });
  } catch {
    return fail("chat.keys_unavailable"); // IndexedDB refused, WASM blocked, or a store this key cannot open
  }
  const crypto = client.getCrypto();
  if (crypto === undefined) return fail("chat.keys_unavailable");
  crypto.setDeviceIsolationMode(new OnlySignedDevicesIsolationMode());
  await client.startClient({ lazyLoadMembers: true });
  if (!(await firstSync(client, FIRST_SYNC_MS))) return fail("chat.sync_timeout");
  const keys: Keys = { client, crypto, holder };
  // While a setup or an unlock runs its own steps, the trust events it causes do not repaint the page.
  let busy = false;
  const report = async () => {
    if (busy) return;
    const facts = await readFacts(client, crypto, session.userId);
    const phase = phaseOf(facts);
    if (phase === "setup") return setUp(facts.hasIdentity);
    tell(phase === "ready" ? { kind: "ready" } : { kind: "locked", unlock: tryKey });
  };
  const tryKey = async (typed: string): Promise<UnlockOutcome> => {
    busy = true;
    const outcome = await unlock(keys, session.userId, typed).finally(() => (busy = false));
    if (outcome === "unlocked") await report();
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
