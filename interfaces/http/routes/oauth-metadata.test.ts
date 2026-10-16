// P2.04c (interfaces/http/routes/oauth-metadata.ts): the client metadata document and the JWKS an authorization server
// fetches. The book's P2.04 tests metadata.route and jwks.route, against the handlers the server table runs.
import { generateKeyPairSync } from "node:crypto";
import { parseClientKeys, SCOPE_METADATA } from "@unset/infrastructure-pds";
import { describe, expect, test } from "vitest";
import { oauthMetadataRoutes } from "./oauth-metadata.ts";

const ORIGIN = "https://unset.test";
const privateJwk = (kid: string) => ({
  ...generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "jwk" }),
  kid,
  alg: "ES256",
});
const keys = parseClientKeys(JSON.stringify([privateJwk("A"), privateJwk("B")]));
if (keys === undefined) throw new Error("test client keys did not parse");

/** The response of the route at `path`, as the server's table would run it. */
async function get(path: string): Promise<Response> {
  const route = oauthMetadataRoutes(ORIGIN, keys as NonNullable<typeof keys>).find((r) => r.path === path);
  if (route === undefined) throw new Error(`no route ${path}`);
  return route.handler({ request: new Request(`${ORIGIN}${path}`), params: {} } as Parameters<typeof route.handler>[0]);
}

describe("oauth metadata routes", () => {
  test("metadata_route", async () => {
    const response = await get("/oauth-client-metadata.json");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    const body = (await response.json()) as Record<string, unknown>;
    // The client_id is the URL the document is served at (atproto.com/specs/oauth, "Client ID Metadata Document").
    expect(body.client_id).toBe(`${ORIGIN}/oauth-client-metadata.json`);
    expect(body).toMatchObject({
      client_name: "unset.sh",
      redirect_uris: [`${ORIGIN}/oauth/callback`],
      jwks_uri: `${ORIGIN}/oauth/jwks.json`,
      scope: SCOPE_METADATA,
      token_endpoint_auth_method: "private_key_jwt",
      token_endpoint_auth_signing_alg: "ES256",
      dpop_bound_access_tokens: true,
    });
  });

  test("jwks_route", async () => {
    const response = await get("/oauth/jwks.json");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    const text = await response.text();
    const body = JSON.parse(text) as { keys: { kid: string }[] };
    // Two configured keys, two public JWKs: the old one stays published while a rotation runs.
    expect(body.keys.map((key) => key.kid)).toEqual(["A", "B"]);
    // No private member anywhere in the body.
    expect(text).not.toMatch(/"d"\s*:/);
  });
});
