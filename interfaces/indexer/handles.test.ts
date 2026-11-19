import type { HandleVerdict } from "@unset/domains-identity";
import type { HandleOnPds, RepoStatus } from "@unset/infrastructure-firehose";
import type { HandleJob, HandleOutcome, HandleStore } from "@unset/infrastructure-postgres";
import { describe, expect, test } from "vitest";
import { checkHandle, HANDLE_SWEEP_MS, type HandleCheckDeps, handlePass, isHostedHandle } from "./handles.ts";

const DID = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER = "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb";
const OWN = new URL("https://pds.example.test");
const signal = () => AbortSignal.timeout(1000);

const verified = (handle: string): HandleVerdict =>
  ({ status: "verified", handle, checkedAt: 0 }) as unknown as HandleVerdict;

/** Our PDS answering for a hosted handle that is fine in every way; each test spoils one part. */
function deps(over: Partial<HandleCheckDeps> = {}): HandleCheckDeps {
  return {
    verifyHandle: async () => verified("alice.hosted.test"),
    pdsOf: async () => OWN,
    readStatus: async (): Promise<RepoStatus> => ({ kind: "active" }),
    resolveOnPds: async (): Promise<HandleOnPds> => ({ kind: "did", did: DID }),
    ownPds: OWN,
    hostedSuffixes: [".hosted.test"],
    ...over,
  };
}

describe("handle rule", () => {
  test("hosted-handle-registers-when-pds-confirms", async () => {
    expect(await checkHandle(deps(), DID, signal())).toEqual({ status: "verified", handle: "alice.hosted.test" });
  });

  test("hosted-handle-rejected-when-pds-maps-other-did", async () => {
    const result = await checkHandle(deps({ resolveOnPds: async () => ({ kind: "did", did: OTHER }) }), DID, signal());
    expect(result).toEqual({ status: "invalid" });
  });

  test("hosted-handle-rejected-without-reverse-resolution", async () => {
    const result = await checkHandle(deps({ resolveOnPds: async () => ({ kind: "not_found" }) }), DID, signal());
    expect(result).toEqual({ status: "invalid" });
  });

  test("hosted-handle-rejected-without-active-repo", async () => {
    for (const status of [{ kind: "not_found" }, { kind: "inactive", status: "takendown" }] as RepoStatus[]) {
      expect(await checkHandle(deps({ readStatus: async () => status }), DID, signal())).toEqual({ status: "invalid" });
    }
  });

  test("foreign-pds-hosted-suffix-claim-invalid", async () => {
    const foreign = deps({ pdsOf: async () => new URL("https://elsewhere.example.test") });
    expect(await checkHandle(foreign, DID, signal())).toEqual({ status: "invalid" });
    expect(await checkHandle(deps({ pdsOf: async () => null }), DID, signal())).toEqual({ status: "invalid" });
  });

  test("our-pds-down-is-unresolved", async () => {
    expect(await checkHandle(deps({ readStatus: async () => ({ kind: "unavailable" }) }), DID, signal())).toEqual({
      status: "unresolved",
    });
    expect(await checkHandle(deps({ resolveOnPds: async () => ({ kind: "unavailable" }) }), DID, signal())).toEqual({
      status: "unresolved",
    });
    const unreachable = deps({
      pdsOf: async () => {
        throw new Error("timeout");
      },
    });
    expect(await checkHandle(unreachable, DID, signal())).toEqual({ status: "unresolved" });
  });

  test("verify-handle-truth-table", async () => {
    const own = deps({ verifyHandle: async () => verified("alice.example.org") });
    expect(await checkHandle(own, DID, signal())).toEqual({ status: "verified", handle: "alice.example.org" });
    const invalid = deps({ verifyHandle: async () => ({ status: "invalid", checkedAt: 0 }) });
    expect(await checkHandle(invalid, DID, signal())).toEqual({ status: "invalid" });
    const down = deps({ verifyHandle: async () => ({ status: "unavailable" }) });
    expect(await checkHandle(down, DID, signal())).toEqual({ status: "unresolved" });
  });

  test("a-domain-handle-skips-the-hosted-checks", async () => {
    let asked = 0;
    const own = deps({
      verifyHandle: async () => verified("alice.example.org"),
      readStatus: async () => {
        asked += 1;
        return { kind: "not_found" };
      },
    });
    expect(await checkHandle(own, DID, signal())).toEqual({ status: "verified", handle: "alice.example.org" });
    expect(asked).toBe(0);
  });

  test("hosted-suffix-matches-on-a-label-boundary-only", () => {
    expect(isHostedHandle("alice.hosted.test", [".hosted.test"])).toBe(true);
    expect(isHostedHandle("ALICE.Hosted.Test", [".hosted.test"])).toBe(true);
    expect(isHostedHandle("alicehosted.test", [".hosted.test"])).toBe(false);
    expect(isHostedHandle("hosted.test", [".hosted.test"])).toBe(false);
  });
});

describe("handle pass", () => {
  const job = (did: string): HandleJob => ({ did, kind: "handle_check", attempts: 0, claim: "c" });
  function fakeStore(due: string[]) {
    const written: [string, HandleOutcome][] = [];
    let sweeps = 0;
    const store: Pick<HandleStore, "queueStale" | "dueChecks" | "checked"> = {
      queueStale: async () => {
        sweeps += 1;
        return 2;
      },
      dueChecks: async () => due.map(job),
      checked: async (claimed, outcome) => {
        written.push([claimed.did, outcome]);
      },
    };
    return { store, written, sweeps: () => sweeps };
  }

  test("handle_pass.writes_each_outcome_and_sweeps_every_ten_minutes", async () => {
    const fake = fakeStore([DID, OTHER]);
    let clock = 0;
    const check = deps({
      verifyHandle: async (did) => (did === DID ? verified("alice.example.org") : { status: "unavailable" }),
    });
    const run = {
      store: fake.store,
      check,
      timeoutMs: 1000,
      recheckSeconds: 86_400,
      sweep: { lastAt: null },
      now: () => clock,
    };
    const signal = new AbortController().signal;
    expect(await handlePass({ ...run, signal })).toEqual({
      queued: 2,
      verified: 1,
      invalid: 0,
      unresolved: 1,
      failed: 0,
    });
    expect(fake.written).toEqual([
      [DID, { status: "verified", handle: "alice.example.org" }],
      [OTHER, { status: "unresolved" }],
    ]);
    clock = HANDLE_SWEEP_MS - 1;
    await handlePass({ ...run, signal });
    expect(fake.sweeps()).toBe(1);
    clock = HANDLE_SWEEP_MS;
    await handlePass({ ...run, signal });
    expect(fake.sweeps()).toBe(2);
  });

  test("handle_pass.a_stop_writes_nothing_for_the_check_it_cut_short", async () => {
    const fake = fakeStore([DID, OTHER]);
    const stop = new AbortController();
    const check = deps({
      verifyHandle: async () => {
        stop.abort();
        return { status: "unavailable" };
      },
    });
    const pass = await handlePass({
      store: fake.store,
      check,
      timeoutMs: 1000,
      recheckSeconds: 86_400,
      sweep: { lastAt: 0 },
      now: () => 0,
      signal: stop.signal,
    });
    expect(pass).toEqual({ queued: 0, verified: 0, invalid: 0, unresolved: 0, failed: 0 });
    expect(fake.written).toEqual([]);
  });
});
