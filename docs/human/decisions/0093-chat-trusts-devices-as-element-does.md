# 0093 — Chat trusts devices the way Element does (amends 0083)

Status: Accepted by Alex 2026-11-21 19:12Z in the project chat: "let's begin like the way that Element does it, and
at a later stage, we can also add like the 2FA". This record amends ADR 0083 decision 1, ADR 0088 decision 3 and ADR
0001 decision 13 in the device isolation mode they name, and nothing else in them. It comes from the minimal chat
build's review fixes (P6.10, finding M3).

## Context
ADR 0083 decision 1, ADR 0088 decision 3 and ADR 0001 decision 13 set `OnlySignedDevicesIsolationMode`. In
matrix-js-sdk 43.0.0 that mode decrypts with `TrustRequirement.CrossSignedOrLegacy`
(`src/rust-crypto/rust-crypto.ts:2280-2286`). A message from a device this browser does not yet know as signed fails
with `UNSIGNED_SENDER_DEVICE`, and the SDK drops it from the retry list, so it never decrypts later
(`rust-crypto.ts:2420-2428`).

This hit the first message of a conversation (ADR 0092; Alex, 2026-11-21 18:31Z). Bob's browser often gets Alice's
message before it has downloaded her device list. The message then stayed unreadable for good. The two-browser e2e
failed in two of its later runs.

Element ships the other mode. Its labs setting `feature_exclude_insecure_devices` defaults to off (element-web v1.12.35
`apps/web/src/settings/Settings.tsx:508-517`). With the setting off, Element sets `AllDevicesIsolationMode(false)`
(`apps/web/src/settings/controllers/DeviceIsolationModeController.ts:32-39`). That mode decrypts with
`TrustRequirement.Untrusted` (`rust-crypto.ts:2280-2286`). Element then shows each message's shield from
`getEncryptionInfoForEvent` (`apps/web/src/viewmodels/room/timeline/event-tile/EventTileE2eViewModel.ts:177-194`).

The Rust crypto's lax shield (matrix-sdk-common 0.19.0, `deserialized_responses.rs:139-184`; the SDK calls it at
`rust-crypto.ts:2530-2531`) maps each case as follows:
- a device its owner never signed: red, "Encrypted by a device not verified by its owner";
- an unknown device: red; the comment there says to look again when the sender's devices change;
- a sender who is not the device's owner, or who changed a verified identity: red;
- a key restored from backup: grey;
- an unverified person: nothing.

Element draws red as a warning padlock and grey as a plain one (`EventTileE2eState.ts:204-209`).

## Decision
1. **Decrypt as Element does.** The chat page sets `AllDevicesIsolationMode(false)`, Element's default
   (`apps/chat/matrix/client.ts`). A message decrypts whichever of the sender's devices sent it.
2. **Encrypt as Element does.** Keys go to every device of the room's members. That is the SDK's
   `globalBlacklistUnverifiedDevices` default, false (`rust-crypto.ts:428`), which Element's
   `blacklistUnverifiedDevices` setting leaves alone by default (`Settings.tsx:1144-1153`). The page does not change it.
3. **A warning on a message from a device that has not been confirmed.** A message whose shield is red shows a warning
   icon and "Sent from a device that hasn't been confirmed" under it. The wording has no Matrix words. The page reads
   the shield again whenever a device list or a person's trust changes. A message whose shield cannot be read is
   marked too. Grey is not marked, as Element marks it only with a plain padlock.
4. **Device proofs come later.** A second factor that proves a new device (the "2FA" layer Alex named) is not built
   now and gets its own record when it is.

## The threat this accepts
A server that is compromised, or run against its members, could add a device to an account. It would hand that
device's keys out in `/keys/query`.
- **Decrypt side.** A message the added device sends now decrypts, but it carries the warning. The device is not
  signed by the account's own cross-signing key, which only the member's browsers hold (ADR 0083 decision 1).
- **Encrypt side.** Members' browsers now share room keys with the added device too, so it can read new messages.
  Before this record, OnlySigned mode withheld keys from devices its owner had not signed.

This is Element's default exposure. Alex accepted it for now, with device proofs to follow.

## Alternatives
- **Keep `OnlySignedDevicesIsolationMode` and retry decryption ourselves when device lists change.** The retry call
  (`MatrixEvent.attemptDecryption`) is marked internal in the SDK. Using it changes how the SDK handles failures, which
  breaks Alex's rule to use the SDK as intended. Not chosen.
- **Fetch the sender's devices before decrypting (`getUserDeviceInfo` with `downloadUncached`).** It sends a raw
  `/keys/query` that never reaches the OlmMachine (`rust-crypto.ts:556-637`), so it does not help. Disproved from the
  source.
- **`AllDevicesIsolationMode(true)`.** Sending would fail when a verified person has unsigned devices. Element keeps
  `false` until it has better UI (`DeviceIsolationModeController.ts:36-37`). Not chosen.

## Consequences
- The first message of a new conversation reads on the other side even when it arrives before the sender's device
  list.
- A device the server adds is visible on every message it sends, but it receives room keys.
- ADR 0083's promise holds: our servers hold no key that can read a message, because the server cannot sign a device
  with a member's cross-signing key.

## Compliance
- `apps/chat/matrix/conversations.test.ts`: `unconfirmedDevice` marks red shields only; `toMessages` carries the mark.
- `tests/e2e/chat-two-browsers.chromium.spec.ts`: the first message reads after the other person accepts, in every
  run. No message from a signed device carries the warning, including history read from the key backup.
