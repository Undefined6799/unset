// GET /oauth-client-metadata.json (P2.04c): the client metadata document, served at its own client_id
// (atproto.com/specs/oauth, "Client ID Metadata Document"). Public, built once, cacheable for 5 minutes.
import type { RequestHandler } from "@sveltejs/kit";
import { clientMetadata, SCOPE_METADATA } from "@unset/infrastructure-pds";
import { config } from "../../lib/server/runtime.ts";

let body: string | undefined;

export const GET: RequestHandler = () => {
  body ??= JSON.stringify(clientMetadata(config.PUBLIC_ORIGIN, SCOPE_METADATA));
  return new Response(body, {
    headers: { "content-type": "application/json", "cache-control": "public, max-age=300" },
  });
};
