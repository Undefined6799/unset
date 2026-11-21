// door.chat_contact (migration 0046; ADR 0094 decision 6, ADR 0101 decision 3): the chat user behind a profile's
// Message link, for chat_auth. One statement by DID; the view leaves out every member whose chat is not ready or whose
// public page does not show, so all of them read as null.
import { type ChatContacts, parseChatUser } from "@unset/domains-messaging";
import { type Pool, withClient } from "./pool.ts";

const FIND = "SELECT chat_user FROM door.chat_contact WHERE did = $1";

export function createChatContactStore(pool: Pool): ChatContacts {
  return {
    async chatUserOf(did, deadline) {
      const { rows } = await withClient(pool, deadline, (db) => db.query<{ chat_user: string }>(FIND, [did]));
      if (rows[0] === undefined) return null;
      const user = parseChatUser(rows[0].chat_user);
      if (user === null) throw new Error("door.chat_contact row");
      return user;
    },
  };
}
