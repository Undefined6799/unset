"""The server rule (P6.10a): only Megolm ciphertext reaches a room on this homeserver.

Synapse has no setting that refuses an unencrypted event, and
`encryption_enabled_by_default_for_room_type: all` only turns encryption on for
honest clients. This module refuses the rest on the server, failing closed: it
allows what the minimal chat client sends and nothing else, so a new event type
(a sticker, a poll, a call, an extension) is refused until a step allows it.

Callbacks (element-hq/synapse v1.162.0, docs/modules/spam_checker_callbacks.md):

- `check_event_for_spam` runs for every non-member event a local client sends:
  /send, /state for any type but m.room.member, /redact, delayed events
  (synapse/handlers/message.py:1195, `_create_and_send_nonmember_event_locked`).
  It allows only an `m.room.encrypted` timeline event whose content is exactly
  Megolm's (spec v1.18, m.room.encrypted: algorithm, ciphertext, session_id and
  the deprecated sender_key and device_id). Refused with it:
  - every other timeline type: m.room.message, m.sticker, m.reaction (its
    `m.relates_to.key` is cleartext), m.poll.* and m.call.* are plaintext;
  - an encrypted event with any other key, `m.relates_to` included: relations
    stay cleartext by design (spec v1.18, "Forming relationships between
    events"), and the minimal client sends no reply, edit or reaction;
  - every state event after creation: name, topic and avatar are plaintext; a
    new m.room.encryption could change the algorithm; the client sends none;
  - every redaction: redacting m.room.encryption strips its content (spec v1.18,
    room v11 redaction algorithm keeps no m.room.encryption key), which reads as
    "encryption off" to clients, and `reason` is plaintext; the client deletes
    nothing in this version.
- `user_may_create_room` gets the /createRoom body (room.py:1233). The room is
  made in one batch that bypasses the check above, and a client-supplied
  m.room.encryption with any string algorithm replaces the forced default
  (room.py:1784-1806). So only the keys the client sends are allowed (preset,
  is_direct, invite); name, topic, initial_state, creation_content, aliases,
  3pid invites and directory visibility are refused. A room upgrade passes a
  synthesised initial_state, so upgrades are refused too.

Not covered, by Synapse's design: membership events (invite `reason`, extra
content keys) go through room_member.py, which calls no spam callback; and
user_may_create_room is skipped for server admins (room.py:1232). No chat
account is a server admin.
An exception in a callback propagates and Synapse rejects the request, so a
bug fails closed (spamchecker_callbacks.py:369, no catch around the callback).
"""

from collections.abc import Mapping
from typing import Any, Literal

from synapse.module_api import NOT_SPAM, EventBase, JsonDict, ModuleApi
from synapse.module_api.errors import Codes

MEGOLM = "m.megolm.v1.aes-sha2"
MEGOLM_REQUIRED = frozenset({"algorithm", "ciphertext", "session_id"})
MEGOLM_OPTIONAL = frozenset({"sender_key", "device_id"})
CREATE_ROOM_KEYS = frozenset({"preset", "is_direct", "invite"})

Verdict = Literal["NOT_SPAM"] | Codes


def is_megolm_content(content: Mapping[str, Any]) -> bool:
    """Exactly the Megolm keys, each a non-empty string, and the Megolm algorithm."""
    keys = frozenset(content)
    if not MEGOLM_REQUIRED <= keys <= MEGOLM_REQUIRED | MEGOLM_OPTIONAL:
        return False
    if not all(isinstance(value, str) and value != "" for value in content.values()):
        return False
    return bool(content["algorithm"] == MEGOLM)


class EncryptedOnly:
    """Loaded from homeserver.yaml `modules:` as unset_chat_policy.EncryptedOnly."""

    def __init__(self, config: dict[str, Any], api: ModuleApi) -> None:
        if config:
            raise ValueError("unset_chat_policy.EncryptedOnly takes no config")
        api.register_spam_checker_callbacks(
            check_event_for_spam=self.check_event_for_spam,
            user_may_create_room=self.user_may_create_room,
        )

    async def check_event_for_spam(self, event: EventBase) -> Verdict:
        if event.is_state():
            return Codes.FORBIDDEN
        if event.type != "m.room.encrypted":
            return Codes.FORBIDDEN
        if not is_megolm_content(event.content):
            return Codes.FORBIDDEN
        return NOT_SPAM

    async def user_may_create_room(self, user_id: str, room_config: JsonDict) -> Verdict:
        if not frozenset(room_config) <= CREATE_ROOM_KEYS:
            return Codes.FORBIDDEN
        return NOT_SPAM
