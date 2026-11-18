// P3.05s (reader.ts): the reader against a stand-in for our PDS's subscribeRepos, which is an unmanaged dependency
// (rule TE-1). Commits are real signed repo commits built with @atproto/repo 0.11.5, so verification runs for real.
import { Secp256k1Keypair } from "@atproto/crypto";
import { blocksToCarFile, MemoryBlockstore, Repo, WriteOpAction } from "@atproto/repo";

type Cid = NonNullable<Awaited<ReturnType<Repo["data"]["get"]>>>;

import { ErrorFrame, MessageFrame } from "@atproto/xrpc-server";
import { afterEach, describe, expect, test } from "vitest";
import { WebSocketServer } from "ws";
import type { RepoFrame } from "./frames.ts";
import { type FirehoseConsumer, readFirehose, type StopReason } from "./reader.ts";

const DID = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
const PROFILE = "sh.unset.profile" as const;
const METHOD = "com.atproto.sync.subscribeRepos";

type Sent = { seq: number; bytes: Uint8Array };

/**
 * Serves `frames()` after the dial's cursor (exclusive, https://atproto.com/specs/event-stream), then idles. A dial
 * with no cursor starts at the live tip, as the spec says: the first such dial sees the frames as they arrive, a later
 * one sees none of them again.
 */
async function fakePds(frames: () => Sent[]) {
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise((resolve) => server.once("listening", resolve));
  const dials: (number | null)[] = [];
  server.on("connection", (socket, request) => {
    const url = new URL(request.url ?? "/", "http://x");
    expect(url.pathname).toBe(`/xrpc/${METHOD}`);
    const cursor = url.searchParams.get("cursor");
    const live = cursor === null && dials.every((dial) => dial !== null);
    dials.push(cursor === null ? null : Number(cursor));
    if (cursor === null && !live) return; // the tip has moved past everything sent so far
    for (const frame of frames()) if (cursor === null || frame.seq > Number(cursor)) socket.send(frame.bytes);
  });
  const { port } = server.address() as { port: number };
  return { url: new URL(`http://127.0.0.1:${port}`), dials, close: () => server.close() };
}

type Body = ConstructorParameters<typeof MessageFrame>[0];
const frame = (type: string, body: Body): Uint8Array => new MessageFrame(body, { type }).toBytes();

/** A signed repo for DID; `commit` returns the `#commit` frame for one batch of writes. */
async function signedRepo(key: Secp256k1Keypair) {
  let repo = await Repo.create(new MemoryBlockstore(), DID, key);
  type Op = { action: string; path: string; cid: Cid | null };
  return async (
    seq: number,
    writes: Parameters<Repo["formatCommit"]>[0],
    signWith = key,
    claim: (ops: Op[]) => Op[] = (ops) => ops,
  ): Promise<Sent> => {
    const data = await repo.formatCommit(writes, signWith);
    repo = await repo.applyCommit(data);
    const list = Array.isArray(writes) ? writes : [writes];
    // Each op names its record's new CID (null for a delete), read back from the repo's data after the commit.
    const ops = await Promise.all(
      list.map(async (write) => {
        const path = `${write.collection}/${write.rkey}`;
        return {
          action: write.action,
          path,
          cid: write.action === WriteOpAction.Delete ? null : await repo.data.get(path),
        };
      }),
    );
    const body = {
      seq,
      rebase: false,
      tooBig: false,
      repo: DID,
      commit: data.cid,
      rev: data.rev,
      since: data.since,
      blocks: await blocksToCarFile(data.cid, data.relevantBlocks),
      ops: claim(ops),
      blobs: [],
      time: new Date(0).toISOString(),
    };
    return { seq, bytes: frame("#commit", body) };
  };
}

const create = (rkey: string, displayName: string) => ({
  action: WriteOpAction.Create as const,
  collection: PROFILE,
  rkey,
  record: { $type: PROFILE, displayName },
});

type Run = { applied: RepoFrame[]; stops: StopReason[]; missed: number; stop: () => void; done: Promise<void> };

/** Runs the reader with a consumer that keeps its cursor in memory, until `until` holds or two seconds pass. */
function start(service: URL, keyFor: () => string, consumer: Partial<FirehoseConsumer> = {}): Run {
  const controller = new AbortController();
  let cursor: number | null = null;
  const run: Run = { applied: [], stops: [], missed: 0, stop: () => controller.abort(), done: Promise.resolve() };
  run.done = readFirehose(
    {
      service,
      signingKey: async () => keyFor(),
      consumer: {
        cursor: async () => cursor,
        apply: async (applied) => {
          run.applied.push(applied);
          cursor = applied.seq;
        },
        missedEvents: async () => {
          run.missed += 1;
        },
        ...consumer,
      },
      onStop: (reason) => run.stops.push(reason),
      restartDelayMs: 10,
      maxRestartDelayMs: 20,
    },
    controller.signal,
  );
  return run;
}

async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function setup(frames: () => Sent[], consumer?: Partial<FirehoseConsumer>, keyFor?: () => string) {
  const pds = await fakePds(frames);
  const run = start(pds.url, keyFor ?? (() => "unset"), consumer);
  cleanups.push(() => {
    run.stop();
    pds.close();
  });
  return { pds, run };
}

describe("readFirehose", () => {
  test("reader.applies_a_signed_commit_with_its_record", async () => {
    const key = await Secp256k1Keypair.create();
    const commit = await signedRepo(key);
    const sent = [await commit(1, create("self", "Ada"))];
    const { pds, run } = await setup(
      () => sent,
      undefined,
      () => key.did(),
    );
    await until(() => run.applied.length === 1);
    const [applied] = run.applied;
    expect(applied).toMatchObject({ kind: "repoCommit", seq: 1, did: DID });
    expect(applied?.kind === "repoCommit" && applied.changes).toEqual([
      expect.objectContaining({
        kind: "put",
        collection: PROFILE,
        rkey: "self",
        record: { $type: PROFILE, displayName: "Ada" },
      }),
    ]);
    expect(pds.dials).toEqual([null]);
    expect(run.stops).toEqual([]);
  });

  test("reader.refuses_a_commit_signed_with_another_key", async () => {
    const key = await Secp256k1Keypair.create();
    const forger = await Secp256k1Keypair.create();
    const commit = await signedRepo(key);
    const sent = [await commit(1, create("self", "Ada"), forger)];
    const { pds, run } = await setup(
      () => sent,
      undefined,
      () => key.did(),
    );
    await until(() => run.stops.length >= 2);
    expect(run.stops.slice(0, 2)).toEqual(["commit_unverified", "commit_unverified"]);
    expect(run.applied).toEqual([]);
    expect(pds.dials.slice(0, 2)).toEqual([null, 0]); // nothing moved the cursor; the redial asks for frame 1 again
  });

  test("reader.refuses_a_commit_with_an_unproven_op", async () => {
    // The commit is genuine but its op claims a delete of a record the signed tree still holds: the library drops
    // such an op without an error (repo/dist/sync/consumer.js verifyProofs, `unverified`), so the reader must notice.
    const key = await Secp256k1Keypair.create();
    const commit = await signedRepo(key);
    const sent = [
      await commit(1, create("self", "Ada"), key, (ops) => ops.map((op) => ({ ...op, action: "delete", cid: null }))),
    ];
    const { run } = await setup(
      () => sent,
      undefined,
      () => key.did(),
    );
    await until(() => run.stops.length >= 1);
    expect(run.stops[0]).toBe("commit_unverified");
    expect(run.applied).toEqual([]);
  });

  test("reader.zero_op_commit_carries_no_rev", async () => {
    // With no ops the parser returns before checking any signature, so a forged key still gets through: the rev
    // must not reach ingest as if it were signed.
    const key = await Secp256k1Keypair.create();
    const forger = await Secp256k1Keypair.create();
    const commit = await signedRepo(key);
    const sent = [await commit(1, [], forger)];
    const { run } = await setup(
      () => sent,
      undefined,
      () => key.did(),
    );
    await until(() => run.applied.length === 1);
    expect(run.applied[0]).toEqual({ kind: "repoCommit", seq: 1, did: DID, rev: null, changes: [] });
  });

  test("reader.ends_promptly_when_on_stop_aborts", async () => {
    const sent = [{ seq: 1, bytes: frame("#account", { seq: 1, did: DID, time: "t" }) }]; // unreadable
    const pds = await fakePds(() => sent);
    cleanups.push(() => pds.close());
    const controller = new AbortController();
    const started = Date.now();
    await readFirehose(
      {
        service: pds.url,
        signingKey: async () => "unused",
        consumer: { cursor: async () => null, apply: async () => undefined, missedEvents: async () => undefined },
        onStop: () => controller.abort(), // shut down on the first stop
        restartDelayMs: 10_000,
        maxRestartDelayMs: 10_000,
      },
      controller.signal,
    );
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test("reader.survives_a_throwing_on_stop", async () => {
    const sent = [{ seq: 1, bytes: frame("#account", { seq: 1, did: DID, time: "t" }) }]; // unreadable
    const pds = await fakePds(() => sent);
    const controller = new AbortController();
    let stops = 0;
    const done = readFirehose(
      {
        service: pds.url,
        signingKey: async () => "unused",
        consumer: { cursor: async () => null, apply: async () => undefined, missedEvents: async () => undefined },
        onStop: () => {
          stops += 1;
          throw new Error("logger down");
        },
        restartDelayMs: 5,
        maxRestartDelayMs: 5,
      },
      controller.signal,
    );
    cleanups.push(() => pds.close());
    await until(() => stops >= 2); // it kept reading after the first throw
    controller.abort();
    await expect(done).resolves.toBeUndefined();
  });

  test("reader.first_frame_failure_replays_without_a_stored_cursor", async () => {
    // No cursor yet: a redial with none would start at the live tip and skip the failed frame for good.
    const sent = [
      { seq: 5, bytes: frame("#identity", { seq: 5, did: DID, time: "t" }) },
      { seq: 6, bytes: frame("#identity", { seq: 6, did: DID, time: "t" }) },
    ];
    let failures = 1;
    const seen: number[] = [];
    const { pds, run } = await setup(() => sent, {
      cursor: async () => (seen.length === 0 ? null : (seen.at(-1) ?? null)),
      apply: async (applied) => {
        if (failures-- > 0) throw new Error("db down");
        seen.push(applied.seq);
      },
    });
    await until(() => seen.length === 2);
    expect(seen).toEqual([5, 6]);
    expect(run.stops).toEqual(["apply_failed"]);
    expect(pds.dials).toEqual([null, 4]);
  });

  test("reader.handler_failure_replays_from_cursor", async () => {
    const key = await Secp256k1Keypair.create();
    const commit = await signedRepo(key);
    const sent = [
      await commit(1, create("a", "one")),
      await commit(2, create("b", "two")),
      await commit(3, create("c", "three")),
    ];
    let failures = 1;
    let cursor: number | null = null;
    const seen: number[] = [];
    const { pds, run } = await setup(
      () => sent,
      {
        cursor: async () => cursor,
        apply: async (applied) => {
          if (applied.seq === 2 && failures-- > 0) throw new Error("db down");
          seen.push(applied.seq);
          cursor = applied.seq;
        },
      },
      () => key.did(),
    );
    await until(() => seen.length === 3);
    expect(seen).toEqual([1, 2, 3]);
    expect(run.stops).toEqual(["apply_failed"]);
    expect(pds.dials).toEqual([null, 1]);
  });

  test("reader.unreadable_frame_stops_before_the_next", async () => {
    const sent = [
      { seq: 1, bytes: frame("#account", { seq: 1, did: DID, time: "t" }) }, // no `active`
      { seq: 2, bytes: frame("#identity", { seq: 2, did: DID, time: "t" }) },
    ];
    const { run } = await setup(() => sent);
    await until(() => run.stops.length >= 2);
    expect(run.stops.slice(0, 2)).toEqual(["stream_failed", "stream_failed"]);
    expect(run.applied).toEqual([]);
  });

  test("reader.passes_account_identity_and_missed_events", async () => {
    const sent = [
      { seq: 1, bytes: frame("#account", { seq: 1, did: DID, time: "t", active: false, status: "brand-new" }) },
      { seq: 2, bytes: frame("#identity", { seq: 2, did: DID, time: "t", handle: "someone.example" }) },
      { seq: 0, bytes: frame("#info", { name: "OutdatedCursor" }) },
    ];
    const { run } = await setup(() => sent);
    await until(() => run.missed === 1);
    expect(run.applied).toEqual([
      { kind: "account", seq: 1, did: DID, active: false, status: "unknown" },
      { kind: "identity", seq: 2, did: DID },
    ]);
  });

  test("reader.stops_on_an_error_frame", async () => {
    const sent = [{ seq: 0, bytes: new ErrorFrame({ error: "FutureCursor", message: "ahead" }).toBytes() }];
    const { run } = await setup(() => sent);
    await until(() => run.stops.length >= 1);
    expect(run.stops[0]).toBe("stream_failed");
    expect(run.applied).toEqual([]);
    await until(() => run.missed >= 1); // no frame to resume from: the consumer must backfill
  });

  test("reader.retries_a_failed_missed_events_before_redial", async () => {
    // A redial with no cursor goes to the live tip, so a backfill request that failed must succeed before it.
    const sent = [{ seq: 0, bytes: new ErrorFrame({ error: "FutureCursor", message: "ahead" }).toBytes() }];
    let failures = 1;
    const dialsAtSuccess: number[] = [];
    const { pds, run } = await setup(() => sent, {
      missedEvents: async () => {
        if (failures-- > 0) throw new Error("db down");
        dialsAtSuccess.push(pds.dials.length);
      },
    });
    await until(() => pds.dials.length === 2);
    expect(dialsAtSuccess).toEqual([1]); // taken before the second dial, and asked only once more
    expect(run.stops).toEqual(["stream_failed", "apply_failed"]);
  });
});

describe("process", () => {
  // Contract change 2 (book P3.00s): the indexer is on no network with `edge`, and @atproto/xrpc-server loads
  // express. Run the reader in its own Node process, with every listen() recorded, until it applies a frame.
  test("reader.opens_no_listening_socket", async () => {
    const { execFile } = await import("node:child_process");
    const sent = [{ seq: 1, bytes: frame("#identity", { seq: 1, did: DID, time: "t" }) }];
    const pds = await fakePds(() => sent);
    cleanups.push(() => pds.close());
    const child = `
      import net from "node:net";
      const listens = [];
      const listen = net.Server.prototype.listen;
      net.Server.prototype.listen = function (...args) { listens.push(String(args[0])); return listen.apply(this, args); };
      const { readFirehose } = await import(${JSON.stringify(new URL("./reader.ts", import.meta.url).pathname)});
      const controller = new AbortController();
      await readFirehose({
        service: new URL(process.argv[1]),
        signingKey: async () => { throw new Error("unused"); },
        consumer: {
          cursor: async () => null,
          apply: async () => {
            const servers = process.getActiveResourcesInfo().filter((name) => /Server/.test(name));
            console.log(JSON.stringify({ listens, servers }));
            controller.abort();
          },
          missedEvents: async () => {},
        },
        onStop: (reason) => { console.log(JSON.stringify({ stop: reason })); process.exit(1); },
        restartDelayMs: 10,
        maxRestartDelayMs: 10,
      }, controller.signal);
    `;
    const output = await new Promise<string>((resolve, reject) =>
      execFile(
        process.execPath,
        ["--input-type=module", "-e", child, pds.url.href],
        { timeout: 10_000 },
        (error, stdout) => (error ? reject(new Error(`${error.message}\n${stdout}`)) : resolve(stdout)),
      ),
    );
    expect(JSON.parse(output.trim())).toEqual({ listens: [], servers: [] });
  });
});
