---
status: Accepted
date: "2026-11-21"
step: P6.10
amends:
  - adr: "0104"
    part: "the two places named below"
accepted:
  at: "2026-11-21T22:18:09Z"
  head: "498e066e93e94990e37625e732030c0d1ead8805"
  line: "id say keep as built -> we can implement our own security on top as I mentionned earlier"
---
# 0106 — Chat keeps Element's device trust as built, and what that gives up (amends 0104)

Record: Accepted by Alex, 2026-11-21 22:18:09Z, in the project chat: "id say keep as built -> we can implement our
own security on top as I mentionned earlier", against `claude/chat-p6-fix-rooms` at head
498e066e93e94990e37625e732030c0d1ead8805. From here the record changes only to be marked superseded. It amends ADR
0104 in the two places named below and leaves 0104's text as accepted.

## Context
ADR 0104 set `AllDevicesIsolationMode(false)`, Element's default, so the chat page decrypts whichever of a sender's
devices sent a message and sends room keys to every device of the room's members (matrix-js-sdk 43.0.0
`src/rust-crypto/rust-crypto.ts:2280-2286`, `:428`). Its "threat this accepts" section covered a device the server
adds. The review of the chat build named two more consequences of the same choice, and 0104's Consequences overstate
what ADR 0095's promise still covers. Alex was asked whether to keep the mode or change it, and chose to keep it.

## Decision
1. **Keep `AllDevicesIsolationMode(false)` as built** (ADR 0104 decisions 1 and 2 stand).
2. **What this gives up, stated plainly:**
   - (a) **An accepted risk.** A browser signed in through unset.sh that has not entered the recovery key still syncs while locked, and it
     receives the room keys for every new message. So the recovery key protects history only, and a stolen unset.sh
     session can read new chat messages. Alex accepts this for now; Unset's own 2FA layer (decision 4) is its planned
     mitigation.
   - (b) Anyone who can create a device (chat-admin, MAS, web's ticket key) can read new messages, and the sender sees
     no warning. The page marks only received messages.
3. **Correction to ADR 0104's Consequences.** Its line "ADR 0095's promise holds: our servers hold no key that can
   read a message" holds for history only. A new device is given a room key from the point it is shared (Megolm
   ratchets forward), and it cannot open the key backup without the recovery key, so messages sent before it existed
   stay out of its reach; that it also gets no older key by key forwarding is unverified in this build until a test
   shows it. A message sent after it reaches that device, by (a) and (b).
4. **The later mitigation is Unset's own second factor.** Alex's planned 2FA/TOTP layer for Unset ("we can implement
   our own security on top") is meant to go on top: a new device, or a browser's chat sign-in, would need it before
   the device counts. It gets its own record when it is designed; until then (a) and (b) stand.

## Alternatives
- **`OnlySignedDevicesIsolationMode` again**, so keys go only to devices their owner has cross-signed. A locked
  browser and a device the server adds would get no keys, but the first message of a conversation could stay
  unreadable for good (the race ADR 0104 records), and Alex chose against it at 19:12Z. Not chosen.
- **`AllDevicesIsolationMode(true)`**: sending fails when a verified person has an unsigned device, and Element keeps
  `false` until it has better UI (element-web v1.12.35
  `apps/web/src/settings/controllers/DeviceIsolationModeController.ts:36-37`). Not chosen.

## Consequences
- The recovery key is a lock on history, not on new messages. Product text that describes it must not say more.
- Whoever holds an unset.sh session, or can mint a device through chat-admin, MAS or web's ticket key, can read new
  messages until the second factor exists. Those holders stay as tightly held as ADRs 0093, 0095 and 0100 make them.
- ADR 0104 now reads with decision 3 here in place of its "ADR 0095's promise holds" line.

## Compliance
- Review: any later change to the isolation mode, or the second-factor record, names this record.
- `tests/e2e/chat-two-browsers.chromium.spec.ts` keeps checking that messages from signed devices carry no warning.
