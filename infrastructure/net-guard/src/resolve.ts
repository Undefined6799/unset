// Resolve once, vet every answer, pin the connection (P1.18). A check alone loses to DNS rebinding: the socket layer
// gets `pinnedLookup`, which only ever hands back the addresses vetted here. Public names resolve on c-ares, off the
// libuv threadpool, and tell "no such name" apart (P2.01m, ADR 0013); private names keep `dns.lookup`, which reads
// /etc/hosts. Node v26.10.0 doc/api/dns.md: "Implementation considerations", `Resolver([options])`, "Error codes".
import { lookup as dnsLookup, NODATA, NOTFOUND, Resolver } from "node:dns/promises";
import { isIP } from "node:net";
import { classifyAddress, isTranslatedIpv6, normaliseHost } from "./classify.ts";

export type NetGuardCode =
  | "egress.scheme"
  | "egress.port"
  | "egress.host_not_allowed"
  | "egress.internal_name"
  | "egress.private_address"
  | "egress.dns_failed"
  | "egress.dns_no_record"
  | "egress.dns_timeout"
  | "egress.connect"
  | "egress.tls"
  | "egress.timeout"
  | "egress.too_large"
  | "egress.redirect"
  | "egress.encoding"
  | "egress.content_type";

/** A refused or failed egress. The message is the code only: a host or URL can name a user's PDS or DID. */
export class NetGuardError extends Error {
  readonly code: NetGuardCode;
  constructor(code: NetGuardCode) {
    super(code);
    this.name = "NetGuardError";
    this.code = code;
  }
}

export type LookupAnswer = readonly { address: string; family: number }[];
/** The part of a `node:dns/promises` Resolver used for public names; tests pass a stub. */
export type AddressResolver = {
  resolve4(name: string): Promise<string[]>;
  resolve6(name: string): Promise<string[]>;
  cancel(): void;
};
type ResolverOptions = { timeout: number; tries: number; maxTimeout: number };
export type ResolveOptions = {
  /** Milliseconds before `egress.dns_timeout`; default 3 000. */
  timeoutMs?: number;
  /** The caller's deadline (RE-1): aborting it ends the lookup with `egress.dns_timeout`. */
  signal?: AbortSignal;
};
/** Test seams (DNS is an unmanaged dependency), never exported from the package: product code cannot set them. */
export type ResolveSeams = {
  /** A stub for the whole resolver, both modes. Its answers are vetted the same way. */
  lookup?: (host: string) => Promise<LookupAnswer>;
  /** The c-ares resolver for public names. Unused when `lookup` is given. */
  createResolver?: (options: ResolverOptions) => AddressResolver;
};

const DEFAULT_TIMEOUT_MS = 3_000;
/** Two tries, each given half the budget, so the second fits inside it; the outer race is the hard bound (P2.01k). */
const TRIES = 2;
const NO_SUCH_NAME: ReadonlySet<unknown> = new Set([NOTFOUND, NODATA]);

type Lookup = (host: string, cancelled: AbortSignal) => Promise<LookupAnswer>;

const systemLookup: Lookup = (host) => dnsLookup(host, { all: true, order: "verbatim" });

const familyOf = (address: string): number => (address.includes(":") ? 6 : 4);

/**
 * Both families in parallel on c-ares. Any answer: their union. "No such name" (NXDOMAIN or NODATA) on both:
 * `egress.dns_no_record`. Any other error on either family: `egress.dns_failed`, even when the other answered, so a
 * partial answer set is never vetted as the whole (architecture ruling 2026-10-06).
 */
const caresLookup =
  (timeoutMs: number, create: (options: ResolverOptions) => AddressResolver): Lookup =>
  async (host, cancelled) => {
    const perTry = Math.ceil(timeoutMs / TRIES);
    const resolver = create({ timeout: perTry, tries: TRIES, maxTimeout: perTry });
    cancelled.addEventListener("abort", () => resolver.cancel(), { once: true });
    const settled = await Promise.allSettled([resolver.resolve4(host), resolver.resolve6(host)]);
    const failed = settled.filter((s) => s.status === "rejected");
    if (failed.some((s) => !NO_SUCH_NAME.has((s.reason as { code?: unknown } | null)?.code))) {
      throw new NetGuardError("egress.dns_failed");
    }
    const addresses = settled.flatMap((s) => (s.status === "fulfilled" ? s.value : []));
    if (addresses.length === 0) throw new NetGuardError("egress.dns_no_record");
    return addresses.map((address) => ({ address, family: familyOf(address) }));
  };

/** The stub when given; otherwise c-ares for public names and `dns.lookup` for private ones. */
function lookupFor(policy: { allow: "public" | "private" }, options: ResolveOptions & ResolveSeams): Lookup {
  if (options.lookup) return options.lookup;
  if (policy.allow === "private") return systemLookup;
  const create = options.createResolver ?? ((o: ResolverOptions) => new Resolver(o));
  return caresLookup(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, create);
}

/**
 * The lookup, or `egress.dns_timeout` when the timer or the caller's signal wins; the query is then cancelled and a
 * late answer ignored. A lookup that throws, synchronously or not, is `egress.dns_failed` unless it threw a
 * NetGuardError (c-ares's `egress.dns_no_record`), and no timer outlives the call.
 */
async function lookupWithin(host: string, lookup: Lookup, options: ResolveOptions): Promise<LookupAnswer> {
  const cancel = new AbortController();
  const answer = Promise.resolve()
    .then(() => lookup(host, cancel.signal))
    .catch((error: unknown) => {
      throw error instanceof NetGuardError ? error : new NetGuardError("egress.dns_failed");
    });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort = (): void => undefined;
  const deadline = new Promise<never>((_, reject) => {
    const fail = (): void => {
      cancel.abort();
      reject(new NetGuardError("egress.dns_timeout"));
    };
    timer = setTimeout(fail, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    onAbort = fail;
    options.signal?.addEventListener("abort", fail, { once: true });
  });
  try {
    return await Promise.race([answer, deadline]);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

/** A resolver answer is used only if it is a plain IP literal, exactly as normalisation would write it. */
const isPlainAddress = (address: string): boolean => isIP(address) !== 0 && normaliseHost(address) === address;

/** Names with whitespace or control characters never reach the resolver. */
const isLookupName = (name: string): boolean => name !== "" && ![...name].some((c) => c <= " " || c === "\u007f");

/**
 * The addresses `host` may be connected to, in resolver order. `allow: "public"`: every answer must be public (one
 * private answer fails the whole lookup, so mixed-answer rebinding fails). `allow: "private"`: every answer must be
 * private or loopback, and not a translated IPv6 form. IP literals skip DNS but are vetted the same way.
 * Errors (NetGuardError): `egress.dns_timeout`, `egress.dns_no_record` (a public name with no address, P2.01m),
 * `egress.dns_failed` (error, empty or malformed answer, unusable name), `egress.private_address`.
 */
export function resolveVetted(
  host: string,
  policy: { allow: "public" | "private" },
  options: ResolveOptions = {},
): Promise<string[]> {
  const { timeoutMs, signal } = options; // only these: a seam never arrives through the public entry
  return resolveVettedWith(host, policy, {
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(signal === undefined ? {} : { signal }),
  });
}

/** `resolveVetted` with its test seams; not exported from the package. */
export async function resolveVettedWith(
  host: string,
  policy: { allow: "public" | "private" },
  options: ResolveOptions & ResolveSeams = {},
): Promise<string[]> {
  if (options.signal?.aborted) throw new NetGuardError("egress.dns_timeout");
  const name = normaliseHost(host);
  if (!isLookupName(name)) throw new NetGuardError("egress.dns_failed");
  const lookup = lookupFor(policy, options);
  const addresses = isIP(name) !== 0 ? [name] : (await lookupWithin(name, lookup, options)).map((a) => a.address);
  if (addresses.length === 0 || !addresses.every(isPlainAddress)) throw new NetGuardError("egress.dns_failed");
  const allowed = (address: string): boolean => {
    const cls = classifyAddress(address);
    if (policy.allow === "public") return cls === "public";
    return (cls === "private" || cls === "loopback") && !isTranslatedIpv6(address);
  };
  if (!addresses.every(allowed)) throw new NetGuardError("egress.private_address");
  return addresses;
}

type LookupCallback = (error: Error | null, address?: string | LookupAnswer, family?: number) => void;

/** What a lookup call asks for: every address or one, and a family (0 = any). Node passes a number or an object. */
function lookupRequest(options: unknown): { all: boolean; family: number } {
  if (typeof options === "number") return { all: false, family: options };
  const opts = typeof options === "object" && options !== null ? (options as { all?: unknown; family?: unknown }) : {};
  return { all: opts.all === true, family: opts.family === 4 || opts.family === 6 ? opts.family : 0 };
}

/**
 * A `lookup` for the socket layer that answers with the vetted addresses only and never resolves again, whatever
 * name it is asked for. Both shapes Node uses are supported: one address, and `{ all: true }` (which
 * `autoSelectFamily` asks for), with or without an options argument. A requested family filters the answer; none
 * left is ENOTFOUND, as from dns.lookup. Throws (a programming error) for an empty list or a non-IP entry.
 */
export function pinnedLookup(addresses: readonly string[]) {
  const answers = addresses.map((address) => {
    const family = isIP(address);
    if (family === 0) throw new Error("pinnedLookup takes vetted IP addresses only");
    return { address, family };
  });
  if (answers.length === 0) throw new Error("pinnedLookup needs at least one address");
  return (_hostname: string, optionsOrCallback: unknown, maybeCallback?: LookupCallback): void => {
    const [options, callback] =
      typeof optionsOrCallback === "function"
        ? [{}, optionsOrCallback as LookupCallback]
        : [optionsOrCallback, maybeCallback as LookupCallback];
    const { all, family } = lookupRequest(options);
    const matching = answers.filter((a) => family === 0 || a.family === family);
    const [first] = matching;
    if (first === undefined)
      callback(Object.assign(new Error("no vetted address of that family"), { code: "ENOTFOUND" }));
    else if (all) callback(null, matching);
    else callback(null, first.address, first.family);
  };
}
