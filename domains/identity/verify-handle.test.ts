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

  test("malformed_handles_are_not_claims", async () => {
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
  });

  test("malformed_first_aka_skipped", async () => {
    const w = world();
    w.answers.plc = json(doc(A, ["at://not a handle", "at://@alice.example.com", "at://alice.example.com"]));
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
    expect(await w.verifier({ resolveDid }).verifyHandle(A)).toEqual({ status: "unavailable" });
  });

  test("unexpected_error_reported_once", async () => {
    const w = world();
    const boom = new TypeError("boom");
    const broken: IdentityNetwork = {
      ...w.network,
      get: async () => {
        throw boom;
      },
    };
    const resolveDid = createDidResolver({ network: broken, plcUrl: PLC_URL, cacheTtlS: 0, cacheMax: 1 });
    const reported: unknown[] = [];
    const verify = w.verifier({ resolveDid, onUnexpected: (error) => reported.push(error) });
    expect(await verify.verifyHandle(A)).toEqual({ status: "unavailable" });
    expect(reported).toEqual([boom]);
  });

  test("callback_throw_still_unavailable", async () => {
    const w = world();
    const broken: IdentityNetwork = {
      ...w.network,
      get: async () => {
        throw new TypeError("boom");
      },
    };
    const resolveDid = createDidResolver({ network: broken, plcUrl: PLC_URL, cacheTtlS: 0, cacheMax: 1 });
    let reports = 0;
    const verify = w.verifier({
      resolveDid,
      onUnexpected: () => {
        reports += 1;
        throw new Error("the reporter itself failed");
      },
    });
    expect(await verify.verifyHandle(A)).toEqual({ status: "unavailable" });
    expect(reports).toBe(1);
  });
});

/**
 * A verifier whose TXT answers wait until the test releases them, so checks overlap (P1.33r). PLC answers at once with
 * a document for whichever DID was asked, claiming alice.example.com; the resolver keeps no cache, so only the
 * verifier's sharing is counted.
 */
function heldVerifier(cacheMax = 10) {
  const held: ((outcome: TxtOutcome) => void)[] = [];
  const calls = { plc: 0, txt: [] as string[] };
  const network: IdentityNetwork = {
    get: async (url, request) => {
      if (request.target !== "plc") return status(404);
      calls.plc += 1;
      return json(doc(url.pathname.slice(1), ["at://alice.example.com"]));
    },
    txt: (name) => {
      calls.txt.push(name);
      return new Promise((release) => held.push(release));
    },
  };
  const resolveDid = createDidResolver({ network, plcUrl: PLC_URL, cacheTtlS: 0, cacheMax: 10, now: () => 0 });
  const verifier = createHandleVerifier({ network, resolveDid, verifyTtlS: 600, invalidTtlS: 60, cacheMax });
  return { ...verifier, held, calls };
}

const tick = () => new Promise((settled) => setTimeout(settled, 0));
const C = parseDid("did:plc:cccccccccccccccccccccccc") as Did;
const VERIFIED_A = records(`did=${A}`);

describe("verifyHandle shares in-flight checks", () => {
  test("cached_callers_share_one_check", async () => {
    const w = heldVerifier();
    const { verifyHandle } = w;
    const waiting = Array.from({ length: 50 }, () => verifyHandle(A));
    await tick();
    expect(w.calls).toEqual({ plc: 1, txt: ["_atproto.alice.example.com"] });
    w.held[0]?.(VERIFIED_A);
    expect(new Set((await Promise.all(waiting)).map((v) => v.status))).toEqual(new Set(["verified"]));
    expect(w.calls.txt).toHaveLength(1);
  });

  test("fresh_never_joins_an_earlier_check", async () => {
    const w = heldVerifier();
    const { verifyHandle } = w;
    const early = verifyHandle(A);
    const fresh = verifyHandle(A, { consistency: "fresh" });
    await tick();
    expect(w.calls.txt).toHaveLength(2);
    w.held[1]?.(records(`did=${B}`));
    w.held[0]?.(VERIFIED_A);
    expect((await early).status).toBe("verified");
    expect((await fresh).status).toBe("invalid");
    // The earlier check finished last but no longer owned the DID, so the fresh verdict stays cached.
    expect((await verifyHandle(A)).status).toBe("invalid");
    expect(w.calls.txt).toHaveLength(2);
  });

  test("older_verdict_lands_when_a_newer_fresh_check_fails", async () => {
    const w = heldVerifier();
    const { verifyHandle } = w;
    const older = verifyHandle(A, { consistency: "fresh" });
    const newer = verifyHandle(A, { consistency: "fresh" });
    await tick();
    w.held[1]?.({ kind: "unavailable" });
    expect((await newer).status).toBe("unavailable");
    w.held[0]?.(VERIFIED_A);
    expect((await older).status).toBe("verified");
    // Nothing that started later wrote, so the older verdict is cached: no new check.
    expect((await verifyHandle(A)).status).toBe("verified");
    expect(w.calls.txt).toHaveLength(2);
  });

  test("outage_is_one_check_per_wave", async () => {
    const w = heldVerifier();
    const { verifyHandle } = w;
    const wave = Array.from({ length: 20 }, () => verifyHandle(A));
    await tick();
    w.held[0]?.({ kind: "unavailable" });
    expect(new Set((await Promise.all(wave)).map((v) => v.status))).toEqual(new Set(["unavailable"]));
    expect(w.calls.txt).toHaveLength(1);
  });

  test("in_flight_map_is_capped", async () => {
    const w = heldVerifier(1);
    const { verifyHandle } = w;
    const calls = [A, A, C, C].map((did) => verifyHandle(did));
    await tick();
    // A shares one check; the map is full, so C's callers each run their own check, as before P1.33r.
    expect(w.calls.txt).toHaveLength(3);
    for (const release of w.held) release(VERIFIED_A);
    expect((await Promise.all(calls)).map((v) => v.status)).toEqual(["verified", "verified", "invalid", "invalid"]);
  });

  test("invalidate_reaches_a_check_the_full_map_left_unshared", async () => {
    const w = heldVerifier(1);
    const occupying = w.verifyHandle(A);
    const unshared = w.verifyHandle(C);
    await tick();
    w.invalidateHandle(C);
    w.held[1]?.(records(`did=${C}`));
    expect((await unshared).status).toBe("verified");
    // The check began before the invalidation, so its verdict is not cached: the next call checks again.
    const again = w.verifyHandle(C);
    await tick();
    expect(w.calls.txt).toHaveLength(3);
    w.held[0]?.(VERIFIED_A);
    w.held[2]?.(records(`did=${C}`));
    expect([(await occupying).status, (await again).status]).toEqual(["verified", "verified"]);
  });

  test("aborted_caller_detaches", async () => {
    const w = heldVerifier();
    const { verifyHandle } = w;
    const controller = new AbortController();
    const first = verifyHandle(A, { signal: controller.signal });
    const second = verifyHandle(A);
    await tick();
    controller.abort();
    expect(await first).toEqual({ status: "unavailable" });
    w.held[0]?.(VERIFIED_A);
    expect((await second).status).toBe("verified");
    expect(w.calls.txt).toHaveLength(1);
  });

  test("invalidate_during_a_check_starts_a_new_one", async () => {
    const w = heldVerifier();
    const { verifyHandle, invalidateHandle } = w;
    const before = verifyHandle(A);
    await tick();
    invalidateHandle(A);
    const after = verifyHandle(A);
    await tick();
    expect(w.calls.txt).toHaveLength(2);
    w.held[1]?.(records(`did=${B}`));
    w.held[0]?.(VERIFIED_A);
    expect((await before).status).toBe("verified");
    expect((await after).status).toBe("invalid");
    // The check that started before the invalidation does not write its verdict back.
    expect((await verifyHandle(A)).status).toBe("invalid");
    expect(w.calls.txt).toHaveLength(2);
  });
});
