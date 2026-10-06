import { describe, expect, test } from "vitest";
import {
  createDidResolver,
  type Did,
  type FetchRequest,
  type HttpOutcome,
  IdentityError,
  type IdentityNetwork,
  parseDid,
} from "./index.ts";

const DID = parseDid("did:plc:ewvi7nxzyoun6zhxrhs64oiz") as Did;
const WEB = parseDid("did:web:example.com") as Did;
const PLC_URL = new URL("https://plc.directory");
const ACCEPT = "application/did+ld+json, application/json";

const doc = (did: string, extra: Record<string, unknown> = {}) => ({
  "@context": ["https://www.w3.org/ns/did/v1"],
  id: did,
  alsoKnownAs: ["at://alice.example.com", 7],
  verificationMethod: [{ id: `${did}#atproto`, type: "Multikey", controller: did, publicKeyMultibase: "zQ3shKey" }],
  service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: "https://pds.example.com" }],
  ...extra,
});

const ok = (body: unknown): HttpOutcome => ({
  kind: "response",
  status: 200,
  body: new TextEncoder().encode(JSON.stringify(body)),
});
const status = (code: number): HttpOutcome => ({ kind: "response", status: code, body: new Uint8Array() });

/** A stand-in network (PLC and did:web hosts are unmanaged dependencies, TE-1) recording each request. */
function resolver(answer: (url: URL) => HttpOutcome, clock = { now: 0 }) {
  const calls: ({ url: string } & FetchRequest)[] = [];
  const network: IdentityNetwork = {
    get: async (url, request) => {
      calls.push({ url: url.href, ...request });
      return answer(url);
    },
    txt: async () => ({ kind: "unavailable" }),
  };
  const resolveDid = createDidResolver({ network, plcUrl: PLC_URL, cacheTtlS: 300, cacheMax: 2, now: () => clock.now });
  return { resolve: resolveDid, calls, clock };
}

async function kindOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "resolved";
  } catch (error) {
    return error instanceof IdentityError ? error.kind : `other: ${String(error)}`;
  }
}

describe("resolveDid", () => {
  test("plc_ok", async () => {
    const { resolve, calls } = resolver(() => ok(doc(DID)));
    const resolved = await resolve(DID, { consistency: "fresh" });
    expect(resolved).toEqual({
      did: DID,
      pds: new URL("https://pds.example.com"),
      signingKeyMultibase: "zQ3shKey",
      rawAlsoKnownAs: ["at://alice.example.com"],
    });
    expect(calls).toEqual([
      { url: `https://plc.directory/${DID}`, target: "plc", maxBytes: 64 * 1024, accept: ACCEPT },
    ]);
  });

  test("web_reads_well_known_did_json", async () => {
    const { resolve, calls } = resolver(() => ok(doc(WEB)));
    expect((await resolve(WEB, { consistency: "fresh" })).did).toBe(WEB);
    expect(calls).toEqual([
      { url: "https://example.com/.well-known/did.json", target: "public", maxBytes: 64 * 1024, accept: ACCEPT },
    ]);
  });

  test("id_mismatch", async () => {
    const { resolve } = resolver(() => ok(doc("did:plc:aaaaaaaaaaaaaaaaaaaaaaaa")));
    expect(await kindOf(resolve(DID, { consistency: "fresh" }))).toBe("invalid_doc");
  });

  test("not_json_or_not_an_object", async () => {
    for (const body of [new TextEncoder().encode("{"), new Uint8Array([0xff, 0xfe]), new TextEncoder().encode("[]")]) {
      const { resolve } = resolver(() => ({ kind: "response", status: 200, body }));
      expect(await kindOf(resolve(DID, { consistency: "fresh" }))).toBe("invalid_doc");
    }
  });

  test("unparsable_did_sends_nothing", async () => {
    const { resolve, calls } = resolver(() => ok(doc(DID)));
    expect(await kindOf(resolve("did:web:localhost" as Did, { consistency: "fresh" }))).toBe("invalid_doc");
    expect(calls).toEqual([]);
  });

  test("plc_404_410", async () => {
    for (const code of [404, 410]) {
      const { resolve } = resolver(() => status(code));
      expect(await kindOf(resolve(DID, { consistency: "fresh" })), String(code)).toBe("not_found");
    }
  });

  test("plc_5xx_timeout", async () => {
    for (const outcome of [status(503), status(500), status(429), { kind: "unavailable" } as const]) {
      const { resolve } = resolver(() => outcome);
      expect(await kindOf(resolve(DID, { consistency: "fresh" }))).toBe("unavailable");
    }
  });

  test("blocked_redirect_too_large", async () => {
    // net-guard refuses private answers, redirects and oversized bodies; the port reports all of them as refused.
    for (const outcome of [{ kind: "refused" } as const, status(302), status(301), status(204), status(400)]) {
      const { resolve } = resolver(() => outcome);
      expect(await kindOf(resolve(WEB, { consistency: "fresh" }))).toBe("invalid_doc");
    }
  });

  test("missing_web_host_is_unavailable", async () => {
    const { resolve } = resolver(() => ({ kind: "no_such_host" }));
    expect(await kindOf(resolve(WEB, { consistency: "fresh" }))).toBe("unavailable");
  });

  test("pds_endpoint_rules", async () => {
    const pdsOf = async (service: unknown) => {
      const { resolve } = resolver(() => ok(doc(DID, { service })));
      return (await resolve(DID, { consistency: "fresh" })).pds?.href ?? null;
    };
    const entry = (serviceEndpoint: unknown, extra: Record<string, unknown> = {}) => [
      { id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint, ...extra },
    ];
    expect(await pdsOf(entry("https://pds.example.com"))).toBe("https://pds.example.com/");
    expect(await pdsOf(entry("https://pds.example.com/"))).toBe("https://pds.example.com/");
    expect(await pdsOf(entry("https://pds.example.com:8443"))).toBe("https://pds.example.com:8443/");
    expect(
      await pdsOf([
        { id: `${DID}#atproto_pds`, type: "AtprotoPersonalDataServer", serviceEndpoint: "https://a.example.com" },
      ]),
    ).toBe("https://a.example.com/");
    for (const bad of [
      "http://pds.example.com",
      "https://pds.example.com/xrpc",
      "https://user:pass@pds.example.com",
      "https://pds.example.com?x=1",
      "https://pds.example.com?",
      "https://pds.example.com#f",
      "not a url",
      42,
    ]) {
      expect(await pdsOf(entry(bad)), String(bad)).toBeNull();
    }
    expect(await pdsOf([])).toBeNull();
    expect(await pdsOf("not an array")).toBeNull();
    expect(await pdsOf(entry("https://pds.example.com", { type: "Other" }))).toBeNull();
    expect(
      await pdsOf(entry("https://pds.example.com", { id: "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa#atproto_pds" })),
    ).toBeNull();
    // The first matching entry decides, even when a later one is valid (atproto DID spec, "DID Documents").
    expect(await pdsOf([...entry("http://first.example.com"), ...entry("https://second.example.com")])).toBeNull();
  });

  test("signing_key_rules", async () => {
    const keyOf = async (verificationMethod: unknown) => {
      const { resolve } = resolver(() => ok(doc(DID, { verificationMethod })));
      return (await resolve(DID, { consistency: "fresh" })).signingKeyMultibase;
    };
    const key = (extra: Record<string, unknown>) => ({
      id: "#atproto",
      type: "Multikey",
      controller: DID,
      publicKeyMultibase: "zKey",
      ...extra,
    });
    expect(await keyOf([key({})])).toBe("zKey");
    expect(
      await keyOf([key({ controller: "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa" }), key({ publicKeyMultibase: "z2" })]),
    ).toBe("z2");
    expect(await keyOf([key({ type: "EcdsaSecp256k1VerificationKey2019" })])).toBeNull();
    expect(await keyOf([key({ id: "#other" })])).toBeNull();
    expect(await keyOf([key({ publicKeyMultibase: 5 })])).toBeNull();
    expect(await keyOf(undefined)).toBeNull();
  });

  test("also_known_as_kept_raw", async () => {
    const akaOf = async (alsoKnownAs: unknown) => {
      const { resolve } = resolver(() => ok(doc(DID, { alsoKnownAs })));
      return (await resolve(DID, { consistency: "fresh" })).rawAlsoKnownAs;
    };
    expect(await akaOf(["at://b.example.com", "at://a.example.com"])).toEqual([
      "at://b.example.com",
      "at://a.example.com",
    ]);
    expect(await akaOf("at://a.example.com")).toEqual([]);
    expect(await akaOf(undefined)).toEqual([]);
  });

  test("cache", async () => {
    let served = doc(DID);
    const { resolve, calls, clock } = resolver(() => ok(served));
    await resolve(DID, { consistency: "cached" });
    await resolve(DID, { consistency: "cached" });
    expect(calls).toHaveLength(1);

    served = doc(DID, { service: [] });
    expect((await resolve(DID, { consistency: "fresh" })).pds).toBeNull();
    expect(calls).toHaveLength(2);
    // The fresh read replaced the entry.
    expect((await resolve(DID, { consistency: "cached" })).pds).toBeNull();
    expect(calls).toHaveLength(2);

    clock.now += 300_001;
    await resolve(DID, { consistency: "cached" });
    expect(calls).toHaveLength(3);
  });

  test("cache_evicts_least_recently_used", async () => {
    const a = parseDid("did:plc:aaaaaaaaaaaaaaaaaaaaaaaa") as Did;
    const b = parseDid("did:plc:bbbbbbbbbbbbbbbbbbbbbbbb") as Did;
    const { resolve, calls } = resolver((url) => ok(doc(url.pathname.slice(1))));
    await resolve(a, { consistency: "cached" });
    await resolve(b, { consistency: "cached" });
    await resolve(a, { consistency: "cached" }); // a is now the most recently used
    await resolve(DID, { consistency: "cached" }); // evicts b (cacheMax 2)
    expect(calls).toHaveLength(3);
    await resolve(a, { consistency: "cached" });
    expect(calls).toHaveLength(3);
    await resolve(b, { consistency: "cached" });
    expect(calls).toHaveLength(4);
  });

  test("failures_are_never_cached", async () => {
    let outcome: HttpOutcome = status(503);
    const { resolve, calls } = resolver(() => outcome);
    expect(await kindOf(resolve(DID, { consistency: "cached" }))).toBe("unavailable");
    outcome = status(404);
    expect(await kindOf(resolve(DID, { consistency: "cached" }))).toBe("not_found");
    outcome = ok(doc(DID));
    expect((await resolve(DID, { consistency: "cached" })).did).toBe(DID);
    expect(calls).toHaveLength(3);
  });

  test("fresh_and_cached_read_plc_url_only", async () => {
    // Phase 2 has no PLC replica: both consistencies read PLC_URL, and a fresh read never reads anything else.
    const { resolve, calls } = resolver(() => ok(doc(DID)));
    await resolve(DID, { consistency: "cached" });
    await resolve(DID, { consistency: "fresh" });
    expect(calls.map((c) => new URL(c.url).origin)).toEqual([PLC_URL.origin, PLC_URL.origin]);
  });
});
