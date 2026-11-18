// A newly tracked account's records, read once from our PDS's com.atproto.sync.getRepo and checked before any of
// them is written (ADR 0052 decision 5, book P3.05s). The repo's commit signature is verified against the account's
// signing key, its MST is walked from the signed root, and every block's CID is checked against its bytes
// (@atproto/repo 0.11.5: `readCarWithRoot` verifies each block's CID, `verifyRepoCar` loads the tree from the root
// and checks the DID and `verifyCommitSig`, dist/car.js and dist/sync/consumer.js). Endpoint:
// https://docs.bsky.app/docs/api/com-atproto-sync-get-repo; repository format: https://atproto.com/specs/repository.
//
// The request goes through net-guard to one exact internal origin, the configured INDEXER_PDS_URL, never a URL from
// the network (ADR 0052 decision 2).
import { cborToLexRecord, verifyRepoCar } from "@atproto/repo";
import { internalPolicy, type NetGuard } from "@unset/infrastructure-net-guard";
import { recordToJson } from "@unset/shared-lexicons";
import type { RecordChange } from "./frames.ts";

/** One account's records at one signed rev, in the collections asked for. */
export type RepoSnapshot = {
  readonly rev: string;
  readonly records: readonly Extract<RecordChange, { kind: "put" }>[];
};

export type RepoReaderOptions = {
  /** INDEXER_PDS_URL: our PDS's internal origin, from config. */
  readonly service: URL;
  readonly guard: NetGuard;
  /** As the stream reader's: the DID's atproto signing key as a `did:key`, `fresh` bypassing any cache. */
  readonly signingKey: (did: string, options: { readonly fresh: boolean }) => Promise<string>;
  /** The collections to return; the rest of the repo is verified but not decoded. */
  readonly collections: readonly string[];
  readonly timeoutMs: number;
  /** The largest repo accepted, in bytes (net-guard allows at most 64 MiB). */
  readonly maxBytes: number;
};

/** Why a repo could not be read. None carries a DID or content (rule SE-7). */
export type RepoFailure = "not_found" | "unavailable" | "unverified";

export class RepoReadError extends Error {
  readonly reason: RepoFailure;
  constructor(reason: RepoFailure, cause?: unknown) {
    super(`repo read failed: ${reason}`, { cause });
    this.name = "RepoReadError";
    this.reason = reason;
  }
}

export type RepoReader = (did: string, signal: AbortSignal) => Promise<RepoSnapshot>;

export function createRepoReader(options: RepoReaderOptions): RepoReader {
  const policy = internalPolicy("pds-internal", [options.service.origin]);
  return async (did, signal) => {
    const url = new URL("/xrpc/com.atproto.sync.getRepo", options.service);
    url.searchParams.set("did", did);
    const response = await options.guard
      .request(policy, {
        url: url.href,
        accept: ["application/vnd.ipld.car"],
        timeoutMs: options.timeoutMs,
        maxBytes: options.maxBytes,
        signal,
      })
      .catch((error: unknown) => {
        throw new RepoReadError("unavailable", error);
      });
    // The lexicon answers an unknown or unavailable repo with 400 (RepoNotFound, RepoTakendown, RepoDeactivated...).
    if (response.status === 400 || response.status === 404) throw new RepoReadError("not_found");
    if (response.status !== 200) throw new RepoReadError("unavailable");
    return snapshotOf(await verified(options, did, response.body), options.collections);
  };
}

/** Verifies with the cached key, then once with a fresh one in case the key rotated, as the stream reader does. */
async function verified(options: RepoReaderOptions, did: string, car: Uint8Array) {
  let first: unknown;
  for (const fresh of [false, true]) {
    try {
      return await verifyRepoCar(car, did, await options.signingKey(did, { fresh }));
    } catch (error) {
      first ??= error;
    }
  }
  throw new RepoReadError("unverified", first);
}

function snapshotOf(repo: Awaited<ReturnType<typeof verifyRepoCar>>, collections: readonly string[]): RepoSnapshot {
  const records = repo.creates
    .filter((create) => collections.includes(create.collection))
    .map((create) => {
      // verifyRepo refuses a repo whose leaves are missing, so each create's block is present and its CID checked.
      const bytes = repo.commit.newBlocks.get(create.cid);
      if (bytes === undefined) throw new RepoReadError("unverified");
      return {
        kind: "put" as const,
        collection: create.collection,
        rkey: create.rkey,
        cid: create.cid.toString(),
        record: recordToJson(cborToLexRecord(bytes)),
      };
    });
  return { rev: repo.commit.rev, records };
}
