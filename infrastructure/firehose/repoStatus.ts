// Our PDS's own word on whether it hosts an account (book P3.06s; plan §5.2: a change to active, or `deleted`, from
// the stream is only a trigger, confirmed against the account's PDS). Endpoint and output:
// https://docs.bsky.app/docs/api/com-atproto-sync-get-repo-status and the com.atproto.sync.getRepoStatus lexicon
// (@atproto/api 0.30.3, dist/client/lexicons.js: required `did` and `active`, optional `status` and `rev`, error
// `RepoNotFound`).
//
// The request goes through net-guard to the one configured origin INDEXER_PDS_URL (ADR 0052 decision 2), as the
// backfill's getRepo does. Only an explicit RepoNotFound reads as `not_found`, because that answer leads towards
// deletion; every other failure, and any answer that is not about this DID, is `unavailable` and changes nothing.
import { internalPolicy, type NetGuard } from "@unset/infrastructure-net-guard";

export type RepoStatus =
  | { readonly kind: "active" }
  | { readonly kind: "inactive"; readonly status: string | null }
  | { readonly kind: "not_found" }
  | { readonly kind: "unavailable" };

export type RepoStatusReaderOptions = {
  /** INDEXER_PDS_URL: our PDS's internal origin, from config. */
  readonly service: URL;
  readonly guard: NetGuard;
  readonly timeoutMs: number;
};

export type RepoStatusReader = (did: string, signal: AbortSignal) => Promise<RepoStatus>;

const MAX_BYTES = 16 * 1024;
const UNAVAILABLE: RepoStatus = { kind: "unavailable" };

export function createRepoStatusReader(options: RepoStatusReaderOptions): RepoStatusReader {
  const policy = internalPolicy("pds-internal", [options.service.origin]);
  return async (did, signal) => {
    const url = new URL("/xrpc/com.atproto.sync.getRepoStatus", options.service);
    url.searchParams.set("did", did);
    try {
      const response = await options.guard.request(policy, {
        url: url.href,
        accept: ["application/json"],
        timeoutMs: options.timeoutMs,
        maxBytes: MAX_BYTES,
        signal,
      });
      const body = parseJson(response.body);
      if (response.status === 400) return errorName(body) === "RepoNotFound" ? { kind: "not_found" } : UNAVAILABLE;
      return response.status === 200 ? statusOf(body, did) : UNAVAILABLE;
    } catch {
      return UNAVAILABLE;
    }
  };
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
}

function errorName(body: unknown): unknown {
  return typeof body === "object" && body !== null ? (body as { error?: unknown }).error : undefined;
}

function statusOf(body: unknown, did: string): RepoStatus {
  if (typeof body !== "object" || body === null) return UNAVAILABLE;
  const { did: answeredFor, active, status } = body as { did?: unknown; active?: unknown; status?: unknown };
  if (answeredFor !== did || typeof active !== "boolean") return UNAVAILABLE;
  if (active) return { kind: "active" };
  if (status !== undefined && typeof status !== "string") return UNAVAILABLE;
  return { kind: "inactive", status: status ?? null };
}
