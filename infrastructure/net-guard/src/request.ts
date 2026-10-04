// Guarded outbound requests (P1.18a). Every caller-influenced HTTP request names a policy, connects only to
// addresses vetted by resolveVetted, never follows a redirect, and is capped in time, bytes and decompressed bytes.
import type { Readable, Transform } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { Agent, buildConnector, request as undiciRequest } from "undici";
import { classifyAddress, isInternalName, normaliseHost } from "./classify.ts";
import type { Policy } from "./policies.ts";
import { type LookupAnswer, NetGuardError, pinnedLookup, resolveVetted } from "./resolve.ts";

/** What the composition root passes in (parsed by shared/config netGuardFields, plus wiring). */
export type NetGuardSettings = {
  readonly internalHosts: readonly string[];
  readonly allowLoopback: boolean;
  /** Build commit, sent as `user-agent: unset.sh/<commit>`. */
  readonly commit: string;
  /** Extra trusted CA certificates (PEM); the system store is used when absent. */
  readonly ca?: string | readonly string[];
  /** Called once per request. It never receives the host, URL or address, so none can reach a log. */
  readonly onRequest?: (event: EgressEvent) => void;
};

export type EgressEvent = {
  policy: string;
  status: number | null;
  ms: number;
  bytes: number;
  code?: NetGuardError["code"];
};

export type GuardedRequest = {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: Uint8Array;
  timeoutMs?: number;
  maxBytes?: number;
  accept?: readonly string[];
  signal?: AbortSignal;
};

export type GuardedResponse = { status: number; headers: Record<string, string | string[]>; body: Uint8Array };

/** Test seams, not exported from the package: the resolver stub and where sockets land. Vetting still runs. */
export type NetGuardHooks = {
  lookup?: (host: string) => Promise<LookupAnswer>;
  lookupFor?: (addresses: readonly string[]) => unknown;
  port?: number;
};

const MAX_TIMEOUT_MS = 30_000;
const MAX_BYTES = 64 * 1024 * 1024;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

type Target = { host: string; allow: "public" | "private"; loopbackOnly: boolean };

const isLoopbackTarget = (host: string): boolean => host === "localhost" || classifyAddress(host) === "loopback";

/** Steps 1 to 3: scheme, port and policy, before any DNS. */
function checkTarget(policy: Policy, raw: string, settings: NetGuardSettings): Target {
  if (!URL.canParse(raw)) throw new NetGuardError("egress.scheme");
  const url = new URL(raw);
  if (url.username !== "" || url.password !== "") throw new NetGuardError("egress.scheme");
  const host = normaliseHost(url.hostname);
  if (policy.kind === "internal") {
    if (!policy.origins.includes(url.origin)) throw new NetGuardError("egress.host_not_allowed");
    return { host, allow: "private", loopbackOnly: false };
  }
  const devLoopback = settings.allowLoopback && isLoopbackTarget(host);
  if (url.protocol !== "https:" && !(devLoopback && url.protocol === "http:")) throw new NetGuardError("egress.scheme");
  if (url.port !== "" && url.port !== "443" && !devLoopback) throw new NetGuardError("egress.port");
  if (devLoopback) return { host, allow: "private", loopbackOnly: true };
  if (policy.kind === "fixed") {
    if (!policy.hosts.includes(host)) throw new NetGuardError("egress.host_not_allowed");
    return { host, allow: "public", loopbackOnly: false };
  }
  if (settings.internalHosts.includes(host)) return { host, allow: "private", loopbackOnly: false };
  if (isInternalName(host)) throw new NetGuardError("egress.internal_name");
  return { host, allow: "public", loopbackOnly: false };
}

/** The media type of a content-type header, lowercase, without parameters. */
const mediaType = (value: string | string[] | undefined): string =>
  String(Array.isArray(value) ? value[0] : (value ?? ""))
    .split(";")[0]
    ?.trim()
    .toLowerCase() ?? "";

function decoderFor(encoding: string): Transform | null {
  if (encoding === "" || encoding === "identity") return null;
  if (encoding === "gzip" || encoding === "x-gzip") return createGunzip();
  if (encoding === "deflate") return createInflate();
  if (encoding === "br") return createBrotliDecompress();
  throw new NetGuardError("egress.encoding");
}

/** Drops a body we will not read; the abort it causes is expected, not an unhandled error. */
function discard(body: Readable): void {
  body.on("error", () => undefined);
  body.destroy();
}

/** Steps 9 and 10: the body, decoded under the same cap as the raw bytes. */
async function readCapped(body: Readable, encoding: string, maxBytes: number): Promise<Uint8Array> {
  const decoder = decoderFor(encoding);
  const source: AsyncIterable<Buffer> = decoder ? body.pipe(decoder) : body;
  if (decoder) body.on("error", (error) => decoder.destroy(error));
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of source) {
    total += chunk.length;
    if (total > maxBytes) {
      discard(body);
      decoder?.destroy();
      throw new NetGuardError("egress.too_large");
    }
    chunks.push(chunk);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

/** A socket or TLS failure as a NetGuardError; an abort (deadline or caller) is `egress.timeout`. */
function egressError(error: unknown, signal: AbortSignal): NetGuardError {
  if (error instanceof NetGuardError) return error;
  if (signal.aborted) return new NetGuardError("egress.timeout");
  const code = String((error as { code?: unknown; cause?: { code?: unknown } })?.code ?? "");
  const cause = String((error as { cause?: { code?: unknown } })?.cause?.code ?? "");
  return /CERT|SSL|TLS|SIGNATURE|DEPTH_ZERO|ISSUER/.test(`${code} ${cause}`)
    ? new NetGuardError("egress.tls")
    : new NetGuardError("egress.connect");
}

function checkLimits(req: GuardedRequest): { timeoutMs: number; maxBytes: number } {
  const timeoutMs = req.timeoutMs ?? 10_000;
  const maxBytes = req.maxBytes ?? 1024 * 1024;
  if (!(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= MAX_TIMEOUT_MS)) {
    throw new RangeError("timeoutMs must be an integer in (0, 30000]");
  }
  if (!(Number.isInteger(maxBytes) && maxBytes > 0 && maxBytes <= MAX_BYTES)) {
    throw new RangeError("maxBytes must be an integer in (0, 64 MiB]");
  }
  return { timeoutMs, maxBytes };
}

function connectorFor(
  addresses: readonly string[],
  host: string,
  timeoutMs: number,
  settings: NetGuardSettings,
  hooks: NetGuardHooks,
) {
  const lookup = (hooks.lookupFor ?? pinnedLookup)(addresses);
  const base = buildConnector({
    lookup: lookup as never,
    timeout: Math.min(5_000, timeoutMs),
    servername: host, // the certificate is checked against the name, never the address
    ...(settings.ca === undefined ? {} : { ca: settings.ca as string | string[] }),
  });
  return (options: Parameters<typeof base>[0], callback: Parameters<typeof base>[1]) =>
    base(hooks.port === undefined ? options : { ...options, port: String(hooks.port) }, callback);
}

/** Steps 4 to 10 for one vetted target. */
async function exchange(
  target: Target,
  req: GuardedRequest,
  limits: { timeoutMs: number; maxBytes: number },
  signal: AbortSignal,
  settings: NetGuardSettings,
  hooks: NetGuardHooks,
  seen: { status: number | null; bytes: number },
): Promise<GuardedResponse> {
  const addresses = await resolveVetted(
    target.host,
    { allow: target.allow },
    { timeoutMs: Math.min(3_000, limits.timeoutMs), signal, ...(hooks.lookup ? { lookup: hooks.lookup } : {}) },
  );
  if (target.loopbackOnly && !addresses.every((a) => classifyAddress(a) === "loopback")) {
    throw new NetGuardError("egress.private_address");
  }
  const agent = new Agent({ connect: connectorFor(addresses, target.host, limits.timeoutMs, settings, hooks) });
  try {
    const response = await undiciRequest(req.url, {
      dispatcher: agent,
      method: req.method ?? "GET",
      headers: { ...req.headers, "accept-encoding": "gzip, br, identity", "user-agent": `unset.sh/${settings.commit}` },
      ...(req.body ? { body: req.body } : {}),
      signal,
    });
    seen.status = response.statusCode;
    if (REDIRECTS.has(response.statusCode)) {
      discard(response.body);
      throw new NetGuardError("egress.redirect"); // never followed: the caller decides
    }
    if (req.accept && !req.accept.includes(mediaType(response.headers["content-type"]))) {
      discard(response.body);
      throw new NetGuardError("egress.content_type");
    }
    if (Number(response.headers["content-length"] ?? 0) > limits.maxBytes) {
      discard(response.body);
      throw new NetGuardError("egress.too_large");
    }
    const encoding = String(response.headers["content-encoding"] ?? "")
      .trim()
      .toLowerCase();
    const body = await readCapped(response.body, encoding, limits.maxBytes);
    seen.bytes = body.length;
    return { status: response.statusCode, headers: response.headers as GuardedResponse["headers"], body };
  } finally {
    await agent.destroy().catch(() => undefined);
  }
}

/** The guard with test seams; production code uses `createNetGuard`. */
export function createNetGuardWith(settings: NetGuardSettings, hooks: NetGuardHooks) {
  const request = async (policy: Policy, req: GuardedRequest): Promise<GuardedResponse> => {
    const started = performance.now();
    const seen: { status: number | null; bytes: number } = { status: null, bytes: 0 };
    let code: NetGuardError["code"] | undefined;
    const limits = checkLimits(req);
    const deadline = AbortSignal.timeout(limits.timeoutMs);
    const signal = req.signal ? AbortSignal.any([deadline, req.signal]) : deadline;
    try {
      if (signal.aborted) throw new NetGuardError("egress.timeout"); // before any DNS lookup
      return await exchange(checkTarget(policy, req.url, settings), req, limits, signal, settings, hooks, seen);
    } catch (error) {
      const failure = egressError(error, signal);
      code = failure.code;
      throw failure;
    } finally {
      const event: EgressEvent = {
        policy: policy.name,
        status: seen.status,
        ms: Math.round(performance.now() - started),
        bytes: seen.bytes,
      };
      settings.onRequest?.(code === undefined ? event : { ...event, code });
    }
  };
  return { request };
}

export type NetGuard = ReturnType<typeof createNetGuardWith>;

export const createNetGuard = (settings: NetGuardSettings): NetGuard => createNetGuardWith(settings, {});
