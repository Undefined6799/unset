// The fetch shape for libraries that take a custom fetch (P1.18a): @atproto/oauth-client-node, identity resolvers.
// Built on the guarded request, so policy, pinning, the no-redirect rule and the decompression cap all apply; undici's
// own fetch would follow redirects and decompress by itself.
import { atproto, atprotoBlobUpload, OBJECT_STORE_BYTES, objectStore, type Policy } from "./policies.ts";
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
 * headers (a `host` header included) and the policy's body cap are checked by the guard, so each refusal is reported.
 */
export function guardedFetch(guard: NetGuard, policy: Policy, defaults: FetchDefaults = {}): typeof fetch {
  return async (input, init) => {
    const req = new Request(input, init);
    const headers: Record<string, string> = Object.fromEntries(req.headers);
    const options: GuardedRequest = {
      url: req.url,
      method: req.method as "GET" | "POST" | "PUT", // checked by the guard
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

/** The one call that sends a member's picture to their PDS (https://atproto.com/specs/xrpc; ADR 0070 point 8). */
const BLOB_UPLOAD_PATH = "/xrpc/com.atproto.repo.uploadBlob";

/**
 * The one fetch handed to atproto libraries (P2.04); our own PDS is reached through the guard's internal hosts. A POST
 * to uploadBlob goes under atprotoBlobUpload, whose body may reach 5 MiB; every other request keeps atproto's 1 MiB.
 */
export function libraryFetch(guard: NetGuard): typeof fetch {
  const defaults = { timeoutMs: 10_000, maxBytes: 1024 * 1024 };
  const plain = guardedFetch(guard, atproto, defaults);
  const upload = guardedFetch(guard, atprotoBlobUpload, defaults);
  return (input, init) => {
    const req = new Request(input, init);
    return req.method === "POST" && URL.canParse(req.url) && new URL(req.url).pathname === BLOB_UPLOAD_PATH
      ? upload(req)
      : plain(req);
  };
}

/**
 * The one fetch a process reaches the object store with (ADR 0088): its policy, and an answer cap equal to its put cap,
 * so a version that could be stored can be read back. Without it the guard's default 1 MiB answer cap applied, and
 * a main version past 1,048,576 bytes failed at web's publish step.
 */
export function objectStoreFetch(guard: NetGuard, origin: string, timeoutMs?: number): typeof fetch {
  return guardedFetch(guard, objectStore(origin), {
    maxBytes: OBJECT_STORE_BYTES,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
}
