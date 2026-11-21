// door.chat_name (migration 0052; ADR 0107): a chat partner's public profile name, for chat_auth. One statement by
// chat user; the view leaves out every member whose chat is not ready or whose public page does not show, so all of
// them read as null.
import type { ChatNames } from "@unset/domains-messaging";
import { type Pool, withClient } from "./pool.ts";

const FIND = "SELECT display_name FROM door.chat_name WHERE chat_user = $1";

export function createChatNameStore(pool: Pool): ChatNames {
  return {
    async nameOf(user, deadline) {
      const { rows } = await withClient(pool, deadline, (db) =>
        db.query<{ display_name: string | null }>(FIND, [user]),
      );
      return rows[0]?.display_name ?? null;
    },
  };
}
