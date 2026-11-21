// The recovery key, through matrix-js-sdk 43.0.0 as it ships (ADR 0083 decisions 2 and 3, ADR 0089). The SDK makes
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
import type { MatrixClient } from "matrix-js-sdk/lib/matrix.js";
import type { SecretStorageKeyDescriptionAesV1 } from "matrix-js-sdk/lib/secret-storage.js";
import type { UnlockOutcome } from "../core/chat.ts";

/** What the SDK says about the account's keys and this browser's share of them. */
export type KeyFacts = {
  /** The account has a signing identity on the server (userHasCrossSigningKeys after a /keys/query). */
  readonly hasIdentity: boolean;
  /** This browser holds all three private signing keys (getCrossSigningStatus().privateKeysCachedLocally). */
  readonly holdsKeys: boolean;
  /** The vault holds the signing keys and the backup key under its default key, and a backup exists. */
  readonly vaultComplete: boolean;
  readonly crossSigningReady: boolean;
  readonly deviceCrossSigned: boolean;
};

/**
 * - setup: no identity yet, or this browser holds the keys but left before the vault and backup were complete (it is
 *   asked again, ADR 0083 decision 2);
 * - ready: trusted here with the keys at hand and this device cross-signed (Element's MatrixChat.tsx:2203 check);
 * - locked: anything else, so another browser of the account waits for the key.
 */
export function phaseOf(facts: KeyFacts): "setup" | "locked" | "ready" {
  if (!facts.hasIdentity || (facts.holdsKeys && !facts.vaultComplete)) return "setup";
  return facts.crossSigningReady && facts.deviceCrossSigned ? "ready" : "locked";
}

export async function readFacts(client: MatrixClient, crypto: CryptoApi, userId: string): Promise<KeyFacts> {
  const deviceId = client.getDeviceId() ?? "";
  const [hasIdentity, status, vault, backup, megolm, ready, device] = await Promise.all([
    crypto.userHasCrossSigningKeys(userId, true),
    crypto.getCrossSigningStatus(),
    crypto.getSecretStorageStatus(),
    crypto.getKeyBackupInfo(),
    client.secretStorage.isStored("m.megolm_backup.v1"),
    crypto.isCrossSigningReady(),
    crypto.getDeviceVerificationStatus(userId, deviceId),
  ]);
  const local = status.privateKeysCachedLocally;
  const keyId = vault.defaultKeyId;
  return {
    hasIdentity,
    holdsKeys: local.masterKey && local.selfSigningKey && local.userSigningKey,
    vaultComplete: vault.ready && backup !== null && keyId !== null && megolm !== null && keyId in megolm,
    crossSigningReady: ready,
    deviceCrossSigned: device?.crossSigningVerified === true,
  };
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
 * A new browser with the saved key (ADR 0083 decision 3). The key is checked against the vault's default key first
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
