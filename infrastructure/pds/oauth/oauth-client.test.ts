// P2.04 (oauth-client.ts): the client's keys, metadata and JWKS, and construction of the library client over our
// stores, lock, fetch and identity resolvers. Keys are generated per run; no key material sits in the repository.
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDidResolver, type IdentityNetwork } from "@unset/domains-identity";
import { ConfigError, defineConfig, loadConfig, oneOf } from "@unset/shared-config";
import type { LogEvent, LogFields, Logger } from "@unset/shared-log";
import { afterAll, describe, expect, test } from "vitest";
import {
  clientMetadata,
  createOAuthClient,
  oauthFields,
  publicJwks,
  type SavedSession,
  type SavedState,
} from "./oauth-client.ts";

const ORIGIN = "https://unset.example";
const dir = mkdtempSync(join(tmpdir(), "unset-oauth-keys-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const privateJwk = (kid: string, curve = "P-256") => ({
  ...generateKeyPairSync("ec", { namedCurve: curve }).privateKey.export({ format: "jwk" }),
  kid,
  alg: "ES256",
});

/** Loads the OAuth fields from a keys file holding `keys` (written as given) and the rest of `env`. */
function load(keys: unknown, env: Record<string, string> = {}) {
  const file = join(dir, `keys-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, typeof keys === "string" ? keys : JSON.stringify(keys));
  const schema = defineConfig({ UNSET_ENV: oneOf(["dev", "test", "prod"]), ...oauthFields });
  return loadConfig(schema, { UNSET_ENV: "test", OAUTH_CLIENT_KEYS_FILE: file, OAUTH_ACTIVE_KID: "a", ...env });
}

function refusal(keys: unknown, env: Record<string, string> = {}): string {
  try {
    load(keys, env);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return String((error as Error).message);
  }
  throw new Error("expected the config to be refused");
}

describe("client keys", () => {
  test("keys_boot_fails", () => {
    const a = privateJwk("a");
    const { d: _d, ...publicOnly } = a;
    const cases: unknown[] = [
      "not json",
      [],
      [publicOnly],
      [a, { ...privateJwk("b"), kid: "a" }],
      [{ ...a, alg: "ES384" }],
      [privateJwk("a", "P-384")],
      [{ ...a, kid: "" }],
      { keys: [a] },
    ];
    for (const keys of cases) {
      const message = refusal(keys);
      expect(message, JSON.stringify(keys)).toContain("OAUTH_CLIENT_KEYS");
      expect(message).not.toContain(a.d as string);
    }
    expect(refusal([a], { OAUTH_ACTIVE_KID: "b" })).toContain("OAUTH_ACTIVE_KID");
  });

  test("keys_refuse_bad_ec_material", () => {
    // The library imports these without complaint and fails only when it signs, at the first sign-in; they must stop
    // boot as bad config instead.
    const a = privateJwk("a");
    const other = privateJwk("b");
    const cases: Record<string, unknown> = {
      shortX: { ...a, x: "AAAA" },
      notBase64url: { ...a, y: "!!!!" },
      offCurve: { ...a, y: other.y },
      foreignD: { ...a, d: other.d },
    };
    for (const [name, jwk] of Object.entries(cases)) {
      const message = refusal([jwk]);
      expect(message, name).toContain("OAUTH_CLIENT_KEYS");
      expect(message, name).not.toContain(a.d as string);
    }
    expect(load([a]).OAUTH_CLIENT_KEYS.kids).toEqual(["a"]);
  });

  test("keys_print_hidden", () => {
    const cfg = load([privateJwk("a"), privateJwk("b")]);
    expect(cfg.OAUTH_CLIENT_KEYS.kids).toEqual(["a", "b"]);
    expect(JSON.stringify(cfg.OAUTH_CLIENT_KEYS)).toBe('"[oauth keys]"');
    expect(String(cfg.OAUTH_CLIENT_KEYS)).toBe("[oauth keys]");
  });

  test("client_allowHttp_prod", () => {
    // Plain HTTP is for a local stack only, so like NETGUARD_ALLOW_LOOPBACK it is refused anywhere but dev.
    for (const UNSET_ENV of ["prod", "test"])
      expect(refusal([privateJwk("a")], { UNSET_ENV, OAUTH_ALLOW_HTTP: "true" })).toContain("OAUTH_ALLOW_HTTP");
    expect(load([privateJwk("a")], { UNSET_ENV: "dev", OAUTH_ALLOW_HTTP: "true" }).OAUTH_ALLOW_HTTP).toBe(true);
  });

  test("jwks_route_body", () => {
    const body = publicJwks(load([privateJwk("a"), privateJwk("b")]).OAUTH_CLIENT_KEYS);
    expect(body.keys.map((key) => key.kid)).toEqual(["a", "b"]);
    expect(JSON.stringify(body)).not.toMatch(/"d"/);
    for (const key of body.keys) expect(Object.keys(key).sort()).toEqual(["alg", "crv", "kid", "kty", "use", "x", "y"]);
  });
});

const memory = <V>() => {
  const map = new Map<string, V>();
  return {
    get: async (key: string) => map.get(key),
    set: async (key: string, value: V) => void map.set(key, value),
    del: async (key: string) => void map.delete(key),
  };
};

const silentLog: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  logError: () => undefined,
};

const bytes = (body: unknown) => new TextEncoder().encode(JSON.stringify(body));

/** Client options with no network: every fetch answers 503 and no handle resolves. */
function baseOptions() {
  const network: IdentityNetwork = {
    txt: async () => ({ kind: "no_record" }),
    get: async () => ({ kind: "unavailable" }),
  };
  return {
    origin: ORIGIN,
    keys: load([privateJwk("a"), privateJwk("b")]).OAUTH_CLIENT_KEYS,
    activeKid: "b",
    stateStore: memory<SavedState>(),
    sessionStore: memory<SavedSession>(),
    requestLock: async <T>(_name: string, fn: () => T | PromiseLike<T>) => fn(),
    fetch: async () => new Response(null, { status: 503 }),
    network,
    resolveDid: createDidResolver({ network, plcUrl: new URL("https://plc.directory"), cacheTtlS: 60, cacheMax: 10 }),
    allowHttp: false,
    ownIssuer: "https://pds.example",
    log: silentLog,
  };
}

describe("client", () => {
  test("metadata_shape", () => {
    expect(clientMetadata(ORIGIN, "atproto")).toEqual({
      client_id: `${ORIGIN}/oauth-client-metadata.json`,
      client_name: "unset.sh",
      client_uri: ORIGIN,
      tos_uri: `${ORIGIN}/legal/terms`,
      policy_uri: `${ORIGIN}/legal/privacy`,
      redirect_uris: [`${ORIGIN}/oauth/callback`],
      scope: "atproto",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      application_type: "web",
      token_endpoint_auth_method: "private_key_jwt",
      token_endpoint_auth_signing_alg: "ES256",
      dpop_bound_access_tokens: true,
      jwks_uri: `${ORIGIN}/oauth/jwks.json`,
    });
  });

  test("library_identity_cache_bypassed", async () => {
    // atproto.com/specs/oauth: identity data used for auth is cached under 10 minutes. The library would put a 1-hour
    // DID cache in front of ours (@atproto-labs/did-resolver 0.3.10, did-cache-memory.js), so each lookup must reach
    // our resolver, which decides its own freshness.
    const did = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
    const document = {
      id: did,
      service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: "https://pds.example" }],
    };
    const options = baseOptions();
    const real = createDidResolver({
      network: { ...options.network, get: async () => ({ kind: "response", status: 200, body: bytes(document) }) },
      plcUrl: new URL("https://plc.directory"),
      cacheTtlS: 60,
      cacheMax: 10,
    });
    let calls = 0;
    const resolveDid: typeof real = (...args) => {
      calls += 1;
      return real(...args);
    };
    const { client } = await createOAuthClient({ ...options, resolveDid });
    await client.identityResolver.resolve(did).catch(() => undefined);
    await client.identityResolver.resolve(did).catch(() => undefined);
    expect(calls).toBe(2);
  });

  test("library_handle_cache_bypassed", async () => {
    // The library's handle cache (@atproto-labs/handle-resolver cached-handle-resolver.js) keeps a handle ten minutes;
    // each lookup must reach our resolver too.
    const options = baseOptions();
    let lookups = 0;
    const network: IdentityNetwork = {
      ...options.network,
      txt: async () => {
        lookups += 1;
        return { kind: "records", records: ["did=did:plc:aaaaaaaaaaaaaaaaaaaaaaaa"] };
      },
    };
    const { client } = await createOAuthClient({ ...options, network });
    await client.identityResolver.resolve("alice.example.com").catch(() => undefined);
    await client.identityResolver.resolve("alice.example.com").catch(() => undefined);
    expect(lookups).toBe(2);
  });

  test("client_constructs_and_logs_deleted_sessions_only", async () => {
    const logged: { event: LogEvent; fields: LogFields }[] = [];
    const record = (event: LogEvent, fields: LogFields = {}) => {
      logged.push({ event, fields });
    };
    const log: Logger = { info: record, warn: record, error: record, logError: () => undefined };
    const network: IdentityNetwork = {
      txt: async () => ({ kind: "no_record" }),
      get: async () => ({ kind: "unavailable" }),
    };
    const memory = <V>() => {
      const map = new Map<string, V>();
      return {
        get: async (key: string) => map.get(key),
        set: async (key: string, value: V) => void map.set(key, value),
        del: async (key: string) => void map.delete(key),
      };
    };
    const cfg = load([privateJwk("a"), privateJwk("b")]);
    const { client, onSessionDeleted } = await createOAuthClient({
      origin: ORIGIN,
      keys: cfg.OAUTH_CLIENT_KEYS,
      activeKid: "b",
      stateStore: memory<SavedState>(),
      sessionStore: memory<SavedSession>(),
      requestLock: async (_name, fn) => fn(),
      fetch: async () => new Response(null, { status: 503 }),
      network,
      resolveDid: createDidResolver({ network, plcUrl: new URL("https://plc.directory"), cacheTtlS: 60, cacheMax: 10 }),
      allowHttp: false,
      ownIssuer: "https://pds.example",
      log,
    });
    expect(client.clientMetadata.client_id).toBe(`${ORIGIN}/oauth-client-metadata.json`);
    // The library signs with the first key it holds: the active one.
    expect([...(client.keyset ?? [])].map((key) => key.kid)).toEqual(["b", "a"]);
    onSessionDeleted("did:plc:aaaaaaaaaaaaaaaaaaaaaaaa", new Error("whatever"));
    expect(logged).toEqual([{ event: "oauth.session_deleted", fields: { reason: "other" } }]);
  });
});
