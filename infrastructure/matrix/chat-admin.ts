// web's side of chat-admin (ADR 0081 decisions 3 and 5; build plan step 2): sign one envelope with web's Ed25519 key
// for each call, post it to chat-admin through net-guard's chat-admin policy, and map the answer to the messaging
// domain's outcomes. A fresh `jti` per call, so a retry after `unavailable` is a new request; chat-admin answers a
// second create for an account MAS already holds as created, so a lost reply is harmless. Retries are the queued
// job's (domains/messaging createDueAccounts), never here (rule RE-1: one layer).
import type { Handle } from "@unset/domains-identity";
import type { ChatAccountChange, ChatAccountCreation, ChatUser, SignInTicket } from "@unset/domains-messaging";
import type { NetGuard } from "@unset/infrastructure-net-guard";
import { type ChatAdminSettings, type Fields, postChatAdmin, signChat } from "./chat-admin-call.ts";

export type { ChatAdminSettings } from "./chat-admin-call.ts";

/** Under the job's lease and inside the envelope's own life. */
const TIMEOUT_MS = 8000;

/** chat-admin's account.create answers (interfaces/chat-admin/server.ts); any shape it does not expect is unavailable. */
function creationOf(status: number, body: Record<string, unknown> | null): ChatAccountCreation {
  if (status === 200 && typeof body?.created === "boolean") return { kind: "created" };
  if (status === 409 && body?.error === "username_taken") return { kind: "taken" };
  if (status === 400) return { kind: "rejected" };
  return { kind: "unavailable" };
}

type AccountVerb = "account.lock" | "account.unlock" | "account.deactivate";

/** chat-admin's account answers (interfaces/chat-admin/commands.ts changeAccount); any other shape is unavailable. */
function changeOf(verb: AccountVerb, status: number, body: Record<string, unknown> | null): ChatAccountChange {
  if (status === 409 && body?.error === "no_account") return { kind: "no_account" };
  if (status === 400) return { kind: "rejected" };
  if (status !== 200) return { kind: "unavailable" };
  if (verb === "account.deactivate" && typeof body?.deactivated === "boolean") {
    return body.deactivated ? { kind: "done" } : { kind: "no_account" };
  }
  return verb !== "account.deactivate" && body?.locked === (verb === "account.lock")
    ? { kind: "done" }
    : { kind: "unavailable" };
}

export function createChatAdminClient(guard: NetGuard, settings: ChatAdminSettings, now = () => Date.now()) {
  const sign = (fields: Fields) => signChat(settings, fields, now);

  /** Creates `user` with the verified handle as its display name; ends at `deadline` or after 8 s (RE-1). */
  async function createAccount(user: ChatUser, name: Handle, deadline?: AbortSignal): Promise<ChatAccountCreation> {
    const envelope = sign({ verb: "account.create", user, name, device: "", did: "", sid: "", state: "" });
    const answer = await postChatAdmin(guard, settings, "/v1/account.create", envelope, TIMEOUT_MS, deadline);
    return answer === "unavailable" ? { kind: "unavailable" } : creationOf(answer.status, answer.body);
  }

  /**
   * web's sign-in ticket (ADR 0081 decision 3): a session.mint envelope for chat-admin, single use (its jti) and 60
   * seconds long, naming the member, the web session and the door's one-time value. Encoded as base64url of its JSON,
   * so it travels in a URL fragment; the door decodes it and posts the envelope to chat-admin as `ticket`.
   */
  function signTicket(ticket: SignInTicket): string {
    const envelope = sign({ verb: "session.mint", name: "", device: "", ...ticket });
    return Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url");
  }

  /** Locks, unlocks or deactivates `user` (ADR 0084); retries are the queued job's, never here (RE-1). */
  async function changeAccount(user: ChatUser, verb: AccountVerb, deadline?: AbortSignal): Promise<ChatAccountChange> {
    const envelope = sign({ verb, user, name: "", device: "", did: "", sid: "", state: "" });
    const answer = await postChatAdmin(guard, settings, `/v1/${verb}`, envelope, TIMEOUT_MS, deadline);
    return answer === "unavailable" ? { kind: "unavailable" } : changeOf(verb, answer.status, answer.body);
  }

  /** An erased member's chat account: deactivate, which asks the homeserver to erase it (ADR 0084 decision 3). */
  const deactivateAccount = (user: ChatUser, deadline?: AbortSignal) =>
    changeAccount(user, "account.deactivate", deadline);

  /** A member suspended or active again: lock or unlock the chat account (ADR 0084 decisions 1 and 2). */
  const setLocked = (user: ChatUser, lock: boolean, deadline?: AbortSignal) =>
    changeAccount(user, lock ? "account.lock" : "account.unlock", deadline);

  return { createAccount, changeAccount, deactivateAccount, setLocked, signTicket };
}

export type ChatAdminClient = ReturnType<typeof createChatAdminClient>;
