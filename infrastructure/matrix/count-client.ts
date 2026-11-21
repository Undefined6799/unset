// web's read of the chat count (ADR 0082 decision 5, ADR 0090 decision 2): the number of a member's chats with new
// messages, from the door's count port, for the chat icon on unset.sh. One GET through net-guard's chat-count policy,
// within a short timeout inside the page's own deadline (RE-1), no retry: a slow or absent door only hides the
// number. Nothing but the number crosses: the door answers `{ "unread": n }` or `{ "unread": null }`.
import type { Did } from "@unset/domains-identity";
import { MAX_COUNT } from "@unset/domains-messaging";
import { chatCount, type NetGuard, NetGuardError } from "@unset/infrastructure-net-guard";

/** Short enough that a page is never held up for long by the chat count. */
export const COUNT_TIMEOUT_MS = 300;

export function createChatCountClient(guard: NetGuard, origin: string) {
  const policy = chatCount(origin);
  return {
    /** The member's number, or null when there is none yet or the door did not answer in time. */
    async count(did: Did, deadline: AbortSignal): Promise<number | null> {
      let res: Awaited<ReturnType<NetGuard["request"]>>;
      try {
        res = await guard.request(policy, {
          url: `${origin}/count?did=${encodeURIComponent(did)}`,
          method: "GET",
          timeoutMs: COUNT_TIMEOUT_MS,
          maxBytes: 256,
          signal: deadline,
        });
      } catch (error) {
        if (error instanceof NetGuardError) return null;
        throw error;
      }
      if (res.status !== 200) return null;
      let unread: unknown;
      try {
        unread = (JSON.parse(new TextDecoder().decode(res.body)) as { unread?: unknown }).unread;
      } catch {
        return null;
      }
      return typeof unread === "number" && Number.isSafeInteger(unread) && unread >= 0 && unread <= MAX_COUNT
        ? unread
        : null;
    },
  };
}

export type ChatCountClient = ReturnType<typeof createChatCountClient>;
