// The frames the indexer reads from our PDS's com.atproto.sync.subscribeRepos stream, translated into our own shapes
// at this boundary (P3.05s, ADR 0052). Message fields per the lexicon at
// https://github.com/bluesky-social/atproto/blob/main/lexicons/com/atproto/sync/subscribeRepos.json and the spec at
// https://atproto.com/specs/event-stream ("Framing", "Sequence Numbers"), read for @atproto/sync 0.4.24.
//
// The checks here are structural only: is it the shape the parser below expects? Whether a commit is genuine is
// decided by verifyProofs (reader.ts), and whether a record is valid by the lexicon validator in ingest.
import type { CommitEvt } from "@atproto/sync";
import { recordToJson } from "@unset/shared-lexicons";

/** One change to one record, proven against the signed commit it came in. */
export type RecordChange =
  | {
      readonly kind: "put";
      readonly collection: string;
      readonly rkey: string;
      readonly cid: string;
      /**
       * In its JSON form (https://atproto.com/specs/data-model, "JSON Representation": a CID as `{ $link }`, bytes as
       * `{ $bytes }`), converted by shared/lexicons (@atproto/lex-json 0.1.9). Not yet validated: ingest checks it
       * against the lexicon, and it is stored as jsonb.
       */
      readonly record: unknown;
    }
  | { readonly kind: "delete"; readonly collection: string; readonly rkey: string };

/** The status values the spec names for `#account` (https://atproto.com/specs/account, "Account Status"). */
const ACCOUNT_STATUSES = ["takendown", "suspended", "deleted", "deactivated", "desynchronized", "throttled"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number] | "unknown";

/**
 * One frame of the stream with a sequence number. Every frame reaches the consumer, even a commit whose changes are
 * all in collections ingest ignores, so the cursor it writes moves past it. `seq` is never signed (it is the PDS's
 * stream position, https://atproto.com/specs/event-stream), so ingest uses it only as the cursor.
 */
export type RepoFrame =
  | {
      readonly kind: "repoCommit";
      readonly seq: number;
      readonly did: string;
      /**
       * The signed commit's rev, or null for a commit with no ops: parseCommitAuthenticated returns before it checks
       * any signature when there is nothing to prove, so that rev is unauthenticated and ingest must not use it.
       */
      readonly rev: string | null;
      readonly changes: readonly RecordChange[];
    }
  /** `status` is null when the PDS sent none; a value the spec does not list arrives as `unknown`, never dropped. */
  | {
      readonly kind: "account";
      readonly seq: number;
      readonly did: string;
      readonly active: boolean;
      readonly status: AccountStatus | null;
    }
  /** Only the DID: the handle is never taken from the frame, ingest checks it with verifyHandle (CLAUDE.md, Identity). */
  | { readonly kind: "identity"; readonly seq: number; readonly did: string }
  /** The repo was reset to a new state; ingest backfills it again from getRepo, which verifies the whole repo. */
  | { readonly kind: "sync"; readonly seq: number; readonly did: string; readonly rev: string };

/** What the stream sent, after the structural check. `commit` keeps the body for verifyProofs. */
export type StreamMessage =
  | { readonly kind: "repoCommit"; readonly body: CommitBody }
  | { readonly kind: "frame"; readonly frame: RepoFrame }
  /** `#info` carries no sequence number; `OutdatedCursor` is the one name the lexicon defines. */
  | { readonly kind: "info"; readonly name: string };

/** The fields of `#commit` that parseCommitAuthenticated reads. */
export type CommitBody = {
  readonly $type: string;
  readonly seq: number;
  readonly repo: string;
  readonly rev: string;
  readonly time: string;
  readonly commit: unknown;
  readonly blocks: Uint8Array;
  readonly ops: readonly { readonly action: string; readonly path: string; readonly cid: unknown }[];
};

const METHOD = "com.atproto.sync.subscribeRepos";
const MAX_OPS = 200; // the lexicon's maxLength for `ops`

type Entry = Record<string, unknown>;
const isEntry = (value: unknown): value is Entry =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isSeq = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const isDid = (value: unknown): value is string => typeof value === "string" && value.startsWith("did:");
const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0;

function isOp(value: unknown): boolean {
  return (
    isEntry(value) &&
    (value.action === "create" || value.action === "update" || value.action === "delete") &&
    isText(value.path) &&
    "cid" in value
  );
}

function commitOf(body: Entry): StreamMessage | null {
  const { seq, repo, rev, time, blocks, ops } = body;
  if (!isSeq(seq) || !isDid(repo) || !isText(rev) || !isText(time) || !(blocks instanceof Uint8Array)) return null;
  if (!Array.isArray(ops) || ops.length > MAX_OPS || !ops.every(isOp) || body.commit === undefined) return null;
  return { kind: "repoCommit", body: body as CommitBody };
}

function accountOf(body: Entry): StreamMessage | null {
  const { seq, did, active, status } = body;
  if (!isSeq(seq) || !isDid(did) || typeof active !== "boolean") return null;
  if (status !== undefined && typeof status !== "string") return null;
  const known = ACCOUNT_STATUSES.find((name) => name === status);
  const frame = {
    kind: "account",
    seq,
    did,
    active,
    status: status === undefined ? null : (known ?? "unknown"),
  } as const;
  return { kind: "frame", frame };
}

function identityOf(body: Entry): StreamMessage | null {
  const { seq, did } = body;
  return isSeq(seq) && isDid(did) ? { kind: "frame", frame: { kind: "identity", seq, did } } : null;
}

function syncOf(body: Entry): StreamMessage | null {
  const { seq, did, rev } = body;
  return isSeq(seq) && isDid(did) && isText(rev) ? { kind: "frame", frame: { kind: "sync", seq, did, rev } } : null;
}

/**
 * The message a decoded frame body stands for, or null when it is not one of the shapes above. Subscription sets
 * `$type` from the frame header (`#commit` becomes `com.atproto.sync.subscribeRepos#commit`). Null stops the stream:
 * the reader never skips a frame it cannot read, since the next one would move the cursor past it.
 */
export function parseMessage(body: unknown): StreamMessage | null {
  if (!isEntry(body) || typeof body.$type !== "string") return null;
  switch (body.$type) {
    case `${METHOD}#commit`:
      return commitOf(body);
    case `${METHOD}#account`:
      return accountOf(body);
    case `${METHOD}#identity`:
      return identityOf(body);
    case `${METHOD}#sync`:
      return syncOf(body);
    case `${METHOD}#info`:
      return isText(body.name) ? { kind: "info", name: body.name } : null;
    default:
      return null;
  }
}

/**
 * The commit frame for the writes parseCommitAuthenticated proved, or null when it proved fewer than the commit
 * claims. The library drops an op it cannot prove (and a create or update whose block is missing) without an error;
 * a missed delete would leave a removed record public, so one unproven op fails the whole frame.
 */
export function commitFrame(body: CommitBody, writes: readonly CommitEvt[]): RepoFrame | null {
  if (writes.length !== body.ops.length) return null;
  const changes = writes.map(
    (write): RecordChange =>
      write.event === "delete"
        ? { kind: "delete", collection: write.collection, rkey: write.rkey }
        : {
            kind: "put",
            collection: write.collection,
            rkey: write.rkey,
            cid: write.cid.toString(),
            record: recordToJson(write.record),
          },
  );
  const rev = changes.length === 0 ? null : body.rev;
  return { kind: "repoCommit", seq: body.seq, did: body.repo, rev, changes };
}
