// GET /oauth-client-metadata.json and GET /oauth/jwks.json (P2.04c; book P2.04 "Routes"). The first is the client
// metadata document, served at its own client_id (atproto.com/specs/oauth, "Client ID Metadata Document"); the second
// is the public half of every configured client key, so an authorization server can check the client's signed
// assertions, the old key included while a rotation runs (docs/human/runbooks/oauth-key-rotation.md). Both bodies are
// built once at boot, public and cacheable for 5 minutes.
import { type ClientKeys, clientMetadata, publicJwks, SCOPE_METADATA } from "@unset/infrastructure-pds";
import { defineRoute, type Route } from "@unset/shared-http";

const HEADERS = { "content-type": "application/json", "cache-control": "public, max-age=300" };

/** A GET route that answers one fixed JSON body. */
const document = (path: string, body: unknown): Route => {
  const text = JSON.stringify(body);
  return defineRoute({
    method: "GET",
    path,
    group: "app",
    rateLimit: "default",
    session: "none",
    handler: () => new Response(text, { status: 200, headers: HEADERS }),
  });
};

export const oauthMetadataRoutes = (origin: string, keys: ClientKeys): Route[] => [
  document("/oauth-client-metadata.json", clientMetadata(origin, SCOPE_METADATA)),
  document("/oauth/jwks.json", publicJwks(keys)),
];
