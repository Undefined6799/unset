# 0092 — Reactions, replies and seen receipts in chat rooms (amends 0085)

Status: Accepted by Alex 2026-11-21 18:59Z in the project chat. He accepted that the server sees this layer: "it's
just data that we're gonna be trusted to own". This record amends ADR 0085 decision 1 (accepted) in the parts named
below and nothing else in it. It comes from the minimal chat build's review fixes (P6.10, P6.10a).

## Context
ADR 0085 decision 1 lets an encrypted room take only `m.room.encrypted` with exactly the Megolm keys, and decision 2
refuses every redaction. Alex wants chat to work like Element does in three ways:
- a member sees when the other person saw a message, and at what time;
- a member reacts to a message;
- a member replies to a message.

Element does all three with metadata the server can read:
- **Reactions.** A reaction is a plain `m.reaction` annotation (spec v1.18 #event-annotations-and-reactions).
  matrix-js-sdk 43.0.0 never encrypts it (`src/client.ts:3056`). Element offers eight quick reactions
  (element-web v1.12.35 `packages/shared-components/src/core/EmojiPicker/QuickReactions.tsx:22`). To take a reaction
  back, Element redacts it (`apps/web/src/components/views/emojipicker/ReactionPicker.tsx:95-110`).
- **Replies.** A reply puts `m.relates_to: {m.in_reply_to: {event_id}}` beside the ciphertext, in the clear
  (spec v1.18 #rich-replies; Element's `apps/web/src/utils/Reply.ts:52-66`).
- **Seen.** Read receipts are public `m.read` (spec v1.18 #receipts). Element shows them under the last event each
  person has read (`apps/web/src/components/views/rooms/ReadReceiptGroup.tsx`).

## Decision
1. **Reactions.** The server rule (`infrastructure/matrix/synapse-module`) accepts an `m.reaction` in either kind of
   room only when all of these hold:
   - its content is exactly `{m.relates_to: {rel_type: m.annotation, event_id, key}}`;
   - its key is one of Element's eight quick reactions;
   - its target is a message (`m.room.encrypted` or `m.room.message`) in the same room.

   A free key would carry text in the clear, so the page offers that fixed set and the server takes no other.
2. **Taking a reaction back.** A redaction is accepted only of the sender's own `m.reaction` in the same room, with
   no reason. Every other redaction stays refused, messages included. Deleting messages is not decided.
3. **Replies.** A Megolm event may carry `m.relates_to` of exactly `{m.in_reply_to: {event_id}}`, pointing at a
   message in the same room. Edits (`m.replace`), threads and every other relation stay refused.
4. **Seen.** The page sends public `m.read` receipts and shows "Seen" with the time under the last message the other
   person has read.
5. **No room name or picture.** Those state events stay refused.

The module reads a target with `run_db_interaction` (module API since Synapse v0.25.0,
`module_api/__init__.py:1052-1076`). It looks for a non-state, non-rejected row of Synapse's `events` table in the
same room. No other module API reads an event that is not state.

## What the server can now see
- Which of the eight emoji each member put on which message, and when.
- Which message answers which (the reply pointer), and when.
- Up to which message each member has read, and when.

Message text stays encrypted. A reaction is never text, because its key is one of eight.

## Alternatives
- **Encrypted reactions.** matrix-js-sdk will not send them (`client.ts:3056`: "very little gained ... the purpose is
  still obvious from the relation data"), so Element and other clients would not read them.
- **Private receipts (`m.read.private`).** This was the page's setting before this record. Alex wants the other
  person to see "Seen".
- **Any emoji as a key.** That is a plaintext channel inside an encrypted room. Rejected.

## Consequences
- ADR 0085 decision 1 now reads with this record's decisions 1 and 3, and its decision 2 with decision 2 here.
- The module depends on Synapse's `events` table columns `event_id`, `room_id`, `type`, `sender`, `state_key` and
  `rejection_reason`. Every Synapse update reruns `relations.test.ts`, which covers each allowed and refused case,
  before the pin moves.

## Compliance
- `tests/integration/matrix/synapse-module/relations.test.ts`: reactions, replies and taking a reaction back.
- The page's unit tests and `tests/e2e/chat-two-browsers.chromium.spec.ts` for react, reply and seen.
