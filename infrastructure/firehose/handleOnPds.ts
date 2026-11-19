// Our PDS's own word on which account holds one of our hosted handles (book P3.08s; plan §5.2). Endpoint and output:
// https://docs.bsky.app/docs/api/com-atproto-identity-resolve-handle and the com.atproto.identity.resolveHandle
// lexicon (@atproto/api 0.30.3, dist/client/lexicons.js: required `handle`, output required `did`, error
// `HandleNotFound`).
//
// As repoStatus.ts: through net-guard to the one configured origin INDEXER_PDS_URL (ADR 0052 decision 2), never a URL
// from the network. Only an explicit HandleNotFound reads as `not_found`, because that answer clears a handle; every
// other failure is `unavailable` and changes nothing.
import { internalPolicy, type NetGuard } from "@unset/infrastructure-net-guard";

export type HandleOnPds =
  | { readonly kind: "did"; readonly did: string }
  | { readonly kind: "not_found" }
  | { readonly kind: "unavailable" };

export type HandleOnPdsReaderOptions = {
  /** INDEXER_PDS_URL: our PDS's internal origin, from config. */
  readonly service: URL;
  readonly guard: NetGuard;
  readonly timeoutMs: number;
};

export type HandleOnPdsReader = (handle: string, signal: AbortSignal) => Promise<HandleOnPds>;

const MAX_BYTES = 16 * 1024;
const UNAVAILABLE: HandleOnPds = { kind: "unavailable" };

export function createHandleOnPdsReader(options: HandleOnPdsReaderOptions): HandleOnPdsReader {
  const policy = internalPolicy("pds-internal", [options.service.origin]);
  return async (handle, signal) => {
    const url = new URL("/xrpc/com.atproto.identity.resolveHandle", options.service);
    url.searchParams.set("handle", handle);
    try {
      const response = await options.guard.request(policy, {
        url: url.href,
        accept: ["application/json"],
        timeoutMs: options.timeoutMs,
        maxBytes: MAX_BYTES,
        signal,
      });
      const body = parseJson(response.body);
      if (response.status === 400) return errorName(body) === "HandleNotFound" ? { kind: "not_found" } : UNAVAILABLE;
      return response.status === 200 ? didOf(body) : UNAVAILABLE;
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

/** A DID the answer names, in the did:method:id shape; anything else is no answer. */
function didOf(body: unknown): HandleOnPds {
  const did = typeof body === "object" && body !== null ? (body as { did?: unknown }).did : undefined;
  return typeof did === "string" && /^did:[a-z]+:[A-Za-z0-9._:%-]{1,2048}$/.test(did)
    ? { kind: "did", did }
    : UNAVAILABLE;
}
