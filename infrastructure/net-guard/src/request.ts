// Guarded outbound requests (P1.18a). Every caller-influenced HTTP request names a policy, connects only to
// addresses vetted by resolveVetted, never follows a redirect, and is capped in time, bytes and decompressed bytes.
import { isIP } from "node:net";
import { pipeline, type Readable, Transform } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { Agent, buildConnector, type Dispatcher, request as undiciRequest } from "undici";
import { classifyAddress, isInternalName, normaliseHost } from "./classify.ts";
import type { Policy } from "./policies.ts";
import { type LookupAnswer, type NetGuardCode, NetGuardError, pinnedLookup, resolveVetted } from "./resolve.ts";

/** What the composition root passes in (parsed by shared/config netGuardFields, plus wiring). */
export type NetGuardSettings = {
  readonly internalHosts: readonly string[];
  readonly allowLoopback: boolean;
  /** Build commit, sent as `user-agent: unset.sh/<commit>`. */
  readonly commit: string;
  /** Trusted CA certificates (PEM). When set they replace Node's default trust store; when absent it is used. */
  readonly ca?: string | readonly string[];
  /** Called once per request. It never receives the host, URL or address, so none can reach a log. */
  readonly onRequest?: (event: EgressEvent) => void;
};

/** The one log line per request (SE-7 allowlist: event, dep, status, ms, counts, code). */
export type EgressEvent = {
  readonly event: "egress.request";
  /** The policy's name ("plc", "atproto"): which dependency was called, never which host. */
  readonly dep: string;
  readonly status: number | null;
  readonly ms: number;
  readonly counts: { readonly bytes: number };
  /** Why it failed; `egress.invalid` is a malformed request, thrown as a TypeError or RangeError. */
  readonly code?: NetGuardCode | "egress.invalid";
};

export type GuardedRequest = {
  url: string;
  method?: "GET" | "POST";
  /** Sent with keys lowercased. A `host` header is refused; `user-agent` and `accept-encoding` are always ours. */
  headers?: Record<string, string>;
  /** At most 1 MiB; a stream is read into memory first. */
  body?: Uint8Array | AsyncIterable<Uint8Array>;
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
const MAX_REQUEST_BODY = 1024 * 1024;
const DNS_TIMEOUT_MS = 3_000;
const CONNECT_TIMEOUT_MS = 5_000;
const ACCEPT_ENCODING = "gzip, br, identity";
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
/** Statuses that never carry a body (WHATWG Fetch "null body status"). */
export const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([101, 204, 205, 304]);

type Limits = { timeoutMs: number; maxBytes: number };
type Seen = { status: number | null; bytes: number };
type Target = { host: string; allow: "public" | "private"; loopbackOnly: boolean };

/** Method and limits: a bad value is the caller's programming error, not an egress failure. */
function checkRequest(req: GuardedRequest): Limits {
  const method: string = req.method ?? "GET";
  if (method !== "GET" && method !== "POST") throw new TypeError(`net-guard does not send ${method}`);
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

/**
 * The caller's headers with keys lowercased, then ours, which win: the user agent names us, and we decode only what
 * we advertise. A caller `host` header is refused, in any case: undici (8.11.2, lib/core/request.js processHeader)
 * would send it as Host and take the TLS server name from it, so the certificate would be checked against it.
 */
function requestHeaders(headers: Record<string, string> = {}, commit: string): Record<string, string> {
  const lowered = Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value] as const);
  if (lowered.some(([name]) => name === "host")) throw new TypeError("net-guard does not take a host header");
  return { ...Object.fromEntries(lowered), "accept-encoding": ACCEPT_ENCODING, "user-agent": `unset.sh/${commit}` };
}

const isLoopbackTarget = (host: string): boolean => host === "localhost" || classifyAddress(host) === "loopback";

/** Step 1: an absolute http(s) URL without credentials. */
function parseTarget(raw: string): URL {
  if (!URL.canParse(raw)) throw new NetGuardError("egress.scheme");
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new NetGuardError("egress.scheme");
  if (url.username !== "" || url.password !== "") throw new NetGuardError("egress.scheme");
  return url;
}

/** Steps 1 to 3: scheme, port and policy, before any DNS. The dev loopback flag never widens a fixed policy. */
function checkTarget(policy: Policy, raw: string, settings: NetGuardSettings): Target {
  const url = parseTarget(raw);
  const host = normaliseHost(url.hostname);
  if (policy.kind === "internal") {
    if (!policy.origins.includes(url.origin)) throw new NetGuardError("egress.host_not_allowed");
    return { host, allow: "private", loopbackOnly: false };
  }
  const devLoopback = settings.allowLoopback && isLoopbackTarget(host);
  if (url.protocol !== "https:" && !devLoopback) throw new NetGuardError("egress.scheme");
  if (url.port !== "" && url.port !== "443" && !devLoopback) throw new NetGuardError("egress.port");
  if (policy.kind === "fixed" && !policy.hosts.includes(host)) throw new NetGuardError("egress.host_not_allowed");
  if (devLoopback) return { host, allow: "private", loopbackOnly: true };
  if (policy.kind === "fixed") return { host, allow: "public", loopbackOnly: false };
  if (settings.internalHosts.includes(host)) return { host, allow: "private", loopbackOnly: false };
  if (isInternalName(host)) throw new NetGuardError("egress.internal_name");
  return { host, allow: "public", loopbackOnly: false };
}

/** The request body in memory, refused past 1 MiB; a stream stops being read once the deadline passes. */
async function bufferBody(body: GuardedRequest["body"], signal: AbortSignal): Promise<Uint8Array | undefined> {
  if (body === undefined || body instanceof Uint8Array) {
    if ((body?.length ?? 0) > MAX_REQUEST_BODY) throw new NetGuardError("egress.too_large");
    return body;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of body) {
    if (signal.aborted) throw new NetGuardError("egress.timeout");
    total += chunk.length;
    if (total > MAX_REQUEST_BODY) throw new NetGuardError("egress.too_large");
    chunks.push(chunk);
  }
  return new Uint8Array(Buffer.concat(chunks));
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

/** zlib (`Z_DATA_ERROR`, `Z_BUF_ERROR`) and brotli (`ERR__ERROR_FORMAT_…`) decode failures. */
const isDecodeError = (error: unknown): boolean =>
  /^(Z_|ERR__ERROR_)/.test(String((error as { code?: unknown } | null)?.code ?? ""));

/** Drops a body we will not read; the abort it causes is expected, not an unhandled error. */
function discard(body: Readable): void {
  body.on("error", () => undefined);
  body.destroy();
}

function refuse(body: Readable, code: NetGuardCode): never {
  discard(body);
  throw new NetGuardError(code);
}

/** Passes bytes through, failing with `egress.too_large` once more than `maxBytes` raw (encoded) bytes arrive. */
function rawCap(maxBytes: number): Transform {
  let total = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      total += chunk.length;
      done(total > maxBytes ? new NetGuardError("egress.too_large") : null, chunk);
    },
  });
}

async function collect(source: AsyncIterable<Buffer>, maxBytes: number, stop: () => void): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of source) {
    total += chunk.length;
    if (total > maxBytes) {
      stop();
      throw new NetGuardError("egress.too_large");
    }
    chunks.push(chunk);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

/**
 * Steps 9 and 10: the body under the cap, counted both as it arrives and as it decodes, so neither a bomb nor an
 * endless run of empty compressed members gets past it. A corrupt encoding is `egress.encoding`.
 */
async function readCapped(body: Readable, encoding: string, maxBytes: number): Promise<Uint8Array> {
  const decoder = decoderFor(encoding);
  if (decoder === null) return collect(body, maxBytes, () => discard(body));
  const decoded = pipeline(body, rawCap(maxBytes), decoder, () => undefined); // errors reach the iterator
  try {
    return await collect(decoded, maxBytes, () => decoded.destroy());
  } catch (error) {
    throw isDecodeError(error) ? new NetGuardError("egress.encoding") : error;
  }
}

/** The response checks, in order, then the body. A status outside 200 to 599 is not a final HTTP response. */
async function readBody(response: Dispatcher.ResponseData, req: GuardedRequest, maxBytes: number) {
  const { statusCode: status, headers, body } = response;
  if (status < 200 || status > 599) refuse(body, "egress.connect");
  if (REDIRECTS.has(status)) refuse(body, "egress.redirect"); // never followed: the caller decides
  if (NULL_BODY_STATUSES.has(status) || headers["content-length"] === "0") {
    discard(body); // nothing to type-check or decode, whatever content-encoding claims
    return new Uint8Array();
  }
  if (req.accept && !req.accept.includes(mediaType(headers["content-type"]))) refuse(body, "egress.content_type");
  if (Number(headers["content-length"] ?? 0) > maxBytes) refuse(body, "egress.too_large");
  const encoding = String(headers["content-encoding"] ?? "")
    .trim()
    .toLowerCase();
  return readCapped(body, encoding, maxBytes);
}

/** A socket or TLS failure as a NetGuardError; an abort (deadline or caller) is `egress.timeout`, during DNS too. */
function egressError(error: unknown, signal: AbortSignal): NetGuardError {
  const isGuardError = error instanceof NetGuardError;
  if (signal.aborted && (!isGuardError || error.code === "egress.dns_timeout")) {
    return new NetGuardError("egress.timeout");
  }
  if (isGuardError) return error;
  const code = String((error as { code?: unknown; cause?: { code?: unknown } })?.code ?? "");
  const cause = String((error as { cause?: { code?: unknown } })?.cause?.code ?? "");
  return /CERT|SSL|TLS|SIGNATURE|DEPTH_ZERO|ISSUER/.test(`${code} ${cause}`)
    ? new NetGuardError("egress.tls")
    : new NetGuardError("egress.connect");
}

/**
 * The connector: pinned lookup, connect timeout, and the server name the certificate is checked against. An IP
 * literal gets no server name (RFC 6066 §3 forbids one; Node refuses it), so its certificate must name the address.
 * undici 8.11.2 has no typed per-request server name; this one applies because no host header reaches undici
 * (lib/core/connect.js:77 prefers the request's, derived from that header).
 */
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
    timeout: Math.min(CONNECT_TIMEOUT_MS, timeoutMs),
    ...(isIP(host) === 0 ? { servername: host } : {}),
    ...(settings.ca === undefined ? {} : { ca: settings.ca as string | string[] }),
  });
  return (options: Parameters<typeof base>[0], callback: Parameters<typeof base>[1]) =>
    base(hooks.port === undefined ? options : { ...options, port: String(hooks.port) }, callback);
}

type Prepared = { limits: Limits; headers: Record<string, string>; body: Uint8Array | undefined };

/** Steps 4 to 10 for one vetted target. */
async function exchange(
  target: Target,
  req: GuardedRequest,
  prepared: Prepared,
  signal: AbortSignal,
  settings: NetGuardSettings,
  hooks: NetGuardHooks,
  seen: Seen,
): Promise<GuardedResponse> {
  const { limits } = prepared;
  const addresses = await resolveVetted(
    target.host,
    { allow: target.allow },
    {
      timeoutMs: Math.min(DNS_TIMEOUT_MS, limits.timeoutMs),
      signal,
      ...(hooks.lookup ? { lookup: hooks.lookup } : {}),
    },
  );
  if (target.loopbackOnly && !addresses.every((a) => classifyAddress(a) === "loopback")) {
    throw new NetGuardError("egress.private_address");
  }
  const agent = new Agent({ connect: connectorFor(addresses, target.host, limits.timeoutMs, settings, hooks) });
  try {
    const response = await undiciRequest(req.url, {
      dispatcher: agent,
      method: req.method ?? "GET",
      headers: prepared.headers,
      ...(prepared.body ? { body: prepared.body } : {}),
      signal,
    });
    seen.status = response.statusCode;
    const body = await readBody(response, req, limits.maxBytes);
    seen.bytes = body.length;
    return { status: response.statusCode, headers: response.headers as GuardedResponse["headers"], body };
  } finally {
    await agent.destroy().catch(() => undefined);
  }
}

/** Every step in order: the request's own checks, then target, body and exchange under one deadline. */
async function guarded(
  policy: Policy,
  req: GuardedRequest,
  settings: NetGuardSettings,
  hooks: NetGuardHooks,
  seen: Seen,
): Promise<GuardedResponse> {
  const limits = checkRequest(req);
  const headers = requestHeaders(req.headers, settings.commit);
  const deadline = AbortSignal.timeout(limits.timeoutMs);
  const signal = req.signal ? AbortSignal.any([deadline, req.signal]) : deadline;
  try {
    if (signal.aborted) throw new NetGuardError("egress.timeout"); // before any DNS lookup
    const target = checkTarget(policy, req.url, settings);
    const body = await bufferBody(req.body, signal);
    return await exchange(target, req, { limits, headers, body }, signal, settings, hooks, seen);
  } catch (error) {
    throw egressError(error, signal);
  }
}

function report(settings: NetGuardSettings, event: EgressEvent): void {
  try {
    settings.onRequest?.(event);
  } catch {
    // DC-4 exception: a failing log callback must not change the egress outcome, and there is nowhere left to
    // report it from here without risking the target reaching a log.
  }
}

/** The guard with test seams; production code uses `createNetGuard`. */
export function createNetGuardWith(settings: NetGuardSettings, hooks: NetGuardHooks) {
  const request = async (policy: Policy, req: GuardedRequest): Promise<GuardedResponse> => {
    const started = performance.now();
    const seen: Seen = { status: null, bytes: 0 };
    let code: EgressEvent["code"];
    try {
      return await guarded(policy, req, settings, hooks, seen);
    } catch (error) {
      code = error instanceof NetGuardError ? error.code : "egress.invalid";
      throw error;
    } finally {
      const ms = Math.round(performance.now() - started);
      const event = {
        event: "egress.request",
        dep: policy.name,
        status: seen.status,
        ms,
        counts: { bytes: seen.bytes },
      } as const;
      report(settings, code === undefined ? event : { ...event, code });
    }
  };
  return { request };
}

export type NetGuard = ReturnType<typeof createNetGuardWith>;

export const createNetGuard = (settings: NetGuardSettings): NetGuard => createNetGuardWith(settings, {});
