// web's read of the chat count (ADR 0082 decision 5, ADR 0090 decision 2): the number of a member's chats with new
// messages, from the door's count port, for the chat icon on unset.sh. One GET through net-guard's chat-count policy,
// within a short timeout inside the page's own deadline (RE-1), no retry: a slow or absent door only hides the
// number. Nothing but the number crosses: the door answers `{ "unread": n }` or `{ "unread": null }`. The onboarding
// chat step reads `{ "setUp": true | false }` the same way.
import type { Did } from "@unset/domains-identity";
import { MAX_COUNT } from "@unset/domains-messaging";
import { chatCount, type NetGuard, NetGuardError } from "@unset/infrastructure-net-guard";

/** Short enough that a page is never held up for long by the chat count. */
export const COUNT_TIMEOUT_MS = 300;

/**
 * The onboarding chat step's read gates signup, so it may wait longer than the icon's; still well inside the page's
 * deadline (REQUEST_DEADLINE_MS), with no retry: the member presses Continue again.
 */
export const SET_UP_TIMEOUT_MS = 2000;

export function createChatCountClient(guard: NetGuard, origin: string) {
  const policy = chatCount(origin);
  /** The door's JSON answer to `path`, or null for a refusal, no answer in time, or a body that is not JSON. */
  async function read(path: string, timeoutMs: number, deadline: AbortSignal): Promise<unknown> {
    let res: Awaited<ReturnType<NetGuard["request"]>>;
    try {
      res = await guard.request(policy, {
        url: `${origin}${path}`,
        method: "GET",
        timeoutMs,
        maxBytes: 256,
        signal: deadline,
      });
    } catch (error) {
      if (error instanceof NetGuardError) return null;
      throw error;
    }
    if (res.status !== 200) return null;
    try {
      return JSON.parse(new TextDecoder().decode(res.body)) as unknown;
    } catch {
      return null;
    }
  }
  const field = (body: unknown, name: string): unknown =>
    typeof body === "object" && body !== null ? (body as Record<string, unknown>)[name] : undefined;
  return {
    /** The member's number, or null when there is none yet or the door did not answer in time. */
    async count(did: Did, deadline: AbortSignal): Promise<number | null> {
      const unread = field(await read(`/count?did=${encodeURIComponent(did)}`, COUNT_TIMEOUT_MS, deadline), "unread");
      return typeof unread === "number" && Number.isSafeInteger(unread) && unread >= 0 && unread <= MAX_COUNT
        ? unread
        : null;
    },
    /**
     * Whether the member has set up chat (ADR 0083 decision 2: a browser of theirs saved the recovery key and took the
     * count's pushkey), or null when the door gave no clear answer, which the step treats as not set up (fail closed).
     */
    async setUp(did: Did, deadline: AbortSignal): Promise<boolean | null> {
      const answer = field(await read(`/set-up?did=${encodeURIComponent(did)}`, SET_UP_TIMEOUT_MS, deadline), "setUp");
      return typeof answer === "boolean" ? answer : null;
    },
  };
}

export type ChatCountClient = ReturnType<typeof createChatCountClient>;
