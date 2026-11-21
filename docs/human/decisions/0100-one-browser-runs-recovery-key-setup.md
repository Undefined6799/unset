---
status: Accepted
date: "2026-11-21"
step: P6.08
accepted:
  at: "2026-11-21T04:26Z"
  head: "bccd968f"
  line: "yes"
---
# 0100 — One browser at a time runs an account's recovery-key setup, under a short claim the door keeps

Record: Accepted by Alex 2026-11-21 ("yes" in the project chat, 04:26Z); proposed 2026-11-21 (P6.08, build
step 8 of the minimal chat build). Carries out ADR 0095 decisions 2 and 3; builds on ADRs 0093 (the door) and 0099
(the chat page).

## Context
ADR 0095 decision 2 says the door lets exactly one browser run the "Save your recovery key" setup for an account
(security pass finding 14) and leaves the mechanism open. Two browsers that each saw "no identity yet" would each
make signing keys and a vault under a different recovery key; whichever wrote last would leave the other's saved key
useless.

What the server already does, read 2026-11-21: Synapse 1.162.0 `synapse/rest/client/keys.py`
(`SigningKeyUploadServlet.on_POST`) takes the first signing-key upload with no approval (MSC3967) and refuses a
different one under MAS with a 401 whose flows are `m.oauth` / `org.matrix.cross_signing_reset`, until MAS marks the
key replaceable. So two signing identities cannot both land; but the vault (`m.secret_storage.*` account data) has no
such guard, and the page cannot tell "someone else is setting up" from "nobody finished".

What the SDK does (matrix-js-sdk 43.0.0): `bootstrapCrossSigning({})` with no keys on the device or in the vault makes
new ones (`src/rust-crypto/CrossSigningIdentity.ts:88-124`); with keys made on the device but never uploaded it does
nothing and never uploads them (`:73-78`, `:127-128`); `bootstrapSecretStorage` stores the device's signing keys in a
new vault and, with `setupNewKeyBackup`, makes a new backup (`src/rust-crypto/rust-crypto.ts:924-974`); every vault
write asks `getSecretStorageKey` for the key (`src/secret-storage.ts:500-525, 614-650`). Element creates the recovery
key, shows it, has the person confirm it, and only then calls `bootstrapSecretStorage({ setupNewSecretStorage: true,
createSecretStorageKey })` (element-web v1.12.35 `apps/web/src/components/views/settings/encryption/
ChangeRecoveryKeyBody.tsx:77-133`), and makes the signing keys before the backup (`stores/InitialCryptoSetupStore.ts:
104-111`).

## Decision
1. **The door keeps a claim per account.** `door.chat_setup` (migration 0044): the chat user as primary key, the
   browser entry holding it (`door.browser.id`, `ON DELETE CASCADE`) and `claimed_until`. `POST /setup/claim
   { deviceId }` claims for 15 minutes in one statement, `INSERT ... ON CONFLICT (chat_user) DO UPDATE ... WHERE` the
   row is the holder's own or its time has passed (rule DA-4: the primary key serialises claims; nothing is held
   open). `POST /setup/release { deviceId }` deletes the holder's own row. Both need the browser cookie and a device
   that browser holds, behind the CSRF gate; anything else is 401 and claims nothing. A live claim of another browser
   is `409 chat.setup_elsewhere`.
2. **When the page runs setup.** After the first sync the page asks the SDK, after a `/keys/query` for itself, whether
   the account has a signing identity, and whether this browser holds its private keys. It runs setup when there is
   no identity, or when this browser holds the keys but the vault or the backup is not complete (the same browser
   left half-way: it is asked again, ADR 0095). Otherwise a browser that is not cross-signed is locked and offers the
   unlock; one that is cross-signed with a complete vault and backup is ready.
3. **The order, under the claim.** Claim; `createRecoveryKeyFromPassphrase()` with no argument; for an account with
   no identity, `bootstrapCrossSigning({ setupNewCrossSigning: true, authUploadDeviceSigningKeys })`, so a key pair
   made on this device but never uploaded is replaced rather than left unsent, with a callback that makes the request
   with no approval and lets a 401 fail the step (a browser resuming its own setup already holds the keys and skips
   this); then the key is shown and saved, and the person types its last four characters; then claim again (it may
   have run out while they saved) and `bootstrapSecretStorage({ createSecretStorageKey, setupNewSecretStorage: true,
   setupNewKeyBackup: true })`; "done" only when `isSecretStorageReady()` and `getActiveSessionBackupVersion()` both
   hold; release. The vault is written after the check, as Element does, so a key the person never confirmed is
   never the one that unlocks them.
4. **The key lives in page memory only**, from its creation until the vault is written (setup) or the unlock is done;
   the `getSecretStorageKey` callback answers from it only while one of those runs, then it is dropped. The
   Download button builds a text file in the browser. Nothing writes it to web storage, a cookie, IndexedDB or a
   request of ours; the SDK sends only what it encrypts with it.
5. **Unlock** is ADR 0095 decision 3: the typed key is decoded and checked against the vault's default key
   (`secretStorage.checkKey`, as Element's `AccessSecretStorageDialog` does) before anything else, so a wrong key is
   said plainly and nothing is written; then `getUserDeviceInfo([self], true)`, `bootstrapCrossSigning({})`,
   `loadSessionBackupPrivateKeyFromSecretStorage()`, `checkKeyBackupAndEnable()`. The unlock runs only when the vault
   and backup are complete; otherwise the page says setup was not finished in the other browser. This device's own
   signature reaches the page with the next `/keys/query` for the account, which `CryptoEvent.DevicesUpdated` reports
   (`src/rust-crypto/rust-crypto.ts:2071-2082`), so the page reads its state again on that event too.

## Alternatives
- **No claim; rely on Synapse refusing a second identity.** Leaves the vault race, and a second browser cannot say
  why it fails. Declined.
- **A Postgres advisory lock or a transaction held across the setup.** The setup spans the person saving their key
  and many network calls; rule DA-4 forbids network I/O inside a transaction. Declined.
- **Write the vault first and show the key after (the step book's order), with a "saved" marker in account data.**
  Needs our own account-data type and a second state to reconcile; a reload before the check would leave a working
  vault under a key nobody confirmed. Declined for Element's order.
- **A claim with no expiry, cleared by the holder only.** A browser that never returns would block the account for
  good, and reset is out of scope. Declined.

## Consequences
- A browser that leaves after its signing keys are uploaded but before the vault is written blocks unlock on other
  browsers until it comes back and finishes; with no reset in this version such an account can only be finished there.
- Each run of setup on the same browser makes a new key and a new backup; before the first conversation nothing is
  lost by that.
- `door.chat_setup` holds a pseudonymous chat user and a browser entry's id for minutes; it is erased with the
  member's browser entries by the foreign key, and there is nothing lasting to export.
- A password manager offering to save the key is unverified: the field follows Chromium's documented form shape
  (https://www.chromium.org/developers/design-documents/form-styles-that-chromium-understands/, read 2026-11-21) but
  no test can drive a browser's save prompt.

## Compliance
`tests/integration/postgres/setup-claim-store.test.ts` (real Postgres as `chat_auth`: one claim per account, the
holder's own again, expiry, release by the holder only, eight concurrent claims with one winner, the claim goes with
its entry), `tests/integration/chat-auth/door.test.ts` (the routes, their denials and the CSRF gate),
`domains/messaging/setup.test.ts`; `apps/chat/matrix/recovery.test.ts`, `apps/chat/core/recovery-key.test.ts`,
`apps/chat/core/setup-claim.test.ts` and `tests/e2e/chat-page.chromium.spec.ts` (setup, a second browser unlocking, a
wrong key, a half-done setup, no key in any request body or store, axe in both themes) land with the page. A live run
against Synapse 1.162.0 and MAS 1.26.0 on 2026-11-21 did setup in one browser, unlocked a second, and decrypted
from the backup a message sent before the unlocking device existed.
