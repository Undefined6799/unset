// Messaging (Phase 6; ADR 0010, ADR 0081): the chat rules web owns. A member's opaque chat user and its queued
// creation, and the sign-in ticket's parts that web decides.
export {
  CHAT_USER,
  type ChatAccountCreation,
  type ChatAccountJob,
  type ChatAccountPorts,
  type ChatUser,
  type CreationCounts,
  createDueAccounts,
  type JobSettlement,
  MAX_ATTEMPTS,
  newChatUser,
  parseChatUser,
  retryDelayS,
} from "./chat-account.ts";
export {
  type DoorState,
  parseDoorState,
  type SessionRef,
  type SignInOutcome,
  type SignInPorts,
  type SignInTicket,
  sessionRef,
  signIn,
} from "./sign-in.ts";
