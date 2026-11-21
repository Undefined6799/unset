// Messaging (Phase 6; ADR 0010, ADR 0081): the chat rules web owns. A member's opaque chat user, its queued creation,
// its lock while suspended and, once erased, its queued deactivation (ADR 0084), the devices ended when web ends a
// session (ADR 0083 decision 5, ADR 0084 decision 7), the sign-in ticket's parts that web
// decides, and the door's browser list (ADR 0083), its setup claim (ADR 0089), the chat count and the Message link's
// lookup (ADR 0090).

export {
  type BrowserEntry,
  type BrowserKey,
  type BrowserList,
  DEVICE_ID,
  type DeviceId,
  LOCK_KEY_BYTES,
  type LockKey,
  parseDeviceId,
} from "./browser.ts";
export {
  CHAT_USER,
  type ChatAccountCreation,
  type ChatAccountJob,
  type ChatAccountPorts,
  type ChatUser,
  CREATE_CALL_WITHIN_MS,
  type CreationCounts,
  createDueAccounts,
  type JobSettlement,
  MAX_ATTEMPTS,
  newChatUser,
  parseChatUser,
  retryDelayS,
} from "./chat-account.ts";
export {
  type ChatAccountChange,
  type ChatErasureJob,
  type ChatErasurePorts,
  type ChatLockJob,
  type ChatLockPorts,
  type ChatSessionEndJob,
  type ChatSessionEndPorts,
  CREATE_LANDS_WITHIN_S,
  END_STUCK_ATTEMPTS,
  type EndCounts,
  ERASE_STUCK_ATTEMPTS,
  type ErasureCounts,
  endDueSessions,
  eraseDueAccounts,
  followAccountStates,
  type LockCounts,
} from "./chat-lifecycle.ts";
export { type ChatContacts, type ContactOutcome, chatContact } from "./contact.ts";
export {
  type AccessToken,
  type DoorPorts,
  type EndOutcome,
  type MintOutcome,
  type RedeemOutcome,
  type RedeemRefusal,
  readTicket,
  redeem,
  type SignOutOutcome,
  signOut,
  type Ticket,
} from "./door.ts";
export {
  chatCount,
  chatSetUp,
  type IssueOutcome,
  issuePushKey,
  MAX_COUNT,
  type PushKey,
  type PushKeyHash,
  type PushKeys,
  parsePushKey,
  pushKeyHash,
  recordCount,
} from "./push.ts";
export {
  type ClaimOutcome,
  claimSetup,
  type ReleaseOutcome,
  releaseSetup,
  SETUP_CLAIM_S,
  type SetupClaims,
} from "./setup.ts";
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
