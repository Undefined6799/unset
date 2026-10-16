// The atproto network behind small contracts (guideline §1): the identity domain's DID and handle lookups, and the one
// OAuth client (P2.04) with its keys, metadata and scope check.
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
