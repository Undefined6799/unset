// The atproto network behind small contracts (guideline §1): the identity domain's DID and handle lookups, and the one
// OAuth client (P2.04) with its keys, metadata and scope check, and the start and end of a sign-in (P2.05, P2.06).

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
  type PdsFailure,
  type PdsResult,
  respondToPdsFailure,
  type SessionInfo,
} from "./pds-call.ts";
export { isDpopNonceHandshake } from "./pds-errors.ts";
export {
  type BuiltRecord,
  loadProfileRecord,
  PROFILE_COLLECTION,
  PROFILE_RKEY,
  type SaveOutcome,
  type StoredRecord,
  saveProfileRecord,
} from "./profile-record.ts";
