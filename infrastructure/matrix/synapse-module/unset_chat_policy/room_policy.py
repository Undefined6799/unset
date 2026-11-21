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
  retention), every redaction (redacting m.room.encryption strips its content,
  spec v1.18 room v11 redaction rules), and in each kind every event but its one
  allowed shape: exactly Megolm's keys (spec v1.18 m.room.encrypted; m.relates_to
  is cleartext), or exactly {msgtype: m.text, body}. A room of neither kind
  accepts nothing.

Not covered, by Synapse's design: membership events (invite `reason`, extra
content keys) go through room_member.py, which calls no spam callback; a server
admin skips `user_may_create_room`, so may upgrade a room (room.py:1236).
Synapse never purges a room's newest event (storage/databases/main/
purge_events.py:188), so a plain room keeps its newest expired message until a
later one expires; the docs say it is hidden from clients after 30 days.
An exception in a callback rejects the request, so a bug fails closed.
"""

from collections.abc import Mapping
from typing import Any, Literal

from synapse.module_api import NOT_SPAM, EventBase, JsonDict, ModuleApi, Requester
from synapse.module_api.errors import Codes, SynapseError

MEGOLM = "m.megolm.v1.aes-sha2"
MEGOLM_REQUIRED = frozenset({"algorithm", "ciphertext", "session_id"})
MEGOLM_OPTIONAL = frozenset({"sender_key", "device_id"})
CREATE_ROOM_KEYS = frozenset({"preset", "is_direct", "invite", "initial_state"})
PLAIN_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000
RETENTION = "m.room.retention"
ENCRYPTION = "m.room.encryption"

Verdict = Literal["NOT_SPAM"] | Codes


def is_megolm_content(content: Mapping[str, Any]) -> bool:
    """Exactly the Megolm keys, each a non-empty string, and the Megolm algorithm."""
    keys = frozenset(content)
    if not MEGOLM_REQUIRED <= keys <= MEGOLM_REQUIRED | MEGOLM_OPTIONAL:
        return False
    if not all(isinstance(value, str) and value != "" for value in content.values()):
        return False
    return bool(content["algorithm"] == MEGOLM)


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
        )

    async def on_create_room(
        self, requester: Requester, request_content: dict[str, Any], is_requester_admin: bool
    ) -> None:
        if not frozenset(request_content) <= CREATE_ROOM_KEYS:
            raise refuse("only preset, is_direct, invite and initial_state are allowed")
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

    async def check_event_for_spam(self, event: EventBase) -> Verdict:
        if event.is_state() or event.type == "m.room.redaction":
            return Codes.FORBIDDEN
        state = await self.api.get_room_state(event.room_id, [(ENCRYPTION, ""), (RETENTION, "")])
        encryption = state.get((ENCRYPTION, ""))
        retention = state.get((RETENTION, ""))
        if encryption is not None:
            encrypted = encryption.content.get("algorithm") == MEGOLM
            if encrypted and event.type == "m.room.encrypted" and is_megolm_content(event.content):
                return NOT_SPAM
            return Codes.FORBIDDEN
        if retention is not None and is_plain_policy(retention.content):
            if event.type == "m.room.message" and is_plain_text_content(event.content):
                return NOT_SPAM
        return Codes.FORBIDDEN
