import { describe, expect, test } from "vitest";
import {
  createDidResolver,
  createHandleVerifier,
  type Did,
  displayHandle,
  type HttpOutcome,
  type IdentityNetwork,
  parseDid,
  type TxtOutcome,
} from "./index.ts";

const A = parseDid("did:plc:aaaaaaaaaaaaaaaaaaaaaaaa") as Did;
const B = "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb";
const PLC_URL = new URL("https://plc.directory");

const doc = (did: string, alsoKnownAs: unknown[]) => ({ id: did, alsoKnownAs });
const json = (body: unknown): HttpOutcome => ({
  kind: "response",
  status: 200,
  body: new TextEncoder().encode(JSON.stringify(body)),
});
const status = (code: number): HttpOutcome => ({ kind: "response", status: code, body: new Uint8Array() });
const records = (...values: string[]): TxtOutcome => ({ kind: "records", records: values });
const NO_RECORD: TxtOutcome = { kind: "no_record" };

/**
 * A stand-in network (PLC, DNS and handle domains are unmanaged dependencies, TE-1). Each answer can be changed
 * between calls; every request is recorded. The DID resolver and handle resolution are the real domain code.
 */
function world() {
  const answers = {
    plc: json(doc(A, ["at://alice.example.com"])) as HttpOutcome,
    txt: {} as Record<string, TxtOutcome>,
    https: status(404) as HttpOutcome,
  };
  const calls = { plc: 0, txt: [] as string[] };
  const network: IdentityNetwork = {
    get: async (url, request) => {
      if (request.target === "plc") {
        calls.plc += 1;
        return answers.plc;
      }
      return answers.https;
    },
    txt: async (name) => {
      calls.txt.push(name);
      return answers.txt[name] ?? NO_RECORD;
    },
  };
  const clock = { now: 1_000 };
  const options = { network, verifyTtlS: 600, invalidTtlS: 60, cacheMax: 10, now: () => clock.now };
  const resolveDid = createDidResolver({ network, plcUrl: PLC_URL, cacheTtlS: 0, cacheMax: 10, now: () => clock.now });
  const verifier = (extra: Partial<Parameters<typeof createHandleVerifier>[0]> = {}) =>
    createHandleVerifier({ ...options, resolveDid, ...extra });
  return { answers, calls, clock, verifier, network };
}

describe("verifyHandle", () => {
  test("bidirectional_ok", async () => {
    const w = world();
    w.answers.txt["_atproto.alice.example.com"] = records(`did=${A}`);
    const verdict = await w.verifier().verifyHandle(A);
    expect(verdict).toEqual({ status: "verified", handle: "alice.example.com", checkedAt: 1_000 });
    expect(displayHandle(verdict)).toBe("alice.example.com");
  });

  test("https_only_verified", async () => {
    const w = world();
    w.answers.https = { kind: "response", status: 200, body: new TextEncoder().encode(`${A}\n`) };
    expect((await w.verifier().verifyHandle(A)).status).toBe("verified");
  });

  test("reverse_mismatch", async () => {
    const w = world();
    w.answers.txt["_atproto.alice.example.com"] = records(`did=${B}`);
    const verdict = await w.verifier().verifyHandle(A);
    expect(verdict).toEqual({ status: "invalid", checkedAt: 1_000 });
    expect(displayHandle(verdict)).toBe("handle.invalid");
  });

  test("first_aka_only", async () => {
    const w = world();
    w.answers.plc = json(doc(A, ["https://elsewhere.example", "at://mallory.example.com", "at://alice.example.com"]));
    w.answers.txt["_atproto.alice.example.com"] = records(`did=${A}`);
    expect((await w.verifier().verifyHandle(A)).status).toBe("invalid");
    expect(w.calls.txt).toEqual(["_atproto.mallory.example.com"]);
  });

  test("no_aka", async () => {
    for (const aka of [[], ["https://alice.example.com"]]) {
      const w = world();
      w.answers.plc = json(doc(A, aka));
      expect((await w.verifier().verifyHandle(A)).status).toBe("invalid");
      expect(w.calls.txt).toEqual([]);
    }
  });

  test("first_valid_handle_counts", async () => {
    const malformed = [
      "at://alice.example.com/app.bsky.actor.profile",
      "at://@alice.example.com",
      "at:// alice.example.com",
      "at://alice.local",
      "AT://alice.example.com",
    ];
    for (const aka of malformed) {
      const w = world();
      w.answers.plc = json(doc(A, [aka]));
      expect((await w.verifier().verifyHandle(A)).status).toBe("invalid");
      expect(w.calls.txt).toEqual([]);
    }
    const w = world();
    w.answers.plc = json(doc(A, [...malformed, "at://alice.example.com"]));
    w.answers.txt["_atproto.alice.example.com"] = records(`did=${A}`);
    expect((await w.verifier().verifyHandle(A)).status).toBe("verified");
    expect(w.calls.txt).toEqual(["_atproto.alice.example.com"]);
  });

  test("claimed_handle_is_normalised", async () => {
    const w = world();
    w.answers.plc = json(doc(A, ["at://ALICE.Example.com"]));
    w.answers.txt["_atproto.alice.example.com"] = records(`did=${A}`);
    const verdict = await w.verifier().verifyHandle(A);
    expect(verdict).toMatchObject({ status: "verified", handle: "alice.example.com" });
  });

  test("missing_or_broken_doc_is_invalid", async () => {
    for (const answer of [status(404), status(410), json(doc(B, ["at://alice.example.com"])), status(400)]) {
      const w = world();
      w.answers.plc = answer;
      expect((await w.verifier().verifyHandle(A)).status).toBe("invalid");
    }
  });

  test("plc_unavailable_not_cached", async () => {
    const w = world();
    w.answers.txt["_atproto.alice.example.com"] = records(`did=${A}`);
    w.answers.plc = status(503);
    const verify = w.verifier();
    const first = await verify.verifyHandle(A);
    expect(first).toEqual({ status: "unavailable" });
    expect(displayHandle(first)).toBe("handle.invalid");
    w.answers.plc = json(doc(A, ["at://alice.example.com"]));
    expect((await verify.verifyHandle(A)).status).toBe("verified");
    expect(w.calls.plc).toBe(2);
  });

  test("handle_unavailable_not_cached", async () => {
    const w = world();
    w.answers.txt["_atproto.alice.example.com"] = { kind: "unavailable" };
    const verify = w.verifier();
    expect((await verify.verifyHandle(A)).status).toBe("unavailable");
    w.answers.txt["_atproto.alice.example.com"] = records(`did=${A}`);
    expect((await verify.verifyHandle(A)).status).toBe("verified");
  });

  test("cache_ttls", async () => {
    const w = world();
    w.answers.txt["_atproto.alice.example.com"] = records(`did=${A}`);
    const verify = w.verifier();
    await verify.verifyHandle(A);
    w.clock.now += 599_999;
    expect((await verify.verifyHandle(A)).status).toBe("verified");
    expect(w.calls.plc).toBe(1);
    w.clock.now += 1;
    await verify.verifyHandle(A);
    expect(w.calls.plc).toBe(2);

    const v = world();
    v.answers.txt["_atproto.alice.example.com"] = records(`did=${B}`);
    const verifyInvalid = v.verifier();
    await verifyInvalid.verifyHandle(A);
    v.clock.now += 59_999;
    expect((await verifyInvalid.verifyHandle(A)).status).toBe("invalid");
    expect(v.calls.plc).toBe(1);
    v.clock.now += 1;
    await verifyInvalid.verifyHandle(A);
    expect(v.calls.plc).toBe(2);
  });

  test("fresh_skips_the_cache", async () => {
    const w = world();
    w.answers.txt["_atproto.alice.example.com"] = records(`did=${A}`);
    const verify = w.verifier();
    await verify.verifyHandle(A);
    w.answers.txt["_atproto.alice.example.com"] = records(`did=${B}`);
    expect((await verify.verifyHandle(A)).status).toBe("verified");
    expect((await verify.verifyHandle(A, { consistency: "fresh" })).status).toBe("invalid");
    expect((await verify.verifyHandle(A)).status).toBe("invalid");
  });

  test("invalidate", async () => {
    const w = world();
    w.answers.txt["_atproto.alice.example.com"] = records(`did=${A}`);
    const verify = w.verifier();
    await verify.verifyHandle(A);
    w.answers.plc = json(doc(A, ["at://bob.example.com"]));
    verify.invalidateHandle(A);
    expect((await verify.verifyHandle(A)).status).toBe("invalid");
    expect(w.calls.txt).toEqual(["_atproto.alice.example.com", "_atproto.bob.example.com"]);
  });

  test("cache_evicts_least_recently_used", async () => {
    const w = world();
    w.answers.txt["_atproto.alice.example.com"] = records(`did=${A}`);
    const verify = w.verifier({ cacheMax: 1 });
    await verify.verifyHandle(A);
    w.answers.plc = json(doc(B, ["at://bob.example.com"]));
    await verify.verifyHandle(B as Did);
    w.answers.plc = json(doc(A, ["at://alice.example.com"]));
    await verify.verifyHandle(A);
    expect(w.calls.plc).toBe(3);
  });

  test("never_throws", async () => {
    const w = world();
    const broken: IdentityNetwork = {
      ...w.network,
      get: async () => {
        throw new TypeError("boom");
      },
    };
    const resolveDid = createDidResolver({ network: broken, plcUrl: PLC_URL, cacheTtlS: 0, cacheMax: 1 });
    const reported: unknown[] = [];
    const verify = w.verifier({ resolveDid, onUnexpected: (error) => reported.push(error) });
    expect(await verify.verifyHandle(A)).toEqual({ status: "unavailable" });
    expect(reported).toHaveLength(1);
    expect(reported[0]).toBeInstanceOf(TypeError);
    expect(await w.verifier({ resolveDid }).verifyHandle(A)).toEqual({ status: "unavailable" });
  });
});
