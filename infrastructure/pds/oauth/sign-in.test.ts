// P2.05a, P2.06 (sign-in.ts): a sign-in started and completed against a stand-in authorization server, through the real library client
// (@atproto/oauth-client 0.8.9) over our identity resolvers. Only the network and the server are doubles (TE-1), so
// each outcome is pinned to the error the library really throws, not to a shape written here. The successful runs
// start from the issuer (the PDS chooser), so no DID document here claims a handle: reading that claim belongs to
// the identity files (scripts/guards/also-known-as.ts); identity-resolvers.test.ts covers the claimed-handle path.
import { createHash, generateKeyPairSync } from "node:crypto";
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

/** One origin's authorization-server metadata. The stand-in answers every host, so a second PDS can name itself. */
const metadata = (origin: string) => ({
  issuer: origin,
  authorization_endpoint: `${origin}/oauth/authorize`,
  token_endpoint: `${origin}/oauth/token`,
  revocation_endpoint: `${origin}/oauth/revoke`,
  pushed_authorization_request_endpoint: `${origin}/oauth/par`,
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
});

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
  /** Other accounts the PLC stand-in publishes, each hosted at its own PDS. */
  others?: readonly { did: string; pds: string }[];
  /** Our PDS's issuer as configured; PDS unless a test says otherwise. */
  ownIssuer?: string;
  /** An authorization server our PDS's resource metadata names in place of itself. */
  foreignServer?: string;
};

const TOKENS = { access_token: "at", refresh_token: "rt", token_type: "DPoP", sub: DID, expires_in: 3600 };

type StandIn = {
  pars: URLSearchParams[];
  posts: string[];
  tokenBodies: URLSearchParams[];
  par: (() => Response)[];
  token?: () => Response;
};

/** Discovery documents for whichever host was asked, so a second PDS can name a different issuer. */
function advertisedMetadata(url: URL): Response | undefined {
  if (url.pathname === "/.well-known/oauth-protected-resource") {
    return json({ resource: url.origin, authorization_servers: [url.origin] });
  }
  if (url.pathname === "/.well-known/oauth-authorization-server") return json(metadata(url.origin));
  return undefined;
}

/** The stand-in authorization server: PAR, the token endpoint and revocation, with the bodies kept for the assertions. */
async function standIn(url: URL, request: Request, box: StandIn): Promise<Response> {
  const advertised = advertisedMetadata(url);
  if (advertised) return advertised;
  if (url.pathname === "/oauth/par" && request.method === "POST") {
    box.pars.push(new URLSearchParams(await request.text()));
    return (box.par[box.pars.length - 1] ?? (box.par.at(-1) as () => Response))();
  }
  if (url.pathname === "/oauth/token" && request.method === "POST") {
    box.tokenBodies.push(new URLSearchParams(await request.text()));
    box.posts.push(url.pathname);
    return box.token?.() ?? json({ ...TOKENS, scope: scopeString() });
  }
  if (request.method === "POST") box.posts.push(url.pathname);
  if (url.pathname === "/oauth/revoke") return new Response(null, { status: 200 });
  return json({ error: "not_found" }, 404);
}

/** The real client over a stand-in PLC, handle DNS and authorization server; records PAR bodies and log lines. */
async function setup(world: World = {}) {
  const network: IdentityNetwork = {
    txt: async () => world.txt ?? { kind: "records", records: [`did=${DID}`] },
    get: async (url) => {
      const did = decodeURIComponent(url.pathname.replace(/^\//, ""));
      const pds = did === DID ? PDS : world.others?.find((account) => account.did === did)?.pds;
      if (url.origin !== "https://plc.directory" || pds === undefined) {
        return { kind: "response", status: 404, body: new Uint8Array() };
      }
      return encoded({
        "@context": ["https://www.w3.org/ns/did/v1"],
        id: did,
        verificationMethod: [{ id: `${did}#atproto`, type: "Multikey", controller: did, publicKeyMultibase: "zQ3sh" }],
        service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: pds }],
      });
    },
  };
  const pars: URLSearchParams[] = [];
  const posts: string[] = [];
  const tokenBodies: URLSearchParams[] = [];
  const par = world.par ?? [() => json({ request_uri: REQUEST_URI, expires_in: 299 }, 201)];
  const box: StandIn = { pars, posts, tokenBodies, par, ...(world.token ? { token: world.token } : {}) };
  const server = (url: URL, request: Request): Promise<Response> => {
    if (world.foreignServer && url.pathname === "/.well-known/oauth-protected-resource") {
      return Promise.resolve(json({ resource: url.origin, authorization_servers: [world.foreignServer] }));
    }
    return world.server ? Promise.resolve(world.server(url)) : standIn(url, request, box);
  };
  /** Every host the client sent a request to, so a refusal can show it asked no outside server. */
  const hosts: string[] = [];
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
      hosts.push(new URL(request.url).host);
      return server(new URL(request.url), request);
    },
    network,
    resolveDid: createDidResolver({ network, plcUrl: new URL("https://plc.directory"), cacheTtlS: 60, cacheMax: 10 }),
    allowHttp: false,
    ownIssuer: world.ownIssuer ?? PDS,
    log,
  });
  const run = (input: string, prompt?: "login") =>
    authorize(client, input, {
      appState: APP_STATE,
      ...(prompt ? { prompt } : {}),
      deadline: null,
      ownIssuer: world.ownIssuer ?? PDS,
      log,
    });
  /** Starts a flow at the issuer and returns the query the server would send the browser back with. */
  const started = async (extra: Record<string, string> = { code: "code-1", iss: PDS }) => {
    await run(PDS);
    return new URLSearchParams({ state: pars.at(-1)?.get("state") ?? "", ...extra });
  };
  const complete = (query: URLSearchParams, ownIssuer = world.ownIssuer ?? PDS) =>
    completeAuthorization(client, query, log, ownIssuer);
  return { run, started, complete, pars, posts, tokenBodies, states, sessions, logged, hosts };
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

  test("authorize_account_on_another_pds_is_refused_before_any_request", async () => {
    // P1.36v red: a DID (or the handle that names it) whose PDS is another host. Nothing is sent to that host.
    const other = `did:plc:${"b".repeat(24)}`;
    const { run, pars, hosts } = await setup({ others: [{ did: other, pds: "https://evil.example" }] });
    // A handle reaches the same resolver once it names this DID; the claimed-handle path is identity-resolvers.test.ts's.
    expect(await run(other)).toEqual({ ok: false, reason: "account_elsewhere" });
    expect(pars).toHaveLength(0);
    expect(hosts).toEqual([]);
  });

  test("authorize_foreign_authorization_server_is_never_asked", async () => {
    // P1.36v What-1 (verify-1131 N1): our PDS's resource metadata naming another authorization server never reaches
    // that server: neither its metadata request nor PAR leaves. From a DID the sign-in is refused. From the chooser
    // the library falls back to our URL as the issuer itself (oauth-resolver.js:31-44, 0.8.9), so PAR goes to ours.
    const did = await setup({ foreignServer: "https://evil-as.example" });
    expect(await did.run(DID)).toEqual({ ok: false, reason: "account_elsewhere" });
    expect(did.pars).toHaveLength(0);
    expect(did.hosts.filter((host) => host !== "pds-test.dev")).toEqual([]);
    const chooser = await setup({ foreignServer: "https://evil-as.example" });
    const result = await chooser.run(PDS);
    expect(result.ok && result.url.origin).toBe(PDS);
    expect(chooser.hosts.filter((host) => host !== "pds-test.dev")).toEqual([]);
  });

  test("authorize_issuer_is_ours_exactly", async () => {
    // P1.36v red: a server URL a trailing slash, a letter's case or a scheme away from ours is another issuer.
    const { run, pars, hosts } = await setup();
    for (const input of [`${PDS}/`, PDS.toUpperCase(), "https://PDS-test.dev", PDS.replace("https:", "http:")]) {
      expect(await run(input), input).toEqual({ ok: false, reason: "account_elsewhere" });
    }
    expect(await run("https://evil.example")).toEqual({ ok: false, reason: "account_elsewhere" });
    expect(pars).toHaveLength(0);
    expect(hosts).toEqual([]);
    // Green: our own issuer, and an account on our PDS.
    expect((await run(PDS)).ok).toBe(true);
    expect((await run(DID)).ok).toBe(true);
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
          : json({ ...metadata(PDS), issuer: "https://elsewhere.dev" }),
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
    // The library spent its state and stored the tokens the server issued, under the DID.
    expect(states.size).toBe(0);
    expect(sessions.get(DID)?.tokenSet).toMatchObject({
      access_token: "at",
      refresh_token: "rt",
      sub: DID,
      iss: PDS,
    });
  });

  test("callback_pkce_verifier_matches_the_challenge", async () => {
    // RFC 7636 §4.2, checked in @atproto/oauth-client 0.8.9 oauth-server-agent.js exchangeCode.
    const { started, complete, pars, tokenBodies } = await setup();
    expect((await complete(await started())).ok).toBe(true);
    const challenge = pars[0]?.get("code_challenge");
    const verifier = tokenBodies[0]?.get("code_verifier") ?? "";
    expect(pars[0]?.get("code_challenge_method")).toBe("S256");
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(createHash("sha256").update(verifier).digest("base64url")).toBe(challenge);
  });

  test("callback_unknown_or_replayed_state_is_expired", async () => {
    const { started, complete, posts } = await setup();
    expect(await complete(new URLSearchParams({ state: "nope", code: "c", iss: PDS }))).toEqual({
      ok: false,
      reason: "expired",
    });
    const query = await started();
    expect((await complete(query)).ok).toBe(true);
    const sent = posts.length;
    expect(await complete(query)).toEqual({ ok: false, reason: "expired" });
    // The state row is deleted before the code is sent (oauth-client.js:169-174), so a replayed callback exchanges nothing.
    expect(posts).toHaveLength(sent);
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

  test("callback_issuer_not_ours_is_revoked_and_refused", async () => {
    // P1.36v red: the issuer the grant came from must still be ours exactly at the callback; a trailing slash or a
    // letter's case is another issuer. The grant is revoked and its token set dropped, so no session can be made.
    for (const configured of [`${PDS}/`, "https://PDS-test.dev"]) {
      const { started, complete, sessions, posts, logged } = await setup();
      expect(await complete(await started(), configured), configured).toEqual({
        ok: false,
        reason: "account_elsewhere",
      });
      expect(sessions.size).toBe(0);
      expect(posts).toEqual(["/oauth/token", "/oauth/revoke"]);
      expect(logged).toContainEqual({ event: "oauth.callback_failed", fields: { kind: "issuer_elsewhere" } });
    }
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

  test("callback_rejects_subject_of_another_issuer", async () => {
    // verifyIssuer (oauth-server-agent.js, 0.8.9) resolves the sub's DID document through our resolver, which refuses
    // an account on another PDS (P1.36v: the sub's PDS must still be ours), so the library revokes the grant.
    const other = `did:plc:${"b".repeat(24)}`;
    const { started, complete, sessions, posts, logged } = await setup({
      others: [{ did: other, pds: "https://evil.example" }],
      token: () => json({ ...TOKENS, sub: other, scope: scopeString() }),
    });
    expect(await complete(await started())).toEqual({ ok: false, reason: "account_elsewhere" });
    expect(sessions.size).toBe(0);
    expect(posts).toEqual(["/oauth/token", "/oauth/revoke"]);
    // verify-1131 N5: the refusal is logged as a fixed kind, never the DID, handle or host (SE-7).
    expect(logged).toContainEqual({ event: "oauth.callback_failed", fields: { kind: "account_elsewhere" } });
  });

  test("callback_second_login_replaces_the_set", async () => {
    // A second browser's callback revokes the stored grant and keeps the new one (oauth-client.js:196-209).
    let issued = 0;
    const { started, complete, sessions, posts } = await setup({
      token: () => {
        issued += 1;
        return json({ ...TOKENS, access_token: `at-${issued}`, refresh_token: `rt-${issued}`, scope: scopeString() });
      },
    });
    expect((await complete(await started({ code: "code-1", iss: PDS }))).ok).toBe(true);
    expect((await complete(await started({ code: "code-2", iss: PDS }))).ok).toBe(true);
    expect([...sessions.keys()]).toEqual([DID]);
    expect(sessions.get(DID)?.tokenSet.refresh_token).toBe("rt-2");
    expect(posts).toEqual(["/oauth/token", "/oauth/token", "/oauth/revoke"]);
  });
});
