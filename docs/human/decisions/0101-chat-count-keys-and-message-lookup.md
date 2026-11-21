---
status: Accepted
date: "2026-11-21"
step: P6.12
accepted:
  at: "2026-11-21T17:59Z"
  head: "4eb6c45d"
  line: "yes"
---
# 0101 — The door issues a pushkey per browser entry, keeps one number per entry, and answers web and the Message link on a port and a path of their own

Record: Accepted by Alex 2026-11-21 ("yes" in the project chat, 17:59Z); proposed 2026-11-21 (P6.12, build step 10 of the minimal chat build). Carries out ADR 0094
(the chat count through a pusher to the door; accepted, on PR #1862's branch); builds on ADRs 0093 (the door), 0095
(the browser list) and 0099 (the chat page).

## Context
ADR 0094 settles the path: the chat page registers an HTTP pusher, Synapse posts `counts.unread` to the door's
internal address, web reads the number, and the Message button is a plain link to `https://unset.cc/dm/<did>` whose
chat ID the door looks up. It leaves open what a pushkey is bound to, how the door keeps it, what web's read looks
like, and who may learn a member's chat ID.

What the pinned sources say, read 2026-11-21: Synapse 1.165.0 `synapse/push/httppusher.py` posts
`{"notification": {..., "counts": {"unread": n}, "devices": [{"app_id", "pushkey", "pushkey_ts", "data"}]}}`; a
badge-only update (`_send_badge`, after a read receipt) also carries `"id": "", "type": null, "sender": ""` and its
answer is not read; an event push removes each pushkey the answer lists in `rejected` (lines 377-392). Matrix spec
v1.18, push gateway API: only `devices` is required, `rejected` lists pushkeys the gateway does not know. The browser
list keeps an entry, and its device, across sign-ins (ADR 0095 decision 4); a reload is a new sign-in (ADR 0099).

## Decision
1. **A pushkey belongs to one browser entry.** `POST /push/key { deviceId }` on the door's public listener, behind its
   Host and CSRF checks, issues 32 random bytes to the entry of the device this browser holds (401 otherwise); the
   page calls `setPusher` with it once per sign-in. A new key replaces the entry's last one, so the old pusher is
   answered `rejected` the next time it is used. Only the key's sha256 is stored (`door.push`, migration 0040), with
   the latest number and when it came; the row goes with its entry (Log out, an ended device, erasure).
2. **The internal listener is a separate port** with two routes and nothing of the public door:
   `POST /_matrix/push/v1/notify`, parsed strictly (an object with exactly `notification`, its `devices` a list of 1 to
   16 objects each with a 43-character base64url `pushkey`, and `counts.unread` if present a whole number), answers
   `{ "rejected": [...] }` with every key it does not hold; and `GET /count?did=<did>` answers `{ "unread": n }` or
   `{ "unread": null }`, the number counted last over that member's entries. Neither logs a DID, key or number. The
   public listener answers 404 for both paths. Only Synapse and web share its network; Synapse's
   `ip_range_whitelist` holds only its address (ADR 0094 decision 2), since a pusher's URL is whatever the browser
   sets, and `push.include_content: false` keeps a body or sender out of every push. C36 pins both.
3. **The Message link is resolved only for a signed-in browser, and only to a member whose public page shows.** The
   door serves the page at `/dm/<did>`; after sign-in the page posts `{ deviceId, did }` to `POST /chat-id`, which
   needs a device this browser holds and reads a view, `door.chat_contact`, owned by migrator: `app.chat_account`
   rows in state `ready` joined to `idx.public_profile`. A hidden, deactivated, suspended or erased member, one with
   no chat account and one without a published profile all read as the same 404 (SE-2, D7). The page then opens the
   conversation as step 9's start route `/?with=<chat ID>` does. `chat_auth` gets SELECT on the view's two columns
   only, never on `app.chat_account` or `idx`.

## Alternatives
- **web puts the chat ID in the link** (`unset.cc/?with=<chat ID>`), with web's existing grant. The public profile is
  the same bytes for every visitor and is cached (P3.12s, D7), so every visitor, signed in or not, would learn that
  the member has chat and their chat ID; ADR 0094 decision 6 also names the DID link. Declined.
- **The pushkey as an HMAC of the entry**, so the same key comes back each time. Needs a new key to keep; replacing
  the key per sign-in costs one dropped pusher. Declined.
- **The count read on the public listener.** Any browser could ask for any DID's number. Rejected.

## Consequences
- The view depends on `idx.public_profile`; rebuilding `idx` (DA-1) drops and recreates it with the idx views.
- A signed-in chat member can still learn whether a member with a visible profile has chat (they could ask to talk
  anyway); the door's per-address rate limit bounds the asking.
- The owner of a public page sees its Message button too (the page is the same for everyone); the door answers their
  own DID like any other, and the page refuses to start a chat with itself.

## Compliance
`domains/messaging/push.test.ts` and `contact.test.ts`; `tests/integration/postgres/push-key-store.test.ts` and
`chat-contact-store.test.ts` as `chat_auth`; `tests/integration/chat-auth/door.test.ts` (denials, the internal port
not on the public one, strict bodies, no DID or key in the logs); `tests/integration/web/app/chat-count.test.ts` and
the public profile's Message test; the grant matrix; C36's `ip_range_whitelist` and `push`.
