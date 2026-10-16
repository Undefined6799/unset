// The one atproto OAuth client (P2.04; plan §2 rules 3, 6, §3, §5.3 "OAuth client"): confidential, `private_key_jwt`
// with ES256, DPoP-bound tokens, @atproto/oauth-client-node 0.5.9. Its state and token sets live in the sealed stores
// (infrastructure/postgres/oauthStores.ts), a refresh is serialised across replicas by the advisory lock, every
// request goes through net-guard, and identities resolve through the identity domain (identity-resolvers.ts).
import { createPrivateKey } from "node:crypto";
import { inspect } from "node:util";
// Imported from its own exactly pinned package: the client library re-exports it under a caret range.
import { JoseKey } from "@atproto/jwk-jose";
import {
  NodeOAuthClient,
  type NodeSavedSession,
  type NodeSavedSessionStore,
  type NodeSavedState,
  type NodeSavedStateStore,
  type RuntimeLock,
  TokenInvalidError,
  TokenRefreshError,
  TokenRevokedError,
} from "@atproto/oauth-client-node";
import type { Consistency, Did, IdentityNetwork, ResolvedDid } from "@unset/domains-identity";
import { bool, type Field, str, withRule } from "@unset/shared-config";
import type { Logger } from "@unset/shared-log";
import { didResolverForOAuth, handleResolverForOAuth } from "./identity-resolvers.ts";
import { SCOPE_METADATA } from "./scopes.ts";

export type SavedState = NodeSavedState;
export type SavedSession = NodeSavedSession;

type PrivateJwk = { kty: "EC"; crv: "P-256"; alg: "ES256"; kid: string; x: string; y: string; d: string };
const HIDDEN = "[oauth keys]";
const KID = /^[A-Za-z0-9._-]{1,64}$/;
const MAX_KEYS = 4;

/**
 * The client's private signing keys, by kid. The keys sit in a private field, so printing, JSON or the config loader's
 * freeze never reach them; only the kids are public.
 */
export class ClientKeys {
  readonly kids: readonly string[];
  readonly #jwks: readonly PrivateJwk[];

  constructor(jwks: readonly PrivateJwk[]) {
    this.#jwks = jwks;
    this.kids = jwks.map((jwk) => jwk.kid);
    Object.freeze(this);
  }

  /** The private JWKs, `first` listed first; only the client's construction reads them. */
  privateJwks(first: string): readonly PrivateJwk[] {
    return [...this.#jwks].sort((a, b) => Number(b.kid === first) - Number(a.kid === first));
  }

  /** The public part of every key, for the JWKS route. */
  publicParts() {
    return this.#jwks.map(({ kty, crv, alg, kid, x, y }) => ({ kty, crv, alg, kid, x, y, use: "sig" as const }));
  }

  toString(): string {
    return HIDDEN;
  }

  toJSON(): string {
    return HIDDEN;
  }

  [inspect.custom](): string {
    return HIDDEN;
  }
}

const isPrivateJwk = (value: unknown): value is PrivateJwk => {
  const jwk = value as Record<string, unknown> | null;
  return (
    typeof jwk === "object" &&
    jwk !== null &&
    jwk.kty === "EC" &&
    jwk.crv === "P-256" &&
    jwk.alg === "ES256" &&
    typeof jwk.kid === "string" &&
    KID.test(jwk.kid) &&
    [jwk.x, jwk.y, jwk.d].every((part) => typeof part === "string" && part !== "")
  );
};

/**
 * Whether the key material is a real P-256 private key: coordinates on the curve and matching `d`. The library accepts
 * bad material at import and fails only when it signs (@atproto/jwk-jose 0.2.4 JoseKey.fromImportable), which would
 * let the server boot and refuse every sign-in; Node's JWK import checks the key (crypto.createPrivateKey).
 */
function importable(jwk: PrivateJwk): boolean {
  try {
    createPrivateKey({ key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d }, format: "jwk" });
    return true;
  } catch {
    return false;
  }
}

/** A JSON array of one to four importable private ES256 P-256 JWKs with distinct kids; anything else is undefined. */
export function parseClientKeys(raw: string): ClientKeys | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_KEYS || !value.every(isPrivateJwk))
    return undefined;
  if (!value.every(importable)) return undefined;
  const jwks = value.map(({ kty, crv, alg, kid, x, y, d }) => ({ kty, crv, alg, kid, x, y, d }));
  return new Set(jwks.map((jwk) => jwk.kid)).size === jwks.length ? new ClientKeys(jwks) : undefined;
}

const clientKeysFile = (): Field<ClientKeys> => ({ kind: "secretFile", parse: parseClientKeys });

/** What the web server merges into its config schema. A key change is a rotation: docs/human/runbooks/oauth-key-rotation.md. */
export const oauthFields = {
  OAUTH_CLIENT_KEYS: clientKeysFile(),
  /** The kid new logins sign with; existing token sets keep the kid they were bound to. */
  OAUTH_ACTIVE_KID: withRule(
    str({ pattern: KID }),
    (config) =>
      (config.OAUTH_CLIENT_KEYS as ClientKeys | undefined)?.kids.includes(String(config.OAUTH_ACTIVE_KID)) === true,
  ),
  /** Plain HTTP to authorization servers, for a local stack only; refused anywhere but dev. */
  OAUTH_ALLOW_HTTP: withRule(
    bool({ default: false }),
    (config) => config.OAUTH_ALLOW_HTTP !== true || config.UNSET_ENV === "dev",
  ),
};

/** The client metadata document, served at its own `client_id` (atproto.com/specs/oauth, "Client ID Metadata Document"). */
export function clientMetadata(origin: string, scope: string) {
  return {
    client_id: `${origin}/oauth-client-metadata.json`,
    client_name: "unset.sh",
    client_uri: origin,
    tos_uri: `${origin}/legal/terms`,
    policy_uri: `${origin}/legal/privacy`,
    redirect_uris: [`${origin}/oauth/callback`] as [string],
    scope,
    grant_types: ["authorization_code", "refresh_token"] as ["authorization_code", "refresh_token"],
    response_types: ["code"] as ["code"],
    application_type: "web" as const,
    token_endpoint_auth_method: "private_key_jwt" as const,
    token_endpoint_auth_signing_alg: "ES256",
    dpop_bound_access_tokens: true as const,
    jwks_uri: `${origin}/oauth/jwks.json`,
  };
}

/** The JWKS route's body: the public part of every configured key, the old ones included while sessions use them. */
export const publicJwks = (keys: ClientKeys) => ({ keys: keys.publicParts() });

/** Why the library dropped a token set, as one fixed word for the log line. */
function deletedBecause(cause: unknown): "revoked" | "refresh_failed" | "invalid" | "other" {
  if (cause instanceof TokenRevokedError) return "revoked";
  if (cause instanceof TokenRefreshError) return "refresh_failed";
  if (cause instanceof TokenInvalidError) return "invalid";
  return "other";
}

export type OAuthClientOptions = {
  readonly origin: string;
  readonly keys: ClientKeys;
  readonly activeKid: string;
  readonly stateStore: NodeSavedStateStore;
  readonly sessionStore: NodeSavedSessionStore;
  /** The advisory lock (infrastructure/postgres createRequestLock), so two replicas never spend one refresh token. */
  readonly requestLock: RuntimeLock;
  /** net-guard's libraryFetch: the `atproto` policy, our own PDS reached as an internal host. */
  readonly fetch: typeof fetch;
  readonly network: IdentityNetwork;
  readonly resolveDid: (did: Did, consistency: Consistency) => Promise<ResolvedDid>;
  readonly allowHttp: boolean;
  readonly log: Logger;
};

/**
 * Builds the client; a failure fails boot. The library fires `onSessionDeleted` on every callback (it revokes the
 * previous set first, even when there was none) and on sign-out, so the hook writes nothing and ends no app session:
 * that would sign a member out of every other browser at each login (P2.04 step 7). It logs the reason word only.
 */
export async function createOAuthClient(options: OAuthClientOptions) {
  const keyset = await Promise.all(
    options.keys.privateJwks(options.activeKid).map((jwk) => JoseKey.fromImportable(jwk, jwk.kid)),
  );
  const onSessionDeleted = (_sub: string, cause: unknown): void => {
    options.log.info("oauth.session_deleted", { reason: deletedBecause(cause) });
  };
  const client = new NodeOAuthClient({
    clientMetadata: clientMetadata(options.origin, SCOPE_METADATA),
    keyset,
    stateStore: options.stateStore,
    sessionStore: options.sessionStore,
    requestLock: options.requestLock,
    fetch: options.fetch,
    handleResolver: handleResolverForOAuth(options.network),
    didResolver: didResolverForOAuth(options.resolveDid),
    allowHttp: options.allowHttp,
    onSessionDeleted,
  });
  return { client, onSessionDeleted };
}
