// The fetch shape for libraries that take a custom fetch (P1.18a): @atproto/oauth-client-node, identity resolvers.
// Built on the guarded request, so policy, pinning, the no-redirect rule and the decompression cap all apply; undici's
// own fetch would follow redirects and decompress by itself.
import { atproto, type Policy } from "./policies.ts";
import type { GuardedRequest, GuardedResponse, NetGuard } from "./request.ts";

export type FetchDefaults = { timeoutMs?: number; maxBytes?: number; accept?: readonly string[] };

import { NetGuardError } from "./resolve.ts";

const MAX_REQUEST_BODY = 1024 * 1024;
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

/** A request body read into memory, refused past 1 MiB (a ReadableStream body included). */
async function bufferBody(request: Request): Promise<Uint8Array | undefined> {
  if (request.body === null) return undefined;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of request.body) {
    total += chunk.length;
    if (total > MAX_REQUEST_BODY) throw new NetGuardError("egress.too_large");
    chunks.push(chunk);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

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

/** A WHATWG fetch through `guard`. The caller's `redirect` option is ignored: a redirect is always refused. */
export function guardedFetch(guard: NetGuard, policy: Policy, defaults: FetchDefaults = {}): typeof fetch {
  return async (input, init) => {
    const req = new Request(input, init);
    if (req.method !== "GET" && req.method !== "POST") throw new TypeError(`net-guard does not send ${req.method}`);
    const headers: Record<string, string> = {};
    req.headers.forEach((value, name) => {
      headers[name] = value;
    });
    const body = await bufferBody(req);
    const options: GuardedRequest = {
      url: req.url,
      method: req.method,
      headers,
      signal: req.signal,
      ...(body ? { body } : {}),
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
