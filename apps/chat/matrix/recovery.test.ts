// The adapter's own decisions for the recovery key (ADR 0095 decisions 2 and 3, ADR 0100), as values: which screen an
// account's key facts lead to, and that the key the SDK asks for is answered only while a setup or an unlock runs.
// The SDK calls themselves run against real Synapse and MAS in the step's live run, and against the e2e stand-in
// homeserver in tests/e2e/chat-page.chromium.spec.ts (the homeserver is the unmanaged dependency, TE-1). An unlock's
// failure paths also run here on matrix-js-sdk 43.0.0's own client and crypto, with the homeserver a stand-in fetchFn
// (the client's own option for the network, src/http-api/interface.ts:65).
import { createClient } from "matrix-js-sdk/lib/matrix.js";
import { calculateKeyCheck, type SecretStorageKeyDescriptionAesV1 } from "matrix-js-sdk/lib/secret-storage.js";
import { describe, expect, test } from "vitest";
import { createKeyHolder, type KeyFacts, phaseOf, unlock } from "./recovery.ts";

const none: KeyFacts = {
  hasIdentity: false,
  holdsKeys: false,
  vaultComplete: false,
  crossSigningReady: false,
  deviceCrossSigned: false,
};

describe("phaseOf", () => {
  test.each([
    [{ ...none }, "setup"],
    // Keys made on this device but never uploaded: setup again (src/rust-crypto/CrossSigningIdentity.ts:73-78).
    [{ ...none, holdsKeys: true }, "setup"],
    // This browser left half-way: it holds the keys, the vault or backup is not complete.
    [{ ...none, hasIdentity: true, holdsKeys: true, crossSigningReady: true, deviceCrossSigned: true }, "setup"],
    // Another browser of the account: locked until the key unlocks it.
    [{ ...none, hasIdentity: true }, "locked"],
    [{ ...none, hasIdentity: true, vaultComplete: true }, "locked"],
    [{ ...none, hasIdentity: true, vaultComplete: true, crossSigningReady: true }, "locked"],
    [
      { hasIdentity: true, holdsKeys: true, vaultComplete: true, crossSigningReady: true, deviceCrossSigned: false },
      "locked",
    ],
    [
      { hasIdentity: true, holdsKeys: true, vaultComplete: true, crossSigningReady: true, deviceCrossSigned: true },
      "ready",
    ],
  ] as const)("chat.key_phase: %o is %s", (facts, phase) => {
    expect(phaseOf(facts)).toBe(phase);
  });
});

describe("createKeyHolder", () => {
  const KEY = new Uint8Array(32).fill(7);
  const INFO = { algorithm: "m.secret_storage.v1.aes-hmac-sha2" } as SecretStorageKeyDescriptionAesV1;
  const ask = async (holder: ReturnType<typeof createKeyHolder>, ids: string[]) =>
    (await holder.callbacks.getSecretStorageKey?.(
      { keys: Object.fromEntries(ids.map((id) => [id, INFO])) },
      "m.cross_signing.master",
    )) ?? null;

  test("chat.key_held_only_while_running: the key is answered inside `during` only, and gone after", async () => {
    const holder = createKeyHolder();
    expect(await ask(holder, ["k1"])).toBeNull();
    const inside = await holder.during("k1", KEY, () => ask(holder, ["k1"]));
    expect(inside).toEqual(["k1", KEY]);
    expect(await ask(holder, ["k1"])).toBeNull();
  });

  test("chat.key_held_for_its_id: a request for another key id is not answered with this key", async () => {
    const holder = createKeyHolder();
    expect(await holder.during("k1", KEY, () => ask(holder, ["k2"]))).toBeNull();
  });

  test("chat.key_new_vault: during setup the id is learned from the SDK's cache call for the new key", async () => {
    const holder = createKeyHolder();
    const inside = await holder.during(null, KEY, async () => {
      holder.callbacks.cacheSecretStorageKey?.(
        "new1",
        { algorithm: "m.secret_storage.v1.aes-hmac-sha2" } as never,
        KEY,
      );
      return ask(holder, ["new1"]);
    });
    expect(inside).toEqual(["new1", KEY]);
    expect(await ask(holder, ["new1"])).toBeNull();
  });

  test("chat.key_dropped_on_failure: a step that throws still drops the key", async () => {
    const holder = createKeyHolder();
    await expect(
      holder.during("k1", KEY, async () => {
        throw new Error("network");
      }),
    ).rejects.toThrow("network");
    expect(await ask(holder, ["k1"])).toBeNull();
  });
});

describe("unlock", () => {
  test("chat.unlock_read_fails: a server fault while the vault is read is a failure to retry, never a hang", async () => {
    const ME = "@uaaaaaaaaaaaaaaaaaaaa:unset.cc";
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    let descriptor: Record<string, string> | null = null;
    // The vault's default key is there and matches; reading the vault's secrets then meets a server fault.
    const fetchFn = async (input: RequestInfo | URL) => {
      const path = decodeURIComponent(new URL(String(input)).pathname);
      if (path.endsWith("/account_data/m.secret_storage.default_key")) return json(200, { key: "K" });
      if (path.endsWith("/account_data/m.secret_storage.key.K")) return json(200, descriptor);
      if (path.includes("/account_data/m.cross_signing.")) return json(500, { errcode: "M_UNKNOWN", error: "busy" });
      return json(404, { errcode: "M_NOT_FOUND", error: "none" });
    };
    const holder = createKeyHolder();
    const client = createClient({
      baseUrl: "http://127.0.0.1:9",
      userId: ME,
      deviceId: "DEVICEAAAA",
      accessToken: "t",
      fetchFn,
      cryptoCallbacks: holder.callbacks,
    });
    await client.initRustCrypto({ useIndexedDB: false });
    const crypto = client.getCrypto();
    if (crypto === undefined) throw new Error("no crypto");
    const key = await crypto.createRecoveryKeyFromPassphrase();
    const { iv, mac } = await calculateKeyCheck(key.privateKey);
    descriptor = { algorithm: "m.secret_storage.v1.aes-hmac-sha2", iv, mac };
    expect(await unlock({ client, crypto, holder }, ME, key.encodedPrivateKey ?? "")).toBe("failed");
    client.stopClient();
  }, 20_000);
});
