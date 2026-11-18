// The indexer's reader of our PDS's event stream (P3.05s, ADRs 0052 and 0058): one serial stream, the cursor written by the
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
  /**
   * The last sequence number applied, or null when none has been. Read on every dial. With null the first dial
   * starts at the live tip (https://atproto.com/specs/event-stream, "Sequence Numbers"); a later one resumes from the
   * first frame this reader saw, or calls missedEvents when it saw none it could number.
   */
  readonly cursor: () => Promise<number | null>;
  /** Applies one frame and writes `frame.seq` as the cursor in the same transaction. Must accept a replayed frame. */
  readonly apply: (frame: RepoFrame) => Promise<void>;
  /**
   * Events may have been missed, so the consumer must backfill again: the PDS said our cursor is older than the
   * events it keeps (`#info OutdatedCursor`), or the reader must resume with no cursor and no frame to resume from.
   */
  readonly missedEvents: () => Promise<void>;
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
  /**
   * Called on each dial the library retries by itself: a refused or failed dial, a socket error, a missed heartbeat
   * or an abnormal close (@atproto/ws-client 0.2.1 dist/websocket.js retries these without ending the iteration, so
   * onStop never hears of them; @atproto/xrpc-server 0.13.10 dist/stream/subscription.js reports each through
   * onReconnectError). A connected, quiet PDS causes none. No argument: the error is not the caller's to log (SE-7).
   */
  readonly onRetry?: () => void;
  /**
   * Milliseconds to wait after a stop, doubling up to `maxRestartDelayMs`; reset once a frame applies. The library's
   * own retry backoff is capped at the same maximum, so no wait between dials of either kind is longer.
   */
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
    if (message.name === "OutdatedCursor") await run("apply_failed", options.consumer.missedEvents);
    return;
  }
  const frame = message.kind === "repoCommit" ? await verifiedCommit(options, message.body) : message.frame;
  await run("apply_failed", () => options.consumer.apply(frame));
}

async function run(reason: StopReason, step: () => Promise<void>): Promise<void> {
  try {
    await step();
  } catch (error) {
    throw new Stop(reason, error);
  }
}

/**
 * Where to resume while the consumer has no cursor yet: just before the first frame this reader saw. Without it a
 * redial after that frame failed would start at the live tip again and skip it for good. `tipAllowed` says a dial
 * with nothing to resume from may go to the live tip: once at start, then once after each successful missedEvents.
 */
type Position = { floor: number | null; tipAllowed: boolean };

/** Records the first frame's sequence number, read from the raw body so even an unreadable frame can be retried. */
function noteFrame(position: Position, value: unknown): void {
  if (position.floor !== null || typeof value !== "object" || value === null) return;
  const { seq } = value as { seq?: unknown };
  if (Number.isSafeInteger(seq) && (seq as number) > 0) position.floor = (seq as number) - 1;
}

/** One connection's life: frames in order until a failure, which ends it. Returns normally only on abort. */
async function readUntilStop(
  options: FirehoseReaderOptions,
  signal: AbortSignal,
  position: Position,
  applied: () => void,
): Promise<void> {
  const subscription = new Subscription({
    service: options.service.origin,
    method: METHOD,
    signal,
    maxReconnectSeconds: Math.max(1, Math.floor(options.maxRestartDelayMs / 1000)),
    onReconnectError: () => {
      try {
        options.onRetry?.();
      } catch {
        // The caller's code, as onStop: a throw there must not end the reader.
      }
    },
    // Called on every dial, including Subscription's own redials after a dropped socket. A throw here rejects the
    // iteration (@atproto/ws-client 0.2.1 dist/websocket.js resolves the url outside its retry), so a second
    // live-tip dial stops the stream and goes through catchUp first.
    getParams: async () => {
      const cursor = (await options.consumer.cursor()) ?? position.floor;
      if (cursor !== null) return { cursor };
      if (!position.tipAllowed) throw new Stop("stream_failed", new Error("redial with nothing to resume from"));
      position.tipAllowed = false;
      return {};
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
      noteFrame(position, value);
      await handle(options, value);
      applied();
    }
  } catch (error) {
    if (signal.aborted) return;
    throw error instanceof Stop ? error : new Stop("stream_failed", error);
  }
}

/** onStop is the caller's code: a throw there must not end the reader, which promises never to throw. */
function report(options: FirehoseReaderOptions, stop: Stop): void {
  try {
    options.onStop(stop.reason, stop.cause);
  } catch {
    // Nothing safe to do with it here: logging it could carry what onStop failed on.
  }
}

/**
 * Before a redial with nothing to resume from, the consumer learns that it may have missed events. That dial goes
 * to the live tip, so it waits until the consumer has taken the news: a throw here stops like any other failure,
 * the live tip stays closed, and the next attempt asks again.
 */
async function catchUp(options: FirehoseReaderOptions, position: Position): Promise<void> {
  if (position.tipAllowed || position.floor !== null) return;
  await run("apply_failed", async () => {
    if ((await options.consumer.cursor()) === null) await options.consumer.missedEvents();
  });
  position.tipAllowed = true;
}

const wait = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) return resolve(); // onStop may have aborted it: its abort event has already fired
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done); // the signal outlives every wait
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });

/**
 * Reads until `signal` aborts. Each stop is reported to `onStop`, then the reader waits and dials again, so the
 * consumer's cursor decides where it resumes. It never throws.
 */
export async function readFirehose(options: FirehoseReaderOptions, signal: AbortSignal): Promise<void> {
  let delay = options.restartDelayMs;
  const position: Position = { floor: null, tipAllowed: true };
  while (!signal.aborted) {
    const connection = new AbortController();
    const stopConnection = () => connection.abort();
    signal.addEventListener("abort", stopConnection, { once: true });
    try {
      await catchUp(options, position);
      await readUntilStop(options, connection.signal, position, () => {
        delay = options.restartDelayMs;
      });
    } catch (error) {
      const stop = error as Stop;
      report(options, stop);
      connection.abort(); // closes the socket before the wait
      await wait(delay, signal);
      delay = Math.min(delay * 2, options.maxRestartDelayMs);
    } finally {
      signal.removeEventListener("abort", stopConnection);
    }
  }
}
