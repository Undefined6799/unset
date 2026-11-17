// The indexer's reader of our PDS's event stream (P3.05s, ADR 0052): one serial stream, the cursor written by the
// consumer in the frame's own transaction, and any failure stops the stream and reconnects from that cursor, so no
// frame is ever skipped in-process (book phase-3 P3.05s, "outcome C").
//
// Built from the pieces @atproto/sync 0.4.24 exports rather than its Firehose class, because that class reports a
// handler or parse failure to onError and carries on with the next frame (node_modules/@atproto/sync/dist/firehose/
// index.js, processEvt and parseEvt), and the next frame's cursor would then move past the failed one. The stream
// itself is @atproto/xrpc-server 0.13.10's Subscription (dist/stream/subscription.js), which reconnects a dropped
// socket on its own and asks getParams for the cursor on every dial. It dials only when we pull the next frame, so
// the cursor it reads is the one the last applied frame wrote. A failure after a frame arrives is ours to restart.
import { parseCommitAuthenticated } from "@atproto/sync";
import { Subscription } from "@atproto/xrpc-server";
import { type CommitBody, commitFrame, parseMessage, type RepoFrame } from "./frames.ts";

/** What the indexer gives the reader. Every method may throw; a throw stops the stream. */
export type FirehoseConsumer = {
  /** The last sequence number applied, or null to start at the live tip. Read on every dial. */
  readonly cursor: () => Promise<number | null>;
  /** Applies one frame and writes `frame.seq` as the cursor in the same transaction. Must accept a replayed frame. */
  readonly apply: (frame: RepoFrame) => Promise<void>;
  /** The PDS said our cursor is older than the events it keeps: the consumer must backfill again. */
  readonly outdatedCursor: () => Promise<void>;
};

/** Why the stream stopped. None of these carries a DID, a handle or record content (rule SE-7). */
export type StopReason =
  /** The PDS sent a frame we cannot read, or an error frame, or the socket failed for good. */
  | "stream_failed"
  /** A commit's signature or proofs did not verify, or its author's signing key could not be found. */
  | "commit_unverified"
  /** The consumer threw. */
  | "apply_failed";

export type FirehoseReaderOptions = {
  /** INDEXER_PDS_URL: our PDS's internal origin, from config, never from a caller. */
  readonly service: URL;
  /**
   * The DID's current atproto signing key as a `did:key`, through the identity resolver on net-guard. `fresh`
   * bypasses any cache: the library asks again with it once when a signature fails, in case the key rotated.
   */
  readonly signingKey: (did: string, options: { readonly fresh: boolean }) => Promise<string>;
  readonly consumer: FirehoseConsumer;
  /** Called once per stop, before the wait; `error` is for the caller's own error classification, never a log line. */
  readonly onStop: (reason: StopReason, error: unknown) => void;
  /** Milliseconds to wait after a stop, doubling up to `maxRestartDelayMs`; reset once a frame applies. */
  readonly restartDelayMs: number;
  readonly maxRestartDelayMs: number;
};

const METHOD = "com.atproto.sync.subscribeRepos";

class Stop extends Error {
  readonly reason: StopReason;
  constructor(reason: StopReason, cause: unknown) {
    super(reason, { cause });
    this.reason = reason;
  }
}

type IdResolver = Parameters<typeof parseCommitAuthenticated>[0];

/**
 * The one IdResolver method parseCommitAuthenticated calls (firehose/index.js, parseCommitAuthenticated), so every
 * key lookup goes through our resolver on net-guard and never through @atproto/identity's own fetch.
 */
function keyResolver(signingKey: FirehoseReaderOptions["signingKey"]): IdResolver {
  const did = { resolveAtprotoKey: (id: string, fresh = false) => signingKey(id, { fresh }) };
  return { did } as unknown as IdResolver;
}

async function verifiedCommit(options: FirehoseReaderOptions, body: CommitBody): Promise<RepoFrame> {
  let writes: Awaited<ReturnType<typeof parseCommitAuthenticated>>;
  try {
    // A null filter: every op is proven, so commitFrame can compare the count with the ops the commit claims.
    // The library's Commit type also lists the deprecated rebase, tooBig, since and blobs, which the parser never reads.
    const commit = body as unknown as Parameters<typeof parseCommitAuthenticated>[1];
    writes = await parseCommitAuthenticated(keyResolver(options.signingKey), commit, null);
  } catch (error) {
    throw new Stop("commit_unverified", error);
  }
  const frame = commitFrame(body, writes);
  if (frame === null) throw new Stop("commit_unverified", new Error("unproven op"));
  return frame;
}

async function handle(options: FirehoseReaderOptions, value: unknown): Promise<void> {
  const message = parseMessage(value);
  if (message === null) throw new Stop("stream_failed", new Error("unreadable frame"));
  if (message.kind === "info") {
    if (message.name === "OutdatedCursor") await run("apply_failed", options.consumer.outdatedCursor);
    return;
  }
  const frame = message.kind === "commit" ? await verifiedCommit(options, message.body) : message.frame;
  await run("apply_failed", () => options.consumer.apply(frame));
}

async function run(reason: StopReason, step: () => Promise<void>): Promise<void> {
  try {
    await step();
  } catch (error) {
    throw new Stop(reason, error);
  }
}

/** One connection's life: frames in order until a failure, which ends it. Returns normally only on abort. */
async function readUntilStop(options: FirehoseReaderOptions, signal: AbortSignal, applied: () => void): Promise<void> {
  const subscription = new Subscription({
    service: options.service.origin,
    method: METHOD,
    signal,
    getParams: async () => {
      const cursor = await options.consumer.cursor();
      return cursor === null ? {} : { cursor };
    },
    // Subscription skips a frame whose validate returns undefined, and it passes undefined for a body that is not
    // a map; throwing instead ends the iteration, so such a frame stops the stream like any other unreadable one.
    validate: (value: unknown) => {
      if (value === undefined) throw new Stop("stream_failed", new Error("frame body is not a map"));
      return value;
    },
  });
  try {
    for await (const value of subscription) {
      await handle(options, value);
      applied();
    }
  } catch (error) {
    if (signal.aborted) return;
    throw error instanceof Stop ? error : new Stop("stream_failed", error);
  }
}

const wait = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    const cancel = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", cancel, { once: true });
  });

/**
 * Reads until `signal` aborts. Each stop is reported to `onStop`, then the reader waits and dials again, so the
 * consumer's cursor decides where it resumes. It never throws.
 */
export async function readFirehose(options: FirehoseReaderOptions, signal: AbortSignal): Promise<void> {
  let delay = options.restartDelayMs;
  while (!signal.aborted) {
    const connection = new AbortController();
    const stopConnection = () => connection.abort();
    signal.addEventListener("abort", stopConnection, { once: true });
    try {
      await readUntilStop(options, connection.signal, () => {
        delay = options.restartDelayMs;
      });
    } catch (error) {
      const stop = error as Stop;
      options.onStop(stop.reason, stop.cause);
      connection.abort(); // closes the socket before the wait
      await wait(delay, signal);
      delay = Math.min(delay * 2, options.maxRestartDelayMs);
    } finally {
      signal.removeEventListener("abort", stopConnection);
    }
  }
}
