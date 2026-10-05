// DNS TXT lookups through net-guard (P2.01k), for `_atproto.<handle>` (https://atproto.com/specs/handle). c-ares via a
// `node:dns` Resolver, off the libuv threadpool, bounded by our own timer: Resolver options and error codes as
// documented for Node v26.10.0 (doc/api/dns.md, "Resolver([options])", "resolver.cancel()", "Error codes"); Node 26.10
// bundles c-ares 1.34.8, whose per-try timeout grows between tries up to maxTimeout (docs/ares_init_options.3).
import { CANCELLED, NODATA, NOTFOUND, Resolver, TIMEOUT } from "node:dns/promises";
import { NetGuardError } from "./resolve.ts";

/** The part of a `node:dns/promises` Resolver this file uses; tests pass a stub (DNS is an unmanaged dependency). */
export type TxtResolver = { resolveTxt(name: string): Promise<string[][]>; cancel(): void };
export type TxtOptions = {
  /** Milliseconds before `egress.dns_timeout`, for both tries together. */
  timeoutMs: number;
  /** The caller's deadline (RE-1): aborting it ends the lookup with `egress.dns_timeout`. */
  signal?: AbortSignal;
  createResolver?: (options: ResolverOptions) => TxtResolver;
};

type ResolverOptions = { timeout: number; tries: number; maxTimeout: number };
/** Two tries, each given half the budget, so the second try fits inside it; our timer is the hard bound. */
const TRIES = 2;
/** LDH labels of 1 to 63 characters, plus `_` for service labels such as `_atproto`; 253 characters at most. */
const DNS_NAME =
  /^(?=.{1,253}$)[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?(?:\.[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?)*$/i;

/** No record (the name does not exist, or has no TXT) is told apart from "could not tell": P2.01 treats them apart. */
function codeFor(error: unknown): NetGuardError {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === NOTFOUND || code === NODATA) return new NetGuardError("egress.dns_no_record");
  if (code === TIMEOUT || code === CANCELLED) return new NetGuardError("egress.dns_timeout");
  return new NetGuardError("egress.dns_failed");
}

/**
 * The TXT records of `name`, each as its chunks. Errors (NetGuardError): `egress.dns_no_record` (NXDOMAIN, NODATA or
 * an empty answer), `egress.dns_timeout` (our timer, the caller's signal or the resolver's own timeout; the query is
 * cancelled), `egress.dns_failed` (a name that is not a DNS name, sent nowhere, or any other failure).
 */
export async function resolveTxt(name: string, options: TxtOptions): Promise<string[][]> {
  if (!DNS_NAME.test(name)) throw new NetGuardError("egress.dns_failed");
  if (options.signal?.aborted) throw new NetGuardError("egress.dns_timeout");
  const perTry = Math.ceil(options.timeoutMs / TRIES);
  const create = options.createResolver ?? ((o: ResolverOptions) => new Resolver(o));
  const resolver = create({ timeout: perTry, tries: TRIES, maxTimeout: perTry });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort = (): void => undefined;
  const deadline = new Promise<never>((_, reject) => {
    onAbort = () => {
      resolver.cancel();
      reject(new NetGuardError("egress.dns_timeout"));
    };
    timer = setTimeout(onAbort, options.timeoutMs);
    options.signal?.addEventListener("abort", onAbort, { once: true });
  });
  const answer = Promise.resolve()
    .then(() => resolver.resolveTxt(name))
    .catch((error: unknown) => {
      throw codeFor(error);
    });
  try {
    const records = await Promise.race([answer, deadline]);
    if (records.length === 0) throw new NetGuardError("egress.dns_no_record");
    return records;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}
