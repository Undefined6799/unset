---
status: Accepted
date: "2026-11-21"
step: P6.00
accepted:
  at: "2026-11-21T00:55Z"
  head: "8ecf98a3"
  line: "yes"
---
# 0094 — The chat count reaches unset.sh through a Synapse pusher to the door; unset.sh carries no chat code

Record: Accepted by Alex 2026-11-21 00:55Z: asked in the project chat whether he accepts this record as it stands, he
answered "yes" (P6.00, minimal chat build, 2026-11-21). That the badge shows a count and nothing else is Alex's
decision of 2026-11-20 in the chat planning thread ("New messages: count only at launch"); the path the count takes is
accepted by that answer.

## Context
PLAN §5.6 says "the app shell shows no chat badge in the MVP, because chat state lives on the chat origin". On
2026-11-20 Alex asked for a chat icon with a count on unset.sh, count only, so no sender or text reaches unset.sh.

The design of 2026-11-20 had `chat-admin` hold a badge session per member (security pass finding 12: a store of live
tokens for every member). The spike showed a pusher is removed when the device that registered it is revoked, so a
registration made once with a thrown-away token does not survive. The build plan of 2026-11-21 uses the stock path
instead: the chat page registers the pusher on its own session.

What the pinned sources say, read 2026-11-21:
- An HTTP pusher's `url` must have the path `/_matrix/push/v1/notify`, and `format: "event_id_only"` sends no sender
  and no content (Synapse 1.162.0 `synapse/push/httppusher.py`, lines 156 and 484; Matrix spec v1.18 push gateway
  API, where only `devices` is required). Synapse also sends a badge-only update when a read receipt changes the
  number (`on_new_receipts`, `_update_badge`). A pushkey the gateway answers as `rejected` is removed (lines 377 to 392).
- The badge counts chats, not messages, because `push.group_unread_count_by_room` defaults to true
  (`synapse/config/push.py`, line 36), and every pending invite adds one (`synapse/push/push_tools.py`,
  `get_badge_count`, lines 30 to 33). So a message request lights the count. That answers the build plan's
  unverified item 5 from the source; build step 10 tests it.
- Synapse refuses to call private addresses by default. `ip_range_whitelist` is for "a push server only visible in
  your network" (Synapse 1.162.0 `config_documentation.md`); it also applies to federation and identity servers,
  which are off.
- The SDK call is `client.setPusher(pusher)` (matrix-js-sdk 43.0.0 `lib/client.d.ts`, `IPusherRequest` in
  `lib/@types/PushRules.d.ts`).

## Decision
1. **The chat page registers one HTTP pusher per browser after sign-in:** `kind: "http"`, a constant `app_id`, a
   random pushkey the door issued for that browser and maps to the member, and `data: { url: <the door's internal
   address>/_matrix/push/v1/notify, format: "event_id_only" }`.
2. **Synapse's `ip_range_whitelist` holds only the door's count address.** Synapse's network has no other outbound
   route, so a member cannot aim a pusher at another internal service or out to the internet.
3. **The door's count port is internal and separate from its public listener.** It stores the latest
   `counts.unread` per member, overwriting the last, and answers `rejected` for a pushkey it does not know, so a
   pusher left behind by a removed browser is dropped by Synapse.
4. **The number means "chats with new messages"**, a pending message request counting as one.
5. **`web` reads the number from the door when it renders the chat icon**, through a net-guard policy for that one
   internal origin. A chat outage hides the number and nothing else.
6. **unset.sh carries no chat code.** The chat icon is a plain link to `https://unset.cc/`, and the Message button on a
   profile is a plain link to `https://unset.cc/dm/<did>`. The chat page asks the door for that member's chat ID and
   opens or starts the conversation.

## Alternatives
- **A badge session per member held by `chat-admin`.** A token store for every member (finding 12). Rejected.
- **One pusher registered at account creation, its token thrown away.** Fails: revoking the session removes the
  device and its pusher (spike, 2026-11-20).
- **No badge, as PLAN §5.6 said.** Declined by Alex on 2026-11-20.
- **The count drawn by chat code inside unset.sh (the dock).** Deferred with the dock.

## Consequences
- Supersedes PLAN §5.6's "no chat badge in the MVP" line, and extends step book P6.12 so it also feeds unset.sh.
- The count starts once a member has opened chat, which the signup step guarantees. After they log out of every
  browser it stops updating until chat is opened again.
- A script on an unset.sh page can see the number, and only the number (trust boundaries, chat architecture plan).
- The count per member is personal data in the door's schema: overwritten on each change, deleted by `eraseDid`,
  listed in the export.

## Compliance
- Build step 2: a startup check that `ip_range_whitelist` is exactly the door's count address.
- Build step 10: tests that a message and a request raise the count, a read lowers it, a notify for an unknown
  pushkey is answered `rejected`, the count port is unreachable from the edge, and nothing but the number reaches web.
