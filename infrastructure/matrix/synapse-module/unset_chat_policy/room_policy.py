"""The server rule (P6.10a): a room is Megolm-only, or plain text that is deleted after 30 days.

Alex, 2026-11-21: plain messages are allowed, search indexing is off, stored
messages are deleted after a set time; our page sends only encrypted for now.
Every room is one of two kinds, fixed at creation, and this module refuses
anything else, failing closed (an allowlist: an unlisted type is refused):

- encrypted (the default): its m.room.encryption is Megolm; only Megolm
  ciphertext may be sent; history is not auto-deleted.
- plain (asked for explicitly): its only initial state is m.room.retention
  with max_lifetime 30 days; only m.text messages may be sent. Synapse's
  `retention` config purges them (docs/message_retention_policies.md).

Callbacks (element-hq/synapse v1.165.0, docs/modules/third_party_rules_callbacks.md
and spam_checker_callbacks.md):

- `on_create_room` sees every /createRoom body, server admins included
  (handlers/room.py:1123), and may add to it. With no initial_state the module
  adds Megolm m.room.encryption (homeserver.yaml sets
  `encryption_enabled_by_default_for_room_type: off`, since `all` would encrypt
  the plain kind too, room.py:1794-1810). With exactly the retention event the
  room is plain. Anything else is refused: name, topic, other initial state,
  creation_content, aliases, 3pid invites, directory visibility.
- `user_may_create_room` refuses room upgrades (room.py:708 passes a
  synthesised creation_content and initial_state).
- `check_event_for_spam` runs for every non-member event a local client sends:
  /send, /state for any type but m.room.member, /redact, delayed events
  (handlers/message.py:1195, `_create_and_send_nonmember_event_locked`). It refuses
  every state event after creation (so neither kind can change, nor its
  retention), every redaction but of one's own message or reaction (below; redacting
  m.room.encryption strips its content, spec v1.18 room v11 redaction rules),
  and in each kind every event but its one
  allowed shape: exactly Megolm's keys (spec v1.18 m.room.encrypted; m.relates_to
  is cleartext), or exactly {msgtype: m.text, body}. A room of neither kind
  accepts nothing.

Reactions, replies and taking a reaction back (ADR 0103, amending ADR 0097
decision 1; Alex, 2026-11-21 18:59Z: "it's just data that we're gonna be
trusted to own"). The server sees which emoji is on which message, which
message answers which, and read times; nothing else is opened up.

- An m.reaction (sent in the clear, as matrix-js-sdk 43.0.0 does, client.ts:
  3056) is exactly {m.relates_to: {rel_type: m.annotation, event_id, key}}
  (spec v1.18 #event-annotations-and-reactions), its key one of Element's
  quick reactions (QUICK_REACTIONS below), its target a message in this room.
  A free key would carry text in the clear, so only that set is taken.
- A Megolm event may carry m.relates_to exactly {m.in_reply_to: {event_id}},
  as Element's makeReplyMixIn writes it (element-web v1.12.35 apps/web/src/
  utils/Reply.ts:52-66; spec v1.18 #rich-replies), pointing at a message in
  this room. Edits, threads and every other relation stay refused.
- A redaction is allowed only of the sender's own m.reaction or Megolm
  message in this room, with no reason (Element's ReactionPicker redacts with
  none, apps/web/src/components/views/emojipicker/ReactionPicker.tsx:95).
  Alex, 2026-11-21 19:23Z: "I do believe that members should be able to
  delete their own messages". Every other redaction stays refused: the other
  person's events, any state event, a plain message (it expires instead).
- Targets are read with run_db_interaction (module API, "Added in Synapse
  v0.25.0", module_api/__init__.py:1052-1076), the only module API that can
  read an event that is not state: a non-state, non-rejected row of Synapse's
  `events` table in the same room. Synapse checks an annotation's target too
  (handlers/message.py:1470-1520), but not a reply's or a redaction's.

A room is for two people, for good. `on_create_room` takes exactly one invitee
and only the private presets (private_chat, trusted_private_chat: join rule
invite, spec v1.18 createRoom), so nobody can join uninvited. Membership
reaches two spam callbacks (handlers/room_member.py): `user_may_invite` for
every local invite, those in /createRoom included (:921), and
`user_may_join_room` for every join but the creator's own (:1082). Both refuse
a third person: anyone who has never had a membership event in the room, once
two people have. Counting leave and ban too keeps a room that one person left
from taking a new person who would then see its history.

Not covered, by Synapse's design: the content of membership events (invite
`reason`, extra keys) reaches no callback; a server admin skips
`user_may_create_room`, `user_may_invite` and `user_may_join_room`, so may
upgrade a room or add a person (room.py:1236); no chat account is an admin.
Synapse never purges a room's newest event (storage/databases/main/
purge_events.py:188), so a plain room keeps its newest expired message until a
later one expires; the docs say it is hidden from clients after 30 days.
An exception in a callback rejects the request, so a bug fails closed.
"""

from collections.abc import Mapping, Sequence
from typing import Any, Literal, Protocol

from synapse.module_api import NOT_SPAM, EventBase, JsonDict, ModuleApi, Requester
from synapse.module_api.errors import Codes, SynapseError

MEGOLM = "m.megolm.v1.aes-sha2"
MEGOLM_REQUIRED = frozenset({"algorithm", "ciphertext", "session_id"})
MEGOLM_OPTIONAL = frozenset({"sender_key", "device_id"})
CREATE_ROOM_KEYS = frozenset({"preset", "is_direct", "invite", "initial_state"})
PRIVATE_PRESETS = frozenset({"private_chat", "trusted_private_chat"})
MEMBER = "m.room.member"
ROOM_SIZE = 2
PLAIN_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000
RETENTION = "m.room.retention"
ENCRYPTION = "m.room.encryption"
REACTION = "m.reaction"
REDACTION = "m.room.redaction"
MESSAGE_TYPES = frozenset({"m.room.encrypted", "m.room.message"})
# What a member may delete of their own (Alex, 2026-11-21 19:23Z): an encrypted
# message, or a reaction to take it back. Plain messages expire instead.
REDACTABLE = frozenset({"m.room.encrypted", REACTION})
# element-web v1.12.35 packages/shared-components/src/core/EmojiPicker/
# QuickReactions.tsx:22, as code points.
QUICK_REACTIONS = frozenset(
    {
        "\U0001f44d",  # thumbs up
        "\U0001f44e",  # thumbs down
        "\U0001f604",  # smiling face with open mouth and smiling eyes
        "\U0001f389",  # party popper
        "\U0001f615",  # confused face
        "\u2764\ufe0f",  # red heart, emoji presentation
        "\U0001f680",  # rocket
        "\U0001f440",  # eyes
    }
)
EVENT_ROW = (
    "SELECT type, sender FROM events WHERE event_id = ? AND room_id = ?"
    " AND state_key IS NULL AND rejection_reason IS NULL"
)

Verdict = Literal["NOT_SPAM"] | Codes


class Cursor(Protocol):
    """What select_event uses of the transaction run_db_interaction passes."""

    def execute(self, sql: str, parameters: tuple[str, str]) -> None: ...

    def fetchall(self) -> list[tuple[Any, ...]]: ...


def is_megolm_content(content: Mapping[str, Any]) -> bool:
    """Exactly the Megolm keys, non-empty strings, the Megolm algorithm; a reply's pointer aside."""
    keys = frozenset(content) - {"m.relates_to"}
    if not MEGOLM_REQUIRED <= keys <= MEGOLM_REQUIRED | MEGOLM_OPTIONAL:
        return False
    if not all(isinstance(content[key], str) and content[key] != "" for key in keys):
        return False
    return bool(content["algorithm"] == MEGOLM)


def reply_target(content: Mapping[str, Any]) -> str | None:
    """The event a reply answers, if m.relates_to is exactly {m.in_reply_to: {event_id}}."""
    relates_to = content.get("m.relates_to")
    if not isinstance(relates_to, dict) or frozenset(relates_to) != {"m.in_reply_to"}:
        return None
    in_reply_to = relates_to["m.in_reply_to"]
    if not isinstance(in_reply_to, dict) or frozenset(in_reply_to) != {"event_id"}:
        return None
    event_id = in_reply_to["event_id"]
    return event_id if isinstance(event_id, str) and event_id != "" else None


def reaction_target(content: Mapping[str, Any]) -> str | None:
    """The message a reaction annotates, if it is exactly a quick-reaction annotation."""
    relates_to = content.get("m.relates_to")
    if frozenset(content) != {"m.relates_to"} or not isinstance(relates_to, dict):
        return None
    if frozenset(relates_to) != {"rel_type", "event_id", "key"}:
        return None
    if relates_to["rel_type"] != "m.annotation" or relates_to["key"] not in QUICK_REACTIONS:
        return None
    event_id = relates_to["event_id"]
    return event_id if isinstance(event_id, str) and event_id != "" else None


def select_event(txn: Cursor, event_id: str, room_id: str) -> Sequence[tuple[str, str]]:
    """(type, sender) rows of a non-state, non-rejected event in `room_id`."""
    txn.execute(EVENT_ROW, (event_id, room_id))
    return list(txn.fetchall())


def is_plain_text_content(content: Mapping[str, Any]) -> bool:
    """Exactly {msgtype: m.text, body: <non-empty string>}, what sendTextMessage sends."""
    if frozenset(content) != {"msgtype", "body"} or content["msgtype"] != "m.text":
        return False
    return isinstance(content["body"], str) and content["body"] != ""


def is_plain_policy(content: Mapping[str, Any]) -> bool:
    return dict(content) == {"max_lifetime": PLAIN_LIFETIME_MS}


def is_plain_request(initial_state: object) -> bool:
    """The explicit ask for a plain room: the 30-day retention event and nothing else."""
    if not isinstance(initial_state, list) or len(initial_state) != 1:
        return False
    event = initial_state[0]
    if not isinstance(event, dict) or frozenset(event) - {"type", "state_key", "content"}:
        return False
    content = event.get("content")
    return (
        event.get("type") == RETENTION
        and event.get("state_key", "") == ""
        and isinstance(content, dict)
        and is_plain_policy(content)
    )


def refuse(reason: str) -> SynapseError:
    return SynapseError(403, reason, Codes.FORBIDDEN)


class RoomPolicy:
    """Loaded from homeserver.yaml `modules:` as unset_chat_policy.RoomPolicy."""

    def __init__(self, config: dict[str, Any], api: ModuleApi) -> None:
        if config:
            raise ValueError("unset_chat_policy.RoomPolicy takes no config")
        self.api = api
        api.register_third_party_rules_callbacks(on_create_room=self.on_create_room)
        api.register_spam_checker_callbacks(
            check_event_for_spam=self.check_event_for_spam,
            user_may_create_room=self.user_may_create_room,
            user_may_invite=self.user_may_invite,
            user_may_join_room=self.user_may_join_room,
        )

    async def on_create_room(
        self, requester: Requester, request_content: dict[str, Any], is_requester_admin: bool
    ) -> None:
        if not frozenset(request_content) <= CREATE_ROOM_KEYS:
            raise refuse("only preset, is_direct, invite and initial_state are allowed")
        if request_content.get("preset") not in PRIVATE_PRESETS:
            raise refuse("a room is private_chat or trusted_private_chat")
        invite = request_content.get("invite")
        if not isinstance(invite, list) or len(invite) != 1 or not isinstance(invite[0], str):
            raise refuse("a room starts with exactly one invitee")
        initial_state = request_content.get("initial_state", [])
        if initial_state == []:
            encryption = {"type": ENCRYPTION, "state_key": "", "content": {"algorithm": MEGOLM}}
            request_content["initial_state"] = [encryption]
            return
        if not is_plain_request(initial_state):
            raise refuse("a room is encrypted, or plain with the 30-day retention policy")

    async def user_may_create_room(self, user_id: str, room_config: JsonDict) -> Verdict:
        if not frozenset(room_config) <= CREATE_ROOM_KEYS:
            return Codes.FORBIDDEN
        return NOT_SPAM

    async def user_may_invite(self, inviter: str, invitee: str, room_id: str) -> Verdict:
        return await self.within_two(room_id, invitee)

    async def user_may_join_room(self, user: str, room: str, is_invited: bool) -> Verdict:
        return await self.within_two(room, user)

    async def within_two(self, room_id: str, user: str) -> Verdict:
        """Refuses `user` if they would be a third person with a membership event in the room."""
        state = await self.api.get_room_state(room_id, [(MEMBER, None)])
        people = {state_key for (kind, state_key) in state if kind == MEMBER} | {user}
        return NOT_SPAM if len(people) <= ROOM_SIZE else Codes.FORBIDDEN

    async def check_event_for_spam(self, event: EventBase) -> Verdict:
        if event.is_state():
            return Codes.FORBIDDEN
        if event.type == REDACTION:
            return await self.check_redaction(event)
        if event.type == REACTION:
            target = reaction_target(event.content)
            return await self.message_here(target, event.room_id)
        state = await self.api.get_room_state(event.room_id, [(ENCRYPTION, ""), (RETENTION, "")])
        encryption = state.get((ENCRYPTION, ""))
        retention = state.get((RETENTION, ""))
        if encryption is not None:
            encrypted = encryption.content.get("algorithm") == MEGOLM
            if encrypted and event.type == "m.room.encrypted" and is_megolm_content(event.content):
                return await self.check_reply(event)
            return Codes.FORBIDDEN
        if retention is not None and is_plain_policy(retention.content):
            if event.type == "m.room.message" and is_plain_text_content(event.content):
                return NOT_SPAM
        return Codes.FORBIDDEN

    async def check_reply(self, event: EventBase) -> Verdict:
        """A Megolm event without m.relates_to passes; with it, only a reply to a message here."""
        if "m.relates_to" not in event.content:
            return NOT_SPAM
        return await self.message_here(reply_target(event.content), event.room_id)

    async def check_redaction(self, event: EventBase) -> Verdict:
        """Only the sender's own Megolm message or reaction here; content only `redacts`."""
        if not frozenset(event.content) <= {"redacts"} or not isinstance(event.redacts, str):
            return Codes.FORBIDDEN
        found = await self.event_here(event.redacts, event.room_id)
        if found is None or found[1] != event.sender:
            return Codes.FORBIDDEN
        return NOT_SPAM if found[0] in REDACTABLE else Codes.FORBIDDEN

    async def message_here(self, event_id: str | None, room_id: str) -> Verdict:
        found = None if event_id is None else await self.event_here(event_id, room_id)
        return NOT_SPAM if found is not None and found[0] in MESSAGE_TYPES else Codes.FORBIDDEN

    async def event_here(self, event_id: str, room_id: str) -> tuple[str, str] | None:
        rows = await self.api.run_db_interaction(
            "unset_chat_policy_event", select_event, event_id, room_id
        )
        return rows[0] if len(rows) == 1 else None
