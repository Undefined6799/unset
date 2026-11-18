// GET /oauth/jwks.json (P2.04c): the public half of every configured client key, so an authorization server can check
// the client's signed assertions, the old key included while a rotation runs (docs/human/runbooks/oauth-key-rotation.md).
import type { RequestHandler } from "@sveltejs/kit";
import { publicJwks } from "@unset/infrastructure-pds";
import { config } from "../../../lib/server/runtime.ts";

let body: string | undefined;

export const GET: RequestHandler = () => {
  body ??= JSON.stringify(publicJwks(config.OAUTH_CLIENT_KEYS));
  return new Response(body, {
    headers: { "content-type": "application/json", "cache-control": "public, max-age=300" },
  });
};
