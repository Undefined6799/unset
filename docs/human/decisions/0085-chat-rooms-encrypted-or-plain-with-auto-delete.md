# 0085 — Chat rooms are encrypted by default; a plain room is explicit and its messages are deleted after 30 days

Status: Accepted by Alex 2026-11-21 on three decision cards in the chat build thread: "Allow plain, auto-delete"
(01:27Z; the option read "Plain messages are allowed, search indexing is off, and stored messages are deleted after a
set time"), then "Server allows it, no client UI yet" (01:28Z; "The server stops refusing plain messages and keeps
30-day auto-delete, but our page only sends encrypted for now. The UI comes later."). Before those cards this record
said the server refuses every unencrypted message, which Alex had accepted at 00:55Z; it was revised before merge.
On 01:29Z he added that the chat shows an encrypted icon, encrypted by default, with plain as a choice (P6.00 and
P6.10a, minimal chat build).

## Context
The minimal chat promises end-to-end encryption by default. Alex asked that a member who cannot unlock their keys is
not shut out of plain messaging. A plain message must be stored on the server until every member has fetched it, so
"no logs" is not possible; what is possible is that plain text is not indexed and is deleted after a fixed time.

Read and tested 2026-11-21 against Synapse v1.165.0 (P6.10a, PR #1864):
- With `encryption_enabled_by_default_for_room_type: all` the only way to make a plain room is an `m.room.encryption`
  event with any string algorithm, a room that looks encrypted but is not (`handlers/room.py:1794-1810`). So the
  setting is `"off"` and the module adds Megolm to every room not explicitly asked for as plain.
- Message retention (`config_documentation.md` `retention`, `message_retention_policies.md`) purges expired events
  from `event_json` and `event_search` (`storage/databases/main/purge_events.py`); the other member then gets 404 from
  `/event` and nothing from `/messages` or `/sync`. State events are never purged.
- Synapse never purges a room's newest event (its forward extremity, `purge_events.py:188`): an idle plain
  conversation keeps its last message stored, hidden from clients after `max_lifetime`, until a later message expires.
- `enable_search: false` stops all writes to `event_search` (`storage/databases/main/search.py:84`).
- Module callbacks `check_event_for_spam`, `user_may_create_room` and `on_create_room` (`spam_checker_callbacks.md`,
  `third_party_rules_callbacks.md`, unchanged from v1.162.0).

## Decision
1. **Two kinds of room, fixed at creation.** Encrypted (the default: `{preset, is_direct, invite}`; the module adds
   Megolm) accepts only `m.room.encrypted` with exactly the Megolm keys, and its history is never auto-deleted. Plain
   (explicit: the same request plus exactly one initial state event, `m.room.retention {max_lifetime: 2592000000}`)
   accepts only `m.room.message` with `{msgtype: "m.text", body}`.
2. **In both kinds** every state change and every redaction after creation is refused, so encryption and the retention
   policy cannot be changed or removed; room upgrades are refused; any other createRoom shape is refused.
3. **Server settings:** `encryption_enabled_by_default_for_room_type: "off"`, `enable_search: false`,
   `retention: {enabled: true, allowed_lifetime_max: 30d, purge_jobs: [{interval: 12h}]}` with no `default_policy`
   (that would purge encrypted history too), and the module `unset_chat_policy.RoomPolicy` with no config. A stack
   without the module must not start (preflight C36).
4. **Our page sends encrypted only for now** and shows an encrypted icon on the conversation. Starting a plain chat is a
   later UI step; a room can never switch from encrypted to plain, so "turning encryption off" means starting a plain
   chat.
5. **One Python module** (the PLAN §5.6 exception: standard library and Synapse's module API only, one folder,
   black-box tests from Vitest, built into our pinned image) in `infrastructure/matrix/synapse-module`.

## Alternatives
- **Refuse every plain message** (this record before the revision). Strongest privacy; Alex chose otherwise so a
  locked-out member can still message.
- **Plain by default unless both people have keys.** Most chats would be readable on the server for 30 days. Rejected
  on the card.
- **A server-wide `default_policy` of 30 days.** Would also delete encrypted history. Rejected.

## Consequences
- Plain messages are readable in the database, and in backups for the backup's own retention, until purged.
- **Idle plain rooms are deleted.** Alex chose "Yes, delete idle plain chats" on a decision card (2026-11-21 01:59Z;
  the option read "A scheduled job deletes a plain chat once its newest message is over 30 days old, so nothing stays
  stored. The chat disappears for both people."). Synapse never purges a room's newest event, so a scheduled job
  deletes, through Synapse's admin room-delete API, each plain room whose newest message is over 30 days old. Which
  process holds the Synapse admin credential for it is settled in build step 11.
- Member events (an invite `reason`) reach no module callback; they are not covered.
- Narrows, for now, PLAN §5.6's "the server enforces no message text before a request is accepted" to our client.
- Every Synapse update reruns the module's tests before the pin moves.

## Compliance
- P6.10a: `room-policy.test.ts` and `retention.test.ts` against the pinned Synapse image.
- P6.02: preflight C36 checks the settings above and the module entry.

## Follow-ups
- [ADR 0092](0092-chat-reactions-replies-and-seen-receipts.md) amends decisions 1 and 2. Reactions, replies and own
  reaction redactions are allowed (Alex, 2026-11-21 18:59Z).
