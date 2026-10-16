// P2.04 (infrastructure/pds/oauth/oauth-client.ts): two web replicas over one Postgres must never spend the same
// refresh token. Each replica is its own client over the real sealed stores and the real advisory lock, connected as
// `web` (TE-2); the authorization server and PDS are a stand-in on loopback (an unmanaged dependency, TE-1), so the
// client may use plain HTTP here (allowHttp) and the test's own fetch, not net-guard's.
import { generateKeyPairSync } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { relative } from "node:path";
import { type Consistency, createDidResolver, type Did, type IdentityNetwork } from "@unset/domains-identity";
import { createOAuthClient, parseClientKeys, type SavedSession } from "@unset/infrastructure-pds";
import { createSealer, parseKeyring } from "@unset/infrastructure-seal";
import type { Logger } from "@unset/shared-log";
import { afterAll, beforeAll, describe, expect, inject, test } from "vitest";
import {
  createLockPool,
  createOAuthSessionStore,
  createOAuthStateStore,
  createPool,
  createRequestLock,
  type Pool,
  withClient,
} from "../../../infrastructure/postgres/index.ts";

const provided = inject("postgres");
const database = provided.databases[relative(`${import.meta.dirname}/../../..`, import.meta.filename)] ?? "";
const connection = { host: provided.host, port: provided.port, ...provided.roles.web, database, ssl: false };
const pools: Pool[] = [];
const silent: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  logError: () => undefined,
};
afterAll(() => Promise.all(pools.map((pool) => pool.end())));

const DID = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
/** The account's DID document as the PLC directory serves it. */
const document = {
  id: DID,
  service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: "https://pds.example" }],
};
const keyring = parseKeyring(JSON.stringify({ active: "k1", keys: { k1: Buffer.alloc(32, 3).toString("base64") } }));
if (keyring === undefined) throw new Error("test keyring did not parse");
const sealer = createSealer(keyring);
/** A private ES256 JWK, made per run; no key material sits in the repository. */
const privateJwk = (kid: string) => ({
  ...generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "jwk" }),
  kid,
  alg: "ES256",
});
const [jwkA, jwkB] = [privateJwk("A"), privateJwk("B")];
const clientKeys = (...jwks: object[]) => {
  const parsed = parseClientKeys(JSON.stringify(jwks));
  if (parsed === undefined) throw new Error("test client keys did not parse");
  return parsed;
};
const onlyA = { keys: clientKeys(jwkA), activeKid: "A" };

/**
 * The stand-in authorization server and PDS: one origin, one rotating refresh token, every token request counted with
 * the client key id its assertion was signed with.
 */
const as = {
  origin: "",
  server: undefined as Server | undefined,
  valid: "r1",
  tokenRequests: 0,
  signedWith: [] as string[],
  issued: 1,
  /** An issuer the metadata claims in place of its own origin, to play an impostor. */
  claimedIssuer: undefined as string | undefined,
};
const body = (request: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let text = "";
    request.on("data", (chunk) => {
      text += chunk;
    });
    request.on("end", () => resolve(text));
  });

beforeAll(async () => {
  as.server = createServer(async (request, response) => {
    const json = (status: number, value: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(value));
    };
    if (request.url === "/.well-known/oauth-protected-resource")
      return json(200, { resource: as.origin, authorization_servers: [as.origin] });
    if (request.url === "/.well-known/oauth-authorization-server")
      return json(200, { ...metadata(as.origin), issuer: as.claimedIssuer ?? as.origin });
    if (request.url === "/oauth/token" && request.method === "POST") {
      as.tokenRequests += 1;
      const form = new URLSearchParams(await body(request));
      const header = (form.get("client_assertion") ?? "").split(".")[0] ?? "";
      as.signedWith.push(JSON.parse(Buffer.from(header, "base64url").toString()).kid);
      // Slow enough that two unsynchronised replicas would both send the same refresh token.
      await new Promise((resolve) => setTimeout(resolve, 300));
      if (form.get("grant_type") !== "refresh_token" || form.get("refresh_token") !== as.valid)
        return json(400, { error: "invalid_grant" });
      as.issued += 1;
      as.valid = `r${as.issued}`;
      return json(200, {
        access_token: `a${as.issued}`,
        refresh_token: as.valid,
        token_type: "DPoP",
        expires_in: 3600,
        scope: "atproto",
        sub: DID,
      });
    }
    return json(404, {});
  });
  await new Promise<void>((resolve) => as.server?.listen(0, "127.0.0.1", resolve));
  as.origin = `http://127.0.0.1:${(as.server.address() as { port: number }).port}`;
});
afterAll(() => as.server?.close());

function metadata(issuer: string) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    pushed_authorization_request_endpoint: `${issuer}/oauth/par`,
    require_pushed_authorization_requests: true,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
    token_endpoint_auth_signing_alg_values_supported: ["ES256"],
    dpop_signing_alg_values_supported: ["ES256"],
    scopes_supported: ["atproto"],
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: true,
  };
}

/** One web replica: its own pools, stores and client, as a second container would have. */
async function replica(lock: "advisory" | "none", { keys, activeKid } = onlyA) {
  const pool = createPool({ connection, service: "oauth-refresh-test", max: 2, connectTimeoutMs: 5000 });
  const lockPool = createLockPool({ connection, service: "oauth-refresh-lock", max: 2, log: silent });
  pools.push(pool, lockPool.pool);
  const network: IdentityNetwork = {
    txt: async () => ({ kind: "no_record" }),
    get: async () => ({ kind: "response", status: 200, body: new TextEncoder().encode(JSON.stringify(document)) }),
  };
  // The identity domain resolves the DID as it would in production; only the PDS it found is swapped for the stand-in
  // on loopback, which the domain would refuse (https only).
  const domainResolver = createDidResolver({
    network,
    plcUrl: new URL("https://plc.example"),
    cacheTtlS: 60,
    cacheMax: 8,
  });
  const resolveDid = async (did: Did, consistency: Consistency) => ({
    ...(await domainResolver(did, consistency)),
    pds: new URL(as.origin),
  });
  const { client } = await createOAuthClient({
    origin: "https://unset.example",
    keys,
    activeKid,
    stateStore: createOAuthStateStore({ pool, sealer, log: silent }),
    sessionStore: createOAuthSessionStore<SavedSession>({ pool, sealer, log: silent }),
    requestLock: lock === "advisory" ? createRequestLock(lockPool) : async (_name, fn) => fn(),
    fetch,
    network,
    resolveDid,
    allowHttp: true,
    log: silent,
  });
  return { client, sessions: createOAuthSessionStore<SavedSession>({ pool, sealer, log: silent }) };
}

/** A token set that expired a minute ago, bound to client key A, as the callback would have stored it. */
async function storeExpiredSession(): Promise<void> {
  const { sessions } = await replica("advisory");
  as.valid = "r1";
  as.tokenRequests = 0;
  as.signedWith = [];
  await sessions.set(DID, {
    dpopJwk: privateJwk("dpop") as SavedSession["dpopJwk"],
    authMethod: { method: "private_key_jwt", kid: "A" },
    tokenSet: {
      iss: as.origin,
      sub: DID,
      aud: as.origin,
      scope: "atproto",
      refresh_token: "r1",
      access_token: "a1",
      token_type: "DPoP",
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    },
  } as SavedSession);
}

describe("oauth refresh across replicas", () => {
  test("client_two_replicas_one_refresh", { timeout: 30_000 }, async () => {
    await storeExpiredSession();
    const [a, b] = [await replica("advisory"), await replica("advisory")];
    const restored = await Promise.allSettled([a.client.restore(DID), b.client.restore(DID)]);
    expect(restored.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    // The second replica waited for the lock, re-read the store, found a fresh set and sent nothing.
    expect(as.tokenRequests).toBe(1);
    const stored = await a.sessions.get(DID);
    expect(stored?.tokenSet.refresh_token).toBe(as.valid);
    expect(
      await withClient(pools[0] as Pool, null, (db) => db.query("SELECT client_kid FROM app.oauth_session")),
    ).toMatchObject({ rows: [{ client_kid: "A" }] });
  });

  test("client_without_lock_loses_the_session", { timeout: 30_000 }, async () => {
    // The same race with no lock: both replicas spend r1, the server refuses the second, and the library deletes the
    // token set. This is the failure the advisory lock exists to prevent, and it shows the test above can see it.
    await storeExpiredSession();
    const [a, b] = [await replica("none"), await replica("none")];
    const restored = await Promise.allSettled([a.client.restore(DID), b.client.restore(DID)]);
    expect(as.tokenRequests).toBe(2);
    expect(restored.filter((r) => r.status === "rejected")).toHaveLength(1);
  });

  test("rotation_old_kid_sessions_still_refresh", { timeout: 30_000 }, async () => {
    // Runbook step 2: key B is added and made active. A token set bound to A keeps refreshing with A, so switching the
    // active key signs nobody out.
    await storeExpiredSession();
    const { client, sessions } = await replica("advisory", { keys: clientKeys(jwkB, jwkA), activeKid: "B" });
    await client.restore(DID);
    expect(as.signedWith).toEqual(["A"]);
    expect((await sessions.get(DID))?.authMethod).toEqual({ method: "private_key_jwt", kid: "A" });
  });

  test("rotation_removed_kid_logs_out", { timeout: 30_000 }, async () => {
    // Removing A while a set is still bound to it deletes that set at its next refresh, before any token request: the
    // forced re-login the runbook avoids by waiting until no row names A.
    await storeExpiredSession();
    const { client, sessions } = await replica("advisory", { keys: clientKeys(jwkB), activeKid: "B" });
    await expect(client.restore(DID)).rejects.toThrow();
    expect(as.tokenRequests).toBe(0);
    expect(await sessions.get(DID)).toBeUndefined();
  });

  test("client_rejects_impersonating_issuer", { timeout: 30_000 }, async () => {
    // ASVS V10.5.3: metadata whose issuer is not the one the token set came from is refused before any token request
    // (mix-up check, @atproto/oauth-client 0.8.9 oauth-authorization-server-metadata-resolver.js:40-44).
    await storeExpiredSession();
    as.claimedIssuer = "https://other-as.example";
    try {
      const { client } = await replica("advisory");
      await expect(client.restore(DID)).rejects.toThrow();
      expect(as.tokenRequests).toBe(0);
    } finally {
      as.claimedIssuer = undefined;
    }
  });
});
