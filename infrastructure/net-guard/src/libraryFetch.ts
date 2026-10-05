// The fetch shape for libraries that take a custom fetch (P1.18a): @atproto/oauth-client-node, identity resolvers.
// Built on the guarded request, so policy, pinning, the no-redirect rule and the decompression cap all apply; undici's
// own fetch would follow redirects and decompress by itself.
import { atproto, type Policy } from "./policies.ts";
import { type GuardedRequest, type GuardedResponse, type NetGuard, NULL_BODY_STATUSES } from "./request.ts";

export type FetchDefaults = { timeoutMs?: number; maxBytes?: number; accept?: readonly string[] };

function toResponse(result: GuardedResponse): Response {
  const headers = new Headers();
  for (const [name, value] of Object.entries(result.headers)) {
    // The body is already decoded and measured, so its encoding and length headers no longer describe it.
    if (name === "content-encoding" || name === "content-length") continue;
    for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
  }
  const body = NULL_BODY_STATUSES.has(result.status) ? null : result.body;
  return new Response(body as ConstructorParameters<typeof Response>[0], { status: result.status, headers });
}

/**
 * A WHATWG fetch through `guard`. The caller's `redirect` option is ignored: a redirect is always refused. The method,
 * headers (a `host` header included) and the 1 MiB body cap are checked by the guard, so each refusal is reported.
 */
export function guardedFetch(guard: NetGuard, policy: Policy, defaults: FetchDefaults = {}): typeof fetch {
  return async (input, init) => {
    const req = new Request(input, init);
    const headers: Record<string, string> = Object.fromEntries(req.headers);
    const options: GuardedRequest = {
      url: req.url,
      method: req.method as "GET" | "POST", // checked by the guard
      headers,
      signal: req.signal,
      ...(req.body ? { body: req.body } : {}),
      ...(defaults.timeoutMs ? { timeoutMs: defaults.timeoutMs } : {}),
      ...(defaults.maxBytes ? { maxBytes: defaults.maxBytes } : {}),
      ...(defaults.accept ? { accept: defaults.accept } : {}),
    };
    return toResponse(await guard.request(policy, options));
  };
}

/** The one fetch handed to atproto libraries (P2.04); our own PDS is reached through the guard's internal hosts. */
export const libraryFetch = (guard: NetGuard): typeof fetch =>
  guardedFetch(guard, atproto, { timeoutMs: 10_000, maxBytes: 1024 * 1024 });
