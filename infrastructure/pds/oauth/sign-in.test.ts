// P2.05a, P2.06 (sign-in.ts): a sign-in started and completed against a stand-in authorization server, through the real library client
// (@atproto/oauth-client 0.8.9) over our identity resolvers. Only the network and the server are doubles (TE-1), so
// each outcome is pinned to the error the library really throws, not to a shape written here. The successful runs
// start from the issuer (the PDS chooser), so no DID document here claims a handle: reading that claim belongs to
// the identity files (scripts/guards/also-known-as.ts); identity-resolvers.test.ts covers the claimed-handle path.
import { generateKeyPairSync } from "node:crypto";
import { createDidResolver, type HttpOutcome, type IdentityNetwork, type TxtOutcome } from "@unset/domains-identity";
import { NetGuardError } from "@unset/infrastructure-net-guard";
import { scopeString, scopeStringFallback } from "@unset/shared-lexicons";
import type { LogEvent, LogFields, Logger } from "@unset/shared-log";
import { describe, expect, test } from "vitest";
import {
  type ClientKeys,
  createOAuthClient,
  parseClientKeys,
  type SavedSession,
  type SavedState,
} from "./oauth-client.ts";
import { authorize, completeAuthorization } from "./sign-in.ts";

const ORIGIN = "https://unset.example";
const HANDLE = "alice.pds-test.dev";
const DID = `did:plc:${"a".repeat(24)}`;
const PDS = "https://pds-test.dev";
const REQUEST_URI = "urn:ietf:params:oauth:request_uri:req-0123456789abcdef";
const APP_STATE = JSON.stringify({ v: 1, nonce: "our-app-state" });

const asMetadata = {
  issuer: PDS,
  authorization_endpoint: `${PDS}/oauth/authorize`,
  token_endpoint: `${PDS}/oauth/token`,
  revocation_endpoint: `${PDS}/oauth/revoke`,
  pushed_authorization_request_endpoint: `${PDS}/oauth/par`,
  require_pushed_authorization_requests: true,
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code", "refresh_token"],
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
  token_endpoint_auth_signing_alg_values_supported: ["ES256"],
  dpop_signing_alg_values_supported: ["ES256"],
  client_id_metadata_document_supported: true,
  authorization_response_iss_parameter_supported: true,
  scopes_supported: ["atproto"],
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const encoded = (body: unknown): HttpOutcome => ({
  kind: "response",
  status: 200,
  body: new TextEncoder().encode(JSON.stringify(body)),
});

type World = {
  txt?: TxtOutcome;
  /** Answers to successive PAR requests; the last repeats. */
  par?: (() => Response)[];
  /** Replaces the whole server, for failures before PAR. */
  server?: (url: URL) => Response | Promise<Response>;
  /** The token endpoint's answer; by default a DPoP token set for DID with the full scope. */
  token?: () => Response;
};

const TOKENS = { access_token: "at", refresh_token: "rt", token_type: "DPoP", sub: DID, expires_in: 3600 };

/** The real client over a stand-in PLC, handle DNS and authorization server; records PAR bodies and log lines. */
async function setup(world: World = {}) {
  const network: IdentityNetwork = {
    txt: async () => world.txt ?? { kind: "records", records: [`did=${DID}`] },
    get: async (url) => {
      if (url.href !== `https://plc.directory/${DID}`) return { kind: "response", status: 404, body: new Uint8Array() };
      return encoded({
        "@context": ["https://www.w3.org/ns/did/v1"],
        id: DID,
        verificationMethod: [{ id: `${DID}#atproto`, type: "Multikey", controller: DID, publicKeyMultibase: "zQ3sh" }],
        service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: PDS }],
      });
    },
  };
  const pars: URLSearchParams[] = [];
  const posts: string[] = [];
  const par = world.par ?? [() => json({ request_uri: REQUEST_URI, expires_in: 299 }, 201)];
  const server = async (url: URL, request: Request): Promise<Response> => {
    if (world.server) return world.server(url);
    if (url.pathname === "/.well-known/oauth-protected-resource") {
      return json({ resource: PDS, authorization_servers: [PDS] });
    }
    if (url.pathname === "/.well-known/oauth-authorization-server") return json(asMetadata);
    if (url.pathname === "/oauth/par" && request.method === "POST") {
      pars.push(new URLSearchParams(await request.text()));
      return (par[pars.length - 1] ?? (par.at(-1) as () => Response))();
    }
    if (request.method === "POST") posts.push(url.pathname);
    if (url.pathname === "/oauth/token") return world.token?.() ?? json({ ...TOKENS, scope: scopeString() });
    if (url.pathname === "/oauth/revoke") return new Response(null, { status: 200 });
    return json({ error: "not_found" }, 404);
  };
  const states = new Map<string, SavedState>();
  const sessions = new Map<string, SavedSession>();
  const logged: { event: LogEvent; fields: LogFields }[] = [];
  const record = (event: LogEvent, fields: LogFields = {}) => void logged.push({ event, fields });
  const log: Logger = { info: record, warn: record, error: record, logError: () => undefined };
  const jwk = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "jwk" });
  const { client } = await createOAuthClient({
    origin: ORIGIN,
    keys: parseClientKeys(JSON.stringify([{ ...jwk, kid: "k1", alg: "ES256" }])) as ClientKeys,
    activeKid: "k1",
    stateStore: {
      get: async (key) => states.get(key),
      set: async (key, value) => void states.set(key, value),
      del: async (key) => void states.delete(key),
    },
    sessionStore: {
      get: async (key) => sessions.get(key),
      set: async (key, value) => void sessions.set(key, value),
      del: async (key) => void sessions.delete(key),
    },
    requestLock: async (_name, fn) => fn(),
    fetch: async (input, init) => {
      const request = new Request(input, init);
      return server(new URL(request.url), request);
    },
    network,
    resolveDid: createDidResolver({ network, plcUrl: new URL("https://plc.directory"), cacheTtlS: 60, cacheMax: 10 }),
    allowHttp: false,
    log,
  });
  const run = (input: string, prompt?: "login") =>
    authorize(client, input, { appState: APP_STATE, ...(prompt ? { prompt } : {}), deadline: null, log });
  /** Starts a flow at the issuer and returns the query the server would send the browser back with. */
  const started = async (extra: Record<string, string> = { code: "code-1", iss: PDS }) => {
    await run(PDS);
    return new URLSearchParams({ state: pars.at(-1)?.get("state") ?? "", ...extra });
  };
  const complete = (query: URLSearchParams) => completeAuthorization(client, query, log);
  return { run, started, complete, pars, posts, states, sessions, logged };
}

describe("authorize", () => {
  test("authorize_returns_the_server_url", async () => {
    const { run, pars, states } = await setup();
    const result = await run(PDS, "login");
    expect(result.ok).toBe(true);
    const url = (result as { url: URL }).url;
    expect(`${url.origin}${url.pathname}`).toBe(`${PDS}/oauth/authorize`);
    expect(url.searchParams.get("request_uri")).toBe(REQUEST_URI);
    expect(url.searchParams.get("client_id")).toBe(`${ORIGIN}/oauth-client-metadata.json`);
    const [body] = pars;
    expect(body?.get("scope")).toBe(scopeString());
    expect(body?.get("prompt")).toBe("login");
    expect(body?.get("code_challenge_method")).toBe("S256");
    // The server gets the library's own random state; ours rides only in the stored, sealed state.
    expect(body?.get("state")).toMatch(/^[A-Za-z0-9_-]{16,}$/);
    expect([...states.values()].map((state) => state.appState)).toEqual([APP_STATE]);
    expect((await run(PDS)).ok).toBe(true);
    expect(pars[1]?.has("prompt")).toBe(false);
  });

  test("authorize_set_unresolvable_falls_back", async () => {
    const refused = () => json({ error: "invalid_scope", error_description: "Unable to resolve permission set" }, 400);
    const { run, pars, logged } = await setup({
      par: [refused, () => json({ request_uri: REQUEST_URI, expires_in: 299 }, 201)],
    });
    expect((await run(PDS)).ok).toBe(true);
    expect(pars.map((body) => body.get("scope"))).toEqual([scopeString(), scopeStringFallback()]);
    expect(logged).toEqual([{ event: "oauth.scope_fallback_used", fields: {} }]);
  });

  test("authorize_fallback_refused_too_fails", async () => {
    const { run, pars } = await setup({ par: [() => json({ error: "invalid_scope" }, 400)] });
    expect(await run(PDS)).toEqual({ ok: false, reason: "failed" });
    expect(pars).toHaveLength(2);
  });

  test("authorize_handle_not_claimed_is_unverified", async () => {
    // The handle resolves to the DID, but the DID document claims no handle at all.
    const { run, pars } = await setup();
    expect(await run(HANDLE)).toEqual({ ok: false, reason: "handle_unverified" });
    expect(pars).toHaveLength(0);
  });

  test("authorize_handle_not_found", async () => {
    const { run } = await setup({ txt: { kind: "no_record" } });
    expect(await run(HANDLE)).toEqual({ ok: false, reason: "handle_not_found" });
  });

  test("authorize_identity_unavailable", async () => {
    const { run } = await setup({ txt: { kind: "unavailable" } });
    expect(await run(HANDLE)).toEqual({ ok: false, reason: "identity_unavailable" });
  });

  test("authorize_server_unreachable", async () => {
    // P2.05: net-guard `timeout | connect | dns | tls` is an unreachable server; every DNS failure counts.
    const codes = ["egress.timeout", "egress.connect", "egress.tls"] as const;
    for (const code of [...codes, "egress.dns_failed", "egress.dns_no_record", "egress.dns_timeout"] as const) {
      const refused = await setup({ server: () => Promise.reject(new NetGuardError(code)) });
      expect(await refused.run(PDS), code).toEqual({ ok: false, reason: "pds_unreachable" });
    }
    const down = await setup({ par: [() => json({ error: "server_error" }, 503)] });
    expect(await down.run(PDS)).toEqual({ ok: false, reason: "pds_unreachable" });
  });

  test("authorize_other_failure_logs_the_class", async () => {
    const { run, logged } = await setup({
      server: (url) =>
        url.pathname === "/.well-known/oauth-protected-resource"
          ? json({ resource: PDS, authorization_servers: [PDS] })
          : json({ ...asMetadata, issuer: "https://elsewhere.dev" }),
    });
    expect(await run(PDS)).toEqual({ ok: false, reason: "failed" });
    expect(logged).toEqual([{ event: "oauth.authorize_failed", fields: { kind: "OAuthResolverError" } }]);
  });
});

describe("completeAuthorization", () => {
  test("callback_completes", async () => {
    const { started, complete, states, sessions } = await setup();
    const result = await complete(await started());
    expect(result).toMatchObject({ ok: true, did: DID, issuer: PDS, appState: APP_STATE, scope: scopeString() });
    // The library spent its state and stored the token set under the DID.
    expect(states.size).toBe(0);
    expect([...sessions.keys()]).toEqual([DID]);
  });

  test("callback_unknown_or_replayed_state_is_expired", async () => {
    const { started, complete } = await setup();
    expect(await complete(new URLSearchParams({ state: "nope", code: "c", iss: PDS }))).toEqual({
      ok: false,
      reason: "expired",
    });
    const query = await started();
    expect((await complete(query)).ok).toBe(true);
    expect(await complete(query)).toEqual({ ok: false, reason: "expired" });
  });

  test("callback_consent_denied", async () => {
    const { started, complete, posts } = await setup();
    const query = await started({ error: "access_denied", iss: PDS });
    expect(await complete(query)).toEqual({ ok: false, reason: "consent_denied" });
    expect(posts).toEqual([]);
  });

  test("callback_mixup_iss", async () => {
    // A callback naming another issuer is refused before any token request (oauth-client.js:184-194).
    const { started, complete, posts, logged } = await setup();
    expect(await complete(await started({ code: "c", iss: "https://elsewhere.dev" }))).toEqual({
      ok: false,
      reason: "failed",
    });
    expect(posts).toEqual([]);
    expect(logged).toEqual([{ event: "oauth.callback_failed", fields: { kind: "OAuthCallbackError" } }]);
  });

  test("callback_token_endpoint_down_is_unreachable", async () => {
    const { started, complete } = await setup({ token: () => json({ error: "server_error" }, 503) });
    expect(await complete(await started())).toEqual({ ok: false, reason: "pds_unreachable" });
  });

  test("callback_revoke_drops_the_grant", async () => {
    const { started, complete, posts, sessions } = await setup();
    const result = await complete(await started());
    if (!result.ok) throw new Error("expected a completed sign-in");
    await result.revoke();
    expect(posts).toEqual(["/oauth/token", "/oauth/revoke"]);
    expect(sessions.size).toBe(0);
  });
});
