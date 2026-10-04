// Resolve once, vet every answer, pin the connection (P1.18). A check alone loses to DNS rebinding: the socket layer
// gets `pinnedLookup`, which only ever hands back the addresses vetted here.
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { classifyAddress, normaliseHost } from "./classify.ts";

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
  timeoutMs?: number;
  /** The resolver; tests pass a stub (DNS is an unmanaged dependency). Its answers are vetted the same way. */
  lookup?: (host: string) => Promise<LookupAnswer>;
};

const systemLookup = (host: string): Promise<LookupAnswer> => dnsLookup(host, { all: true, order: "verbatim" });

/** The lookup, or `egress.dns_timeout` when the timer wins; a late answer is ignored. */
async function lookupWithin(host: string, options: ResolveOptions): Promise<LookupAnswer> {
  const lookup = options.lookup ?? systemLookup;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new NetGuardError("egress.dns_timeout")), options.timeoutMs ?? 3_000);
  });
  const answer = lookup(host).catch(() => {
    throw new NetGuardError("egress.dns_failed");
  });
  try {
    return await Promise.race([answer, timeout]);
  } finally {
    clearTimeout(timer);
    answer.catch(() => undefined); // a lookup that fails after the timeout is not an unhandled rejection
  }
}

/**
 * The addresses `host` may be connected to, in resolver order. `allow: "public"`: every answer must be public (one
 * private answer fails the whole lookup, so mixed-answer rebinding fails). `allow: "private"`: every answer must be
 * private or loopback. IP literals skip DNS but are vetted the same way.
 */
export async function resolveVetted(
  host: string,
  policy: { allow: "public" | "private" },
  options: ResolveOptions = {},
): Promise<string[]> {
  const name = normaliseHost(host);
  const addresses = isIP(name) !== 0 ? [name] : (await lookupWithin(name, options)).map((a) => a.address);
  if (addresses.length === 0) throw new NetGuardError("egress.dns_failed");
  const allowed = (address: string): boolean => {
    const cls = classifyAddress(address);
    return policy.allow === "public" ? cls === "public" : cls === "private" || cls === "loopback";
  };
  if (!addresses.every(allowed)) throw new NetGuardError("egress.private_address");
  return addresses;
}

type LookupCallback = (error: Error | null, address?: string | LookupAnswer, family?: number) => void;

/**
 * A `lookup` for the socket layer that answers with the vetted addresses only and never resolves again, whatever
 * name it is asked for. Both shapes Node uses are supported: one address, and `{ all: true }` (which
 * `autoSelectFamily` asks for). A requested family filters the answer.
 */
export function pinnedLookup(addresses: readonly string[]) {
  const answers = addresses.map((address) => {
    const family = isIP(address);
    if (family === 0) throw new Error("pinnedLookup takes vetted IP addresses only");
    return { address, family };
  });
  if (answers.length === 0) throw new Error("pinnedLookup needs at least one address");
  return (_hostname: string, options: unknown, callback: LookupCallback): void => {
    const opts =
      typeof options === "object" && options !== null ? (options as { all?: boolean; family?: unknown }) : {};
    const family = typeof options === "number" ? options : opts.family === 4 || opts.family === 6 ? opts.family : 0;
    const matching = answers.filter((a) => family === 0 || a.family === family);
    if (opts.all === true) {
      callback(null, matching);
      return;
    }
    const [first] = matching;
    if (first === undefined)
      callback(Object.assign(new Error("no vetted address of that family"), { code: "ENOTFOUND" }));
    else callback(null, first.address, first.family);
  };
}
