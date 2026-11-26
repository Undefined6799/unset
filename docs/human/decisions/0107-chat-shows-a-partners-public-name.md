---
status: Accepted
date: "2026-11-21"
step: P6.10
accepted:
  at: "2026-11-21T22:32:17Z"
  head: "52e82aadb0d16b41f6751cdb24fefee0a6399bbe"
  line: "i do not mind allowing app wide search but it would need to be almost semantic if it makes sense, propose people that are matching the best"
---
# 0107 — Chat shows a partner's public profile name, read-only, to any signed-in member

Record: Accepted by Alex, 2026-11-21 22:32:17Z, in the project chat: "i do not mind allowing app wide search but it
would need to be almost semantic if it makes sense, propose people that are matching the best", against
`claude/chat-p6-profile-name` at head 52e82aadb0d16b41f6751cdb24fefee0a6399bbe. That answer chose, of the options
put to him, that any signed-in member may look up a shown member's public name by chat ID; the read-only view itself
was approved on the decision card at 22:20:53Z ("Yes, read-only, public names only"). People search is a separate,
later idea and is not part of this record. From here the record changes only to be marked superseded.

## Context
The chat page shows a partner by their chat display name, which chat-admin sets to the member's handle when it creates
the account (`domains/messaging/chat-account.ts`, account.create). Alex asked for the profile name with the handle under
it (2026-11-21 22:18:09Z). The name lives in `idx.profile`, which only the indexer and web's views can read; chat_auth,
the door, could read only `door.chat_contact` (migration 0047, ADR 0101 decision 3). Copying the name into Synapse would
put a second copy of personal data in the homeserver, and members cannot set it there (C36, ADR 0098).

## Decision
1. **What chat_auth can now see.** `door.chat_name` (migration 0053), a view over `door.chat_contact` joined to
   `idx.profile`: `(chat_user, display_name)` of members whose chat is ready and whose public page shows, by web's own
   rule (`idx.public_profile`). It is read-only, holds no row, and copies nothing. chat_auth has SELECT on those two
   columns and nothing under them.
2. **Who may ask, and how.** `POST /chat-name` on the door reads exactly `{ deviceId, chatId }` and answers
   `{ name }`. It takes the same checks as `/chat-id`: the browser cookie must hold the device it names, in the same
   rate-limit bucket. Any browser signed in to chat may ask for any chat ID on this server; it is not limited to
   people the caller already talks to, since the door has no view of room membership and adding one would be a new
   boundary (a chat-admin action or Synapse egress). A hidden or unknown member, an empty name and one longer than
   the lexicon allows all read as the same 404.
3. **The page cleans what it shows.** It strips bidi controls and control characters, folds spaces, and cuts the
   name to the lexicon's 64 graphemes. It shows the handle alone when there is no name.

## Personal data (GDPR)
- **Data:** the display name a member published in their public `sh.unset.profile` record, already shown on their
  public page. No new data is collected or stored.
- **Purpose:** showing a chat partner by the name on their public profile, over their handle.
- **Lawful basis:** the same as the public profile it comes from: contract (GDPR Art. 6(1)(b)), as in the ROPA's
  "Indexing members' public profiles" row. Only members have chat accounts, so no non-member's name is reachable.
- **Erasure:** follows `idx.profile` and `eraseDid`. The view holds nothing; when the record is deleted, the account
  is hidden or erased (`core.erase_did`), the name stops being answered. The page keeps answers in memory only, for
  as long as it is open.
- **Export:** nothing new. Nothing is stored for the reader or the member beyond the record they already published.

## The cost accepted
A chat ID becomes linkable to a public name for any signed-in member. ADR 0010 keeps chat IDs opaque on the page;
this lets a member who holds a chat ID (from a room they are in or invited to, or otherwise) learn whose public page
it belongs to. `/chat-id` already gives the opposite link, a shown member's chat ID from their DID, to the same
callers, so the new link adds little; members with no public page stay unlinked.

## Alternatives
- **Limit the lookup to people the caller shares a conversation with.** The door would need room membership: a new
  chat-admin action over Synapse's admin API, or door calls to Synapse with the member's token. Either is a new
  boundary for a name that is public already. Not chosen.
- **Copy the name into the homeserver's display name.** A second copy of personal data in Synapse, kept in step by a
  job, against "nothing copied". Not chosen.

## Consequences
- The edge needs no change on this branch: it sends every unset.cc path but `/_matrix/client/` to the door.
- Showing the name anywhere else in chat (requests, notifications) reuses the same lookup and cleaning.

## Compliance
- `tests/integration/postgres/chat-name-view.test.ts`: chat_auth reads a shown member's name, nothing for a hidden one,
  and cannot read `idx.profile` or `idx.public_profile`.
- `tests/integration/chat-auth/door.test.ts`: `/chat-name` denial cases, 404 for hidden and unknown, no personal data
  in logs.
- `apps/chat/core/public-name.test.ts` and `tests/e2e/chat-two-browsers.chromium.spec.ts`: cleaning, fallback, and
  name over handle in real browsers.
