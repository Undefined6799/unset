# 0085 — Synapse refuses unencrypted messages through one small module, and every new room is encrypted

Status: Proposed (awaiting Alex), 2026-11-21 (P6.00, minimal chat build).

## Context
The minimal chat promises that a message is end-to-end encrypted. Synapse can make every new room encrypted, but no
setting stops a client from sending a plain `m.room.message` into it. PLAN §5.6 already allows one Python module, the
written exception to TypeScript everywhere (decision 32 notes, Alex 2026-10-03: standard library only, one folder,
tested black-box from Vitest, built into a pinned image), planned at about 150 lines for a new-account invite throttle,
"no message text before a request is accepted" for every client, and a refusal of unencrypted media. ADR 0001 places
it in `infrastructure/matrix/synapse-module`.

Read 2026-11-21: `encryption_enabled_by_default_for_room_type: all` (Synapse 1.162.0 `config_documentation.md`;
`synapse/config/room.py`, line 36); the `check_event_for_spam` callback is "called when receiving an event from a
client or via federation" and a returned error code refuses the event (Synapse 1.162.0 `spam_checker_callbacks.md`).
Tested 2026-11-21 against Synapse 1.162.0 (`/mnt/project-files/chat-spike/round3/refuse_plain.py`): a module that
returns `Codes.FORBIDDEN` for `m.room.message` makes Synapse answer 403 to a client's plain message, while
`m.room.encrypted` is accepted. That settles item 2 of the build plan's unverified list in part.

## Decision
1. **`encryption_enabled_by_default_for_room_type: all`** in `homeserver.yaml`.
2. **One module** registers `check_event_for_spam` and returns `Codes.FORBIDDEN` for an `m.room.message` event;
   everything else passes. About 20 lines, standard library and Synapse's module API only, in
   `infrastructure/matrix/synapse-module`.
3. **For now the module does only this.** The invite throttle, the server-side "no text before accept" rule and the
   media refusal wait for the features that need them. In the minimal version the invite is the request, and our
   client keeps the composer off until the other person has joined and `isEncryptionEnabledInRoom` is true. That is a
   client rule only, safe while no other client can sign in (ADR 0081).

## Alternatives
- **The room default alone.** Any client could still send a plain message into an encrypted room. Rejected.
- **The full 150-line module now.** Builds rules for groups, media and third-party clients that the minimal version
  does not have. Deferred.
- **Rely on our client only.** A hacked or modified page could send plain text. Rejected: the server is the last check.

## Consequences
- Narrows, for now, the accepted "the server enforces no message text before a request is accepted for every client"
  (PLAN §5.6, decision 32 notes) to our client. It must be enforced on the server before any other client can sign
  in, or before groups.
- Build step 3 settles which other event types (reactions, redactions, edits) the rule must let through or refuse.
- Every Synapse update reruns the module's tests before the pin moves.

## Compliance
- Build step 3: a black-box test from Vitest against a running Synapse: a plain message is refused with 403, an
  encrypted one passes, and a room created without the encryption flag still comes out encrypted.
- Build step 2: a startup check that the setting and the module are in the config.
