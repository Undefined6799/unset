---
status: Accepted
date: "2026-11-23"
step: P6.02
amends:
  - adr: "0113"
    part: "The cost accepted, its line that the offline device does not widen ADR 0106's accepted risk"
accepted:
  at: "2026-11-23T03:58:25Z"
  head: "5971e8b7595d2f320014a8428526df171ce8fab9"
  line: "just keep it and record the risk, and then we'll adapt to these risks later"
---
# 0116 — Chat keeps the offline device as built and records what any signed-in session can do to it (amends 0113)

Record: Accepted by Alex, 2026-11-23 03:58:25Z, in the review thread: "Yeah, just keep it and record the risk, and
then we'll adapt to these risks later", against `claude/chat-staging-main` at head
5971e8b7595d2f320014a8428526df171ce8fab9. From here the record changes only to be marked superseded. It amends ADR
0113 in the one place named in its front matter and leaves 0113's text as accepted.

## Context
ADR 0113 turned on Element's offline device (MSC3814). An independent security review of commit 5971e8b7 ran Synapse
1.165.0 in MAS mode and found two things the offline device endpoint allows (findings O1 and O2). Both are Synapse's
own behaviour, not our code. 0113 said the offline device "does not widen ADR 0106's accepted risk"; that is not
accurate. Alex was asked to build a check before production, keep it and record the risk, or turn it off. He chose
to keep it and record the risk, and to revisit it with Unset's own 2FA layer.

## Decision
1. **Keep the offline device as built** (ADR 0113 decisions 1 and 2 stand). No check in front of Synapse now.
2. **What any signed-in session of a member can do, stated plainly.** This holds for a session that never entered
   the recovery key. The endpoint is `PUT` and `DELETE /_matrix/client/unstable/org.matrix.msc3814.v1/dehydrated_device`.
   - (a) **Destroy the waiting messages.** It can replace or delete the offline device, and the room keys queued for
     it are lost. Messages sent while the member had no browser in chat then stay unreadable.
   - (b) **Keep reading after sign-out.** A device it uploads in that slot without the dehydrated flag survives the
     MAS device sync when that session ends (Synapse 1.165.0 `synapse/rest/synapse/mas/devices.py:199-207`). Other
     members see it as an ordinary device, so it gets room keys under ADR 0106's all-devices rule. A later session
     can read its queue.
   - (c) **Knock out another browser.** The same `PUT` accepts another browser's device id. It overwrites that
     device's published keys, and the next `PUT` or `DELETE` removes that device. Under MAS the ordinary
     delete-device endpoints are off, so this is a new power.
3. **Correction to ADR 0113's "The cost accepted".** Its line "This does not widen ADR 0106's accepted risk" is
   replaced by: it widens it by (a), (b) and (c). Reading new messages with only a signed-in session was already
   accepted by ADR 0106 (a); lasting past sign-out, destroying queued keys and removing another browser are new.
4. **The later mitigation is Unset's own second factor** (ADR 0104 decision 4, ADR 0106 decision 4). When it is
   built, deleting or replacing the offline device should need it. The item is kept on the deferred security list
   (`docs/human/compliance/deferred-security.md`) until then.

## The known fix, not built
In front of Synapse's client listener, accept the `PUT` only if all three hold:
- `device_keys.dehydrated` is true;
- `device_keys` carries a valid Ed25519 signature by the member's current self-signing key, verified, not just
  present (Synapse stores uploaded device keys unverified);
- `device_id` equals the device's own curve25519 key, as matrix-sdk-crypto 0.19.1 makes it
  (`olm/account.rs:472-480`), which rules out naming another browser's device.

Refuse `DELETE` until the second factor can allow it; the page never calls it. Reading the queue deletes nothing in
1.165.0 and needs no gate. The edge cannot read request bodies, so the check needs a small proxy hop and a new
network path to Synapse: that needs its own record. It does not stop server-side access or an unlocked browser.

## Alternatives
- **Build the check before production.** Closes (a), (b) and (c) for a session, at the cost of a new hop and network
  path. Recommended by the review; not chosen now.
- **Turn the offline device off before production.** Removes the new powers and brings back unreadable first
  messages, which ADR 0113 set out to fix. Not chosen.

## Consequences
- Whoever holds a member's unset.sh session can, until the second factor exists, keep a device reading that member's
  new messages after the session ends, destroy the messages waiting for them, and remove one of their browsers.
- ADR 0113 now reads with decision 3 here in place of its "does not widen" line.
- Reporting (c) to Synapse upstream needs Alex's OK; nothing has been sent.

## Compliance
- `docs/human/compliance/deferred-security.md` keeps this item until it is closed or superseded.
- Review: the second-factor record, or any change to the offline device or to Synapse's client routes, names this
  record.
