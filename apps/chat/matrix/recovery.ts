// The recovery key, through matrix-js-sdk 43.0.0 as it ships (ADR 0095 decisions 2 and 3, ADR 0100). The SDK makes
// the key, the signing keys, the vault and the backup; this file only decides when to call it and holds the key in
// memory while a call needs it. Element does the same (element-web v1.12.35): signing keys first
// (apps/web/src/stores/InitialCryptoSetupStore.ts:104-111, CreateCrossSigning.ts:28-44), then the key is created,
// shown and confirmed before `bootstrapSecretStorage` (components/views/settings/encryption/ChangeRecoveryKeyBody.tsx:
// 77-133), and the key is answered from a cache only while the work runs (SecurityManager.ts:63-167). Spec:
// https://spec.matrix.org/v1.18/client-server-api/#secret-storage, #cross-signing, #server-side-key-backups.
import {
  type CryptoApi,
  type CryptoCallbacks,
  decodeRecoveryKey,
  type GeneratedSecretStorageKey,
} from "matrix-js-sdk/lib/crypto-api/index.js";
import { type MatrixClient, MatrixError, Method } from "matrix-js-sdk/lib/matrix.js";
import type { SecretStorageKeyDescriptionAesV1 } from "matrix-js-sdk/lib/secret-storage.js";
import type { UnlockOutcome } from "../core/chat.ts";

/** What the SDK says about the account's keys and this browser's share of them. */
export type KeyFacts = {
  /** The account has a signing identity on the server (userHasCrossSigningKeys after a /keys/query). */
  readonly hasIdentity: boolean;
  /** This browser holds all three private signing keys (getCrossSigningStatus().privateKeysCachedLocally). */
  readonly holdsKeys: boolean;
  /** The vault holds the signing keys and the backup key under its default key, and a backup exists, per the server. */
  readonly vaultComplete: boolean;
  readonly crossSigningReady: boolean;
  readonly deviceCrossSigned: boolean;
};

/**
 * - setup: no identity yet, or this browser holds the keys but left before the vault and backup were complete (it is
 *   asked again, ADR 0095 decision 2);
 * - ready: trusted here with the keys at hand and this device cross-signed (Element's MatrixChat.tsx:2203 check);
 * - locked: anything else, so another browser of the account waits for the key.
 */
export function phaseOf(facts: KeyFacts): "setup" | "locked" | "ready" {
  if (!facts.hasIdentity || (facts.holdsKeys && !facts.vaultComplete)) return "setup";
  return facts.crossSigningReady && facts.deviceCrossSigned ? "ready" : "locked";
}

export async function readFacts(client: MatrixClient, crypto: CryptoApi, userId: string): Promise<KeyFacts> {
  const deviceId = client.getDeviceId() ?? "";
  const [hasIdentity, status, vault, backup, ready, device] = await Promise.all([
    // Always a fresh /keys/query for ourselves (src/rust-crypto/rust-crypto.ts:516-526).
    crypto.userHasCrossSigningKeys(userId, true),
    crypto.getCrossSigningStatus(),
    vaultOnServer(client, userId),
    crypto.getKeyBackupInfo(),
    crypto.isCrossSigningReady(),
    crypto.getDeviceVerificationStatus(userId, deviceId),
  ]);
  const local = status.privateKeysCachedLocally;
  return {
    hasIdentity,
    holdsKeys: local.masterKey && local.selfSigningKey && local.userSigningKey,
    vaultComplete: vault && backup !== null,
    crossSigningReady: ready,
    deviceCrossSigned: device?.crossSigningVerified === true,
  };
}

/** The vault's parts: the three signing keys and the backup key, each stored under the default key. */
const VAULT_SECRETS = [
  "m.cross_signing.master",
  "m.cross_signing.self_signing",
  "m.cross_signing.user_signing",
  "m.megolm_backup.v1",
] as const;

/**
 * Whether the vault on the server is complete, read from the server itself. The SDK's own reads
 * (getSecretStorageStatus, secretStorage.isStored, rust-crypto.ts:885-919, secret-storage.ts:590-593) answer from the
 * sync store once the first sync is done (client.ts:2362-2373), and that first sync may be Synapse's cached copy from
 * before the vault was written: it keeps a device's initial /sync for sync_response_cache_duration, 2 minutes by
 * default (synapse v1.165.0 config/cache.py:211-212, rest/client/sync.py:210). A browser reloaded in that window then
 * looked half set up and was asked to make a new key over its saved one (live run of 2026-11-21). These are the same
 * GETs the SDK makes before its first sync (client.ts:2374-2385; spec v1.18 #get_matrixclientv3useruseridaccount_datatype),
 * and the same test as getSecretStorageStatus: each secret is encrypted under the default key.
 */
async function vaultOnServer(client: MatrixClient, userId: string): Promise<boolean> {
  const [defaultKey, ...secrets] = await Promise.all(
    ["m.secret_storage.default_key", ...VAULT_SECRETS].map((type) => accountData(client, userId, type)),
  );
  const keyId = defaultKey?.key;
  if (typeof keyId !== "string" || keyId === "") return false;
  return secrets.every((secret) => {
    const encrypted = secret?.encrypted;
    return typeof encrypted === "object" && encrypted !== null && keyId in encrypted;
  });
}

/** One account-data event's content from the server, or null when it has none (404 M_NOT_FOUND); else it throws. */
async function accountData(
  client: MatrixClient,
  userId: string,
  type: string,
): Promise<Record<string, unknown> | null> {
  const path = `/user/${encodeURIComponent(userId)}/account_data/${encodeURIComponent(type)}`;
  try {
    return await client.http.authedRequest<Record<string, unknown>>(Method.Get, path);
  } catch (e) {
    if (e instanceof MatrixError && e.errcode === "M_NOT_FOUND") return null;
    throw e;
  }
}

/**
 * The recovery key while a setup or an unlock runs, and the SDK's two callbacks over it (src/secret-storage.ts:614-650,
 * src/crypto-api/index.ts:1150-1179). Outside `during` nothing is held and the SDK is answered null, so it never
 * prompts and never gets a key it was not given for this work.
 */
export function createKeyHolder() {
  let held: { keyId: string | null; key: Uint8Array<ArrayBuffer> } | null = null;
  const callbacks: CryptoCallbacks = {
    getSecretStorageKey: async ({ keys }) =>
      held !== null && held.keyId !== null && held.keyId in keys ? [held.keyId, held.key] : null,
    // A new vault's key id is known only once the SDK has added it (rust-crypto.ts:1012-1027).
    cacheSecretStorageKey: (keyId, _info, key) => {
      if (held !== null && held.keyId === null && held.key === key) held.keyId = keyId;
    },
  };
  async function during<T>(keyId: string | null, key: Uint8Array<ArrayBuffer>, work: () => Promise<T>): Promise<T> {
    held = { keyId, key };
    try {
      return await work();
    } finally {
      held = null;
    }
  }
  return { callbacks, during };
}
export type KeyHolder = ReturnType<typeof createKeyHolder>;

export type Keys = { readonly client: MatrixClient; readonly crypto: CryptoApi; readonly holder: KeyHolder };

/**
 * Setup, up to the key the person saves: a new key (createRecoveryKeyFromPassphrase with no passphrase, rust-crypto.ts:
 * 1075) and, for an account with no identity, its signing keys. `setupNewCrossSigning` makes them even if this device
 * made a pair it never uploaded, which a plain bootstrap would leave unsent (CrossSigningIdentity.ts:73-78, 127-128).
 * The first upload needs no approval (MSC3967; Synapse keys.py SigningKeyUploadServlet), so the upload callback makes
 * the request with none, and a 401 (another identity exists) fails the step. A browser resuming its own setup already
 * holds the keys; the vault write below stores them.
 */
export async function makeKey({ crypto }: Keys, hasIdentity: boolean): Promise<GeneratedSecretStorageKey> {
  const key = await crypto.createRecoveryKeyFromPassphrase();
  if (!hasIdentity) {
    await crypto.bootstrapCrossSigning({
      setupNewCrossSigning: true,
      authUploadDeviceSigningKeys: (makeRequest) => makeRequest(null),
    });
  }
  return key;
}

/** Setup, once the person has saved the key: a new vault under it and a new backup; true when both are confirmed. */
export async function storeKey({ crypto, holder }: Keys, key: GeneratedSecretStorageKey): Promise<boolean> {
  await holder.during(null, key.privateKey, () =>
    crypto.bootstrapSecretStorage({
      createSecretStorageKey: async () => key,
      setupNewSecretStorage: true,
      setupNewKeyBackup: true,
    }),
  );
  return (await crypto.isSecretStorageReady()) && (await crypto.getActiveSessionBackupVersion()) !== null;
}

/**
 * A new browser with the saved key (ADR 0095 decision 3). The key is checked against the vault's default key first
 * (secretStorage.checkKey, as Element's AccessSecretStorageDialog.tsx:85-124 does), so a wrong one writes nothing. Then
 * a /keys/query for ourselves, which the 2026-11-20 spike needed, the signing keys from the vault (bootstrapCrossSigning
 * imports them and signs this device, CrossSigningIdentity.ts:88-118), the backup key, and the backup turned on here.
 */
export async function unlock(keys: Keys, userId: string, typed: string): Promise<UnlockOutcome> {
  const { client, crypto, holder } = keys;
  let key: Uint8Array<ArrayBuffer>;
  try {
    key = decodeRecoveryKey(typed.replace(/\s+/g, ""));
  } catch {
    return "wrong_key";
  }
  const found = await client.secretStorage.getKey();
  if (found === null) return "unfinished";
  const [keyId, info] = found;
  if (!(await client.secretStorage.checkKey(key, info as SecretStorageKeyDescriptionAesV1))) return "wrong_key";
  if (!(await readFacts(client, crypto, userId)).vaultComplete) return "unfinished";
  try {
    await holder.during(keyId, key, async () => {
      await crypto.getUserDeviceInfo([userId], true);
      await crypto.bootstrapCrossSigning({});
      await crypto.loadSessionBackupPrivateKeyFromSecretStorage();
      await crypto.checkKeyBackupAndEnable();
    });
  } catch {
    return "failed";
  }
  return "unlocked";
}

/**
 * How long after an unlock the backup is read again. Another browser of the account uploads a new key up to 10 s after
 * it gets one (matrix-js-sdk 43.0.0 src/rust-crypto/backup.ts:64-70), while the SDK asks the backup for a missing key
 * once, when a message fails to decrypt, and not again by itself (PerSessionKeyBackupDownloader.ts:29, 158-184).
 */
export const RESTORE_AGAIN_MS = 15_000;

/**
 * Reads the whole backup into this browser with the SDK's CryptoApi.restoreKeyBackup (src/crypto-api/index.ts:
 * 650-667), as Element does after an unlock (element-web v1.12.35 apps/web/src/stores/SetupEncryptionStore.ts:143-146).
 * Each key it imports retries the messages waiting for it (src/rust-crypto/rust-crypto.ts:1986-2010). False when the
 * backup could not be read; those messages then stay unreadable until the page is loaded again, as before.
 */
export async function restoreBackup(crypto: CryptoApi): Promise<boolean> {
  try {
    await crypto.restoreKeyBackup();
    return true;
  } catch {
    return false;
  }
}
