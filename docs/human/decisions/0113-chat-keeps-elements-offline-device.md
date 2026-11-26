---
status: Accepted
date: "2026-11-23"
step: P6.02
accepted:
  at: "2026-11-23T03:30:03Z"
  head: "46938691de11140ae9f2f5c18c36ed71d97e9a87"
  line: "Turn on Element's offline device"
---
# 0113 — Chat keeps Element's offline device, so messages sent while a member has no browser open can be read later

Record: Accepted by Alex, 2026-11-23 03:30:03Z, by picking "Turn on Element's offline device" on the decision card
"Make messages sent before someone opens chat readable later?", against `claude/chat-staging-main` at head
46938691de11140ae9f2f5c18c36ed71d97e9a87. From here the record changes only to be marked superseded.

## Context
On staging (2026-11-23), Alex started a chat with a test member and sent two messages with the request. That member
had no browser signed in to chat then. A message is encrypted to the devices its recipients have when it is sent
(spec v1.18 #end-to-end-encryption). With no device there was nobody to encrypt it to. The member's next browser
joined and showed both as "This message can't be read on this browser". That broke the page's own promise,
"They can read your messages once they do", and Alex's decision that the first message goes with the request.
Element has the same gap and closes it with a dehydrated device, which Element's screens call an offline device
(MSC3814).

## Decision
1. **Synapse turns the offline device on**, and no other experiment: `experimental_features: { msc3814_enabled: true }`
   (Synapse 1.165.0 `synapse/config/experimental.py:77`). Preflight C36 requires exactly that value.
2. **The page uses matrix-js-sdk 43.0.0 as it ships, where Element calls it**
   (`element-web v1.12.35 apps/web/src/utils/device/dehydration.ts`). Each call runs only if
   `CryptoApi.isDehydrationSupported` says yes. Each call is then `CryptoApi.startDehydration`:
   - Setting up the recovery key: a new dehydration key (`CreateSecretStorageDialog.tsx:241`, `createNewKey`).
   - Unlocking a new browser: the offline device's messages are picked up first, then a new device is made
     (`SetupEncryptionStore.ts:141`).
   - Loading a browser already set up: the cached key, nothing picked up (`MatrixClientPeg.ts:333-345`,
     `onlyIfKeyCached`, `rehydrate: false`).
   A failure leaves chat working without it, as in Element. The next unlock or load tries again
   (`apps/chat/matrix/recovery.ts` `dehydrate`).

## What the server holds, and why this keeps "the server never holds members' keys"
The offline device's own keys are stored on Synapse encrypted. The key that opens them is the dehydration key, which
sits in the member's vault (secret storage) under their recovery key (`startDehydration`,
`src/crypto-api/index.ts:695-715`). The server holds ciphertext it cannot open, just as it holds the key backup. Room
keys sent to the offline device are encrypted to that device. Only a browser that has unlocked with the recovery key
can open them.

With MAS, Synapse leaves the offline device out of the device list MAS keeps in step, so MAS does not delete it
(`synapse/rest/synapse/mas/devices.py:199-207`).

## Personal data (GDPR)
- **Data:** no new personal data in clear. There is one more device record per member, with its public keys and its
  encrypted state, and the room keys queued for it, which are encrypted. These are the same kinds of records as a
  browser's own device.
- **Purpose and lawful basis:** delivering a member's messages, the same as for their browsers' devices: contract
  (GDPR Art. 6(1)(b)).
- **Erasure:** deleting a member's devices also deletes the dehydrated device row (Synapse 1.165.0
  `synapse/storage/databases/main/devices.py:433-439`), and deactivation deletes all of a member's devices
  (`synapse/handlers/deactivate_account.py:161`). This is read in source, and is unverified until the delete e2e
  checks it.
- **Export:** nothing readable to export. The message keys reach the member's browser and go with its key export.

## Consequences
- A message sent while a member has no browser in chat waits on their offline device, and their next browser reads it
  once it unlocks with the recovery key. A member who has never saved a recovery key has no offline device yet, so
  messages sent before then stay unreadable to them, as before.
- Each browser makes a new offline device from time to time (the SDK schedules it); the old one is replaced on the
  server.

## The cost accepted
- **An experimental feature.** MSC3814 is a proposal, not yet in the spec, and Synapse has it behind an experimental
  flag. Element ships it. If Synapse or the SDK changes it, the change shows up in our pinned versions' tests first.
- **One more device that receives keys.** It is cross-signed by the member's own keys, and only their recovery key
  opens it. This does not widen ADR 0106's accepted risk.

## Alternatives
- **Hold the first messages in the sender's browser until the other member accepts.** The messages would be held in
  that browser, and the sender's browser would have to be open at that time. Not chosen.
- **Keep it, and say so.** The page would have to drop its promise. Not chosen.

## Compliance
- `deployment/preflight/checks/chat.test.ts`: C36 refuses a missing, false or widened `experimental_features`.
- `tests/e2e/chat-two-browsers.chromium.spec.ts` `chat_e2e.first_message_no_browser`: against real Synapse and MAS, a
  request sent while the other member has no browser in chat is read by their new browser once it unlocks.
