// Resolve once, vet every answer, pin the connection (P1.18). A check alone loses to DNS rebinding: the socket layer
// gets `pinnedLookup`, which only ever hands back the addresses vetted here.
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { classifyAddress, isTranslatedIpv6, normaliseHost } from "./classify.ts";

export type NetGuardCode =
  | "egress.scheme"
  | "egress.port"
  | "egress.host_not_allowed"
  | "egress.internal_name"
  | "egress.private_address"
  | "egress.dns_failed"
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
export type ResolveOptions = {
  /** Milliseconds before `egress.dns_timeout`; default 3 000. */
  timeoutMs?: number;
  /** The caller's deadline (RE-1): aborting it ends the lookup with `egress.dns_timeout`. */
  signal?: AbortSignal;
  /** The resolver; tests pass a stub (DNS is an unmanaged dependency). Its answers are vetted the same way. */
  lookup?: (host: string) => Promise<LookupAnswer>;
};

const systemLookup = (host: string): Promise<LookupAnswer> => dnsLookup(host, { all: true, order: "verbatim" });

/**
 * The lookup, or `egress.dns_timeout` when the timer or the caller's signal wins; a late answer is ignored. A lookup
 * that throws, synchronously or not, is `egress.dns_failed`, and no timer outlives the call.
 */
async function lookupWithin(host: string, options: ResolveOptions): Promise<LookupAnswer> {
  const lookup = options.lookup ?? systemLookup;
  const answer = Promise.resolve()
    .then(() => lookup(host))
    .catch(() => {
      throw new NetGuardError("egress.dns_failed");
    });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort = (): void => undefined;
  const deadline = new Promise<never>((_, reject) => {
    const fail = (): void => reject(new NetGuardError("egress.dns_timeout"));
    timer = setTimeout(fail, options.timeoutMs ?? 3_000);
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
 * Errors (NetGuardError): `egress.dns_timeout`, `egress.dns_failed` (error, empty or malformed answer, unusable name),
 * `egress.private_address`.
 */
export async function resolveVetted(
  host: string,
  policy: { allow: "public" | "private" },
  options: ResolveOptions = {},
): Promise<string[]> {
  if (options.signal?.aborted) throw new NetGuardError("egress.dns_timeout");
  const name = normaliseHost(host);
  if (!isLookupName(name)) throw new NetGuardError("egress.dns_failed");
  const addresses = isIP(name) !== 0 ? [name] : (await lookupWithin(name, options)).map((a) => a.address);
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
