// The atproto network behind small contracts (guideline §1): the identity domain's DID and handle lookups, and the one
// OAuth client (P2.04) with its keys, metadata and scope check, and the start and end of a sign-in (P2.05, P2.06).

export { createInviteIssuer, type InviteIssuerSettings, type IssueInviteResult } from "./admin-invite.ts";
export { type UploadedBlob, uploadImageBlob } from "./blob-upload.ts";
export {
  APPLY_WRITES_BODY_BYTES,
  CARD_COLLECTION,
  CARD_LIST_BYTES,
  type CardChange,
  type CardList,
  type ListedOutcome,
  latestCommit,
  listCardRecords,
  newCardKey,
  type ProfileChange,
  type SaveManyOutcome,
  type StoredCard,
  saveCardRecord,
  saveCardRecords,
  writeCardAndList,
} from "./card-records.ts";
export { createIdentityNetwork, type IdentityNetworkOptions } from "./identity-network.ts";
export {
  ClientKeys,
  clientMetadata,
  createOAuthClient,
  type OAuthClientOptions,
  oauthFields,
  parseClientKeys,
  publicJwks,
  type SavedSession,
  type SavedState,
} from "./oauth/oauth-client.ts";
export { grantCovers, SCOPE_METADATA } from "./oauth/scopes.ts";
export {
  type AuthorizeFailure,
  type AuthorizeOptions,
  type AuthorizeResult,
  authorize,
  type CallbackFailure,
  type CallbackResult,
  type CompletedSignIn,
  completeAuthorization,
} from "./oauth/sign-in.ts";
export {
  createPdsCall,
  PDS_CALL_TIMEOUT_MS,
  type PdsCallDeps,
  type PdsContext,
  type PdsResult,
  type SessionInfo,
} from "./pds-call.ts";
export { isDpopNonceHandshake } from "./pds-errors.ts";
export { loadProfileRecord, PROFILE_COLLECTION, PROFILE_RKEY, saveProfileRecord } from "./profile-record.ts";
export type { BuiltRecord, SaveOutcome, StoredRecord } from "./repo-record.ts";
