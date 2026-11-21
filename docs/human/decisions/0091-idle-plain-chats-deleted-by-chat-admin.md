# 0091 — Idle plain chats are deleted by chat-admin, with a Synapse admin session it mints through MAS for each run and revokes at its end

Status: Accepted by Alex 2026-11-21 ("accept" in the chat build thread, 17:40Z); proposed 2026-11-21 (P6.04a, build step 11 of the minimal chat build). The credential model is
Alex's call of 2026-11-21 13:52Z on a decision card (option A): `chat-admin` mints a short-lived session with Synapse
admin scope through MAS for a dedicated service user on each run, uses it for that run only and never stores it, and
a scheduled job in `web` triggers it with a new fixed, signed `chat-admin` command. Carries out the "idle plain rooms
are deleted" consequence of ADR 0085 (accepted, on PR #1862's branch). Amends ADR 0081 decisions 1, 5 and 6 and ADR
0086 decision 4 in the parts named under Consequences, and nothing else in them.

## Context
ADR 0085 lets a room be plain, with a 30-day retention policy, and records Alex's card of 01:59Z: "A scheduled job
deletes a plain chat once its newest message is over 30 days old, so nothing stays stored." Retention cannot do it
alone: Synapse never purges a room's newest event (ADR 0085, `purge_events.py:188`). Deleting a room needs the
Synapse admin API, and ADR 0085 left open which process holds that credential.

What the pinned sources say (Synapse 1.165.0 sdist, MAS 1.26.0 docs; read 2026-11-21):
- **Who is a Synapse admin under MAS.** Synapse accepts a token only if its scope holds `urn:matrix:client:api:*`
  (`synapse/api/auth/mas.py:333-340`), only for a user it knows (`:352-359`), and treats it as an admin exactly when
  the scope holds `urn:synapse:admin:*` (`:269-270`). The admin power cannot be narrowed: it is that one string. The
  book's P6.02 note stands: MAS refuses `urn:synapse:admin:*` to client credentials and Synapse refuses a token with
  no user, so a user is needed.
- **Minting.** `POST /api/admin/v1/personal-sessions` takes `actor_user_id`, `human_name`, `scope` and `expires_in`
  ("If not set, the token won't expire", `docs/api/spec.json`, `CreatePersonalSessionRequest`); `POST
  /api/admin/v1/personal-sessions/{id}/revoke` ends it. Checked on the live 1.26.0: an admin client minted
  `urn:matrix:client:api:* urn:synapse:admin:*` for a new user that is not a MAS admin, and Synapse answered its
  admin API. A revoked token keeps working for about two minutes (ADR 0081 Context).
- **The admin API is on the client resource.** Synapse mounts `/_synapse/admin` only with a listener's `client`
  resource (`synapse/app/homeserver.py:183-195`); there is no admin-only resource.
- **The calls.** List rooms, `GET /_synapse/admin/v1/rooms`, offset paging with `from`, `limit` and `next_batch`, each
  room with `encryption` (`docs/admin_api/rooms.md:1-80`, `rest/admin/rooms.py:285-346`). Room state, `GET
  .../rooms/{id}/state` (`rooms.md:379-410`). Timestamp to event, `GET .../rooms/{id}/timestamp_to_event?ts=&dir=f`
  (`rooms.md:527-556`): the earliest event with `origin_server_ts >= ts` that is not an outlier or rejected
  (`storage/databases/main/events_worker.py:2582-2606`), state events included; if there is none it asks other
  servers, never its own (`federation/federation_client.py:923-924`, and federation is off), then answers 404
  `M_NOT_FOUND` (`handlers/room.py:2186-2285`). Delete Room v2, `DELETE /_synapse/admin/v2/rooms/{id}`, with `block`
  (default false), `purge` (default true) and no `new_room_user_id`, so no room is made and members just leave; it
  answers a `delete_id` at once and `GET .../v2/rooms/delete_status/{delete_id}` reports `scheduled`, `active`,
  `complete` or `failed` (`rooms.md:635-660, 709-899`, `rooms.py:139-269`). Our room rule has no
  `check_can_shutdown_room` callback, so it does not stand in the way (`rooms.py:184-190`).
- The whole sequence (mint, list, state, timestamp 404 on a room whose events were dated back, delete with purge,
  status `complete`, the room then 404) ran against the dev Synapse 1.162.0 and MAS 1.26.0 on 2026-11-21.

## Decision
1. **One fixed command, `rooms.sweep`.** Only `web`'s key may sign it. Its envelope names no account, room, scope or
   path: `user` and every other field are `""`. `chat-admin` finds the rooms itself; nothing a caller sends chooses
   what is deleted. Its quota is 6 an hour, and runs never overlap (they share one per-account chain).
2. **A service user, `unset-room-sweeper`.** The hyphen keeps it out of member names, which are 12 to 64 of `a-z0-9`.
   `chat-admin` creates it on the first run (a retry is harmless) and refuses to sweep if MAS has it locked or
   deactivated. It has no password (MAS passwords are off), joins no room, and has no session between runs.
3. **One session per run, in memory only.** Each run mints a session for the service user with the constant scope
   `urn:matrix:client:api:* urn:synapse:admin:*` and `expires_in: 120`, keeps the token in the run's own variables,
   never logs, stores or returns it, and revokes the session when the run ends, whatever happened. It can still work
   for about two minutes after the revoke, so its whole life is at most about four minutes. Because the admin power
   cannot be narrowed (Context), the narrowing is ours: one file sends to Synapse, and only the five calls above, by
   fixed path with the room ID percent-encoded.
4. **What is deleted.** A room is deleted only if all of these hold, read in this run: the list says `encryption`
   null; its current state holds no `m.room.encryption` event and exactly one `m.room.retention` event, state key `""`,
   with `max_lifetime` 2592000000 (ADR 0085's plain room); and it has no event at all since 30 days ago (timestamp to
   event answers 404 `M_NOT_FOUND`). Any other answer, shape or failure keeps the room. The delete body is exactly
   `{"block": false, "purge": true}`, and the run waits for `complete` or `failed`.
5. **"Idle" is "no event of any kind for 30 days".** That is stricter than the card's "newest message over 30 days
   old": a join or a leave in the last 30 days keeps the room for another 30. "No messages left" cannot be the test,
   since Synapse keeps the newest one; that is why the job exists.
6. **Bounds (rule RE-1).** `web` runs the job hourly and waits 30 seconds, net-guard's longest call
   (`infrastructure/net-guard/src/request.ts`, `MAX_TIMEOUT_MS`). A run stops starting work 25 seconds after it began,
   when its envelope expires or when `web` hangs up, whichever is first; each Synapse or MAS call has 5 seconds; a run
   reads at most 100 pages of 100 rooms and deletes at most 50; nothing is retried inside it: the next run is the
   retry. A delete still running when the run stops is counted failed and finishes in Synapse on its own.
7. **Logs carry counts only**: rooms listed, plain rooms checked, deleted, kept and failed. Never a room ID, user ID,
   delete ID or token (rule SE-7).
8. **A network path from chat-admin to Synapse, and nothing else.** Synapse gets a second listener with only the
   `client` resource, bound to its fixed address on a new internal network that only Synapse and `chat-admin` join;
   `SYNAPSE_ADMIN_URL` names it, and `chat-admin` refuses to start if it resolves to a public address. The edge and the
   door keep reaching only the first listener, and the edge still refuses `/_synapse/*`. The Compose wiring lands with
   the servers' Compose services, as ADR 0086 says.

## Alternatives
- **A long-lived Synapse admin token kept as a secret** (in `chat-admin` or a separate process). A stolen copy works
  until someone notices. Not chosen on the card.
- **The job in `web`, or a new process, holding the MAS credential.** Spreads the credential that can act as anyone
  (ADR 0081 decision 5). Rejected.
- **A caller-supplied list of rooms**, checked by `chat-admin`. Adds a field that could name an encrypted room for
  nothing: `chat-admin` has to read every room's state anyway. Declined.
- **The room rule in Synapse deletes rooms itself.** The Python carve-out is for the room rule only (PLAN §5.6), and
  the module API has no scheduled delete. Declined.
- **Block on delete.** Nobody can rejoin a deleted room's ID anyway, and the block row would keep the room ID stored.
  Declined.

## Consequences
- **Amends ADR 0081.** Decision 1: a second constant scope exists, for the service user only and never for a member.
  Decision 5: `chat-admin`'s fixed commands gain `rooms.sweep`; its outbound calls stay in one file, which now reaches
  MAS and Synapse (`interfaces/chat-admin/outbound.ts`, moved out of `mas.ts`). Decision 6: `chat-admin` now reaches
  Synapse, on the network of decision 8 above. **Amends ADR 0086** decision 4: Synapse has two client listeners, not
  one. ADR 0085's open question (who holds the Synapse admin credential) is settled here.
- A compromised `chat-admin` can now act as a Synapse admin, not only as any member. Its exposure per run is the
  session's few minutes, but an attacker inside `chat-admin` can mint their own. This is the "both admin powers in
  one box" that the book's P6-A1 option (b) named for report intake; report intake keeps its own account (P6.15).
- **A race no API closes.** A message sent between a room's idle check and its delete (seconds) is deleted with the
  room. Synapse has no conditional delete. Accepted; the room had been silent for 30 days.
- Both people lose the conversation, as the card said. The other person's client may keep its own copy.
- The service user is in MAS and Synapse but holds no personal data; deleting rooms only removes data, so the erasure
  registry and the export do not change.
- Every Synapse or MAS update reruns the sweep tests and the live check before the pin moves, as for sign-in.

## Compliance
- `tests/integration/chat-admin/sweep.test.ts` against fake MAS and Synapse admin APIs: an idle plain room is deleted
  with exactly the fixed body; an encrypted room, a room whose list entry is plain but whose state holds encryption, a
  room without the retention event and an active plain room are kept; an unexpected answer keeps the room; the token
  is minted with the constant scope and `expires_in` and revoked even when a call fails; the log holds counts only; a
  room list or any non-empty field is refused; only `web`'s key may ask.
- `interfaces/chat-admin` config tests for `SYNAPSE_ADMIN_URL`; the egress guard's exemption names `outbound.ts`.
- `web`'s client test for the command, and a live run against Synapse and MAS (recorded in the PR).

## Follow-up

2026-11-21: MAS pinned at 1.29.0 (Alex, 2026-11-21, 'use the latest version'), re-checked: `personal_sessions/add.rs` and `revoke.rs`, `oauth2_sessions/finish.rs` and the admin `spec.json` are identical to 1.26.0, so minting, revoking and finishing a session hold as written; the live checks recorded above ran on 1.26.0. Read from the v1.26.0 and v1.29.0 source trees on 2026-11-21; no live run of 1.29.0 was possible here (the image pull and the release binary download were both refused), so the 1.29.0 behaviour is unverified until the image test runs it.
