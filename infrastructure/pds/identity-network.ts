// The identity domain's network contract (P2.01a) on net-guard: did:plc documents under the fixed `plc` policy,
// did:web documents and handle domains under `atproto`, TXT through net-guard's c-ares lookup (ADR 0013). Each
// net-guard code becomes one of the domain's three failures; any other error is a programming error and is thrown.
import type { FetchRequest, HttpOutcome, IdentityNetwork, TxtOutcome } from "@unset/domains-identity";
import {
  atproto,
  type NetGuard,
  type NetGuardCode,
  NetGuardError,
  plc,
  resolveTxt,
  type TxtOptions,
} from "@unset/infrastructure-net-guard";

export type IdentityNetworkOptions = {
  readonly guard: NetGuard;
  /** PLC_URL: the one origin `plc` requests may reach; its host must be one net-guard's `plc` policy allows. */
  readonly plcUrl: URL;
  /** IDENTITY_HTTP_TIMEOUT_MS */
  readonly httpTimeoutMs: number;
  /** IDENTITY_DNS_TIMEOUT_MS */
  readonly dnsTimeoutMs: number;
  /** Test seam: the TXT resolver (DNS is an unmanaged dependency). */
  readonly createResolver?: TxtOptions["createResolver"];
};

type Failure = Exclude<HttpOutcome["kind"], "response">;

/** Every code, so a new one fails the typecheck until it is placed. */
const FAILURE: Record<NetGuardCode, Failure> = {
  "egress.dns_failed": "unavailable",
  "egress.dns_timeout": "unavailable",
  "egress.connect": "unavailable",
  "egress.tls": "unavailable",
  "egress.timeout": "unavailable",
  "egress.dns_no_record": "no_such_host",
  "egress.scheme": "refused",
  "egress.port": "refused",
  "egress.host_not_allowed": "refused",
  "egress.internal_name": "refused",
  "egress.private_address": "refused",
  "egress.too_large": "refused",
  "egress.redirect": "refused",
  "egress.encoding": "refused",
  "egress.content_type": "refused",
};

/** The largest body the domain may ask for (ADR 0013): a DID document. */
const MAX_BYTES = 64 * 1024;

/**
 * The domain cannot widen its own egress (ADR 0013): `plc` reaches only PLC_URL's origin, `public` only https URLs
 * without userinfo. Anything else is refused before any network use.
 */
function allowed(url: URL, target: FetchRequest["target"], plcUrl: URL): boolean {
  if (target === "plc") return url.origin === plcUrl.origin;
  return url.protocol === "https:" && url.username === "" && url.password === "";
}

function failure(error: unknown): Failure {
  if (error instanceof NetGuardError) return FAILURE[error.code];
  throw error;
}

/** Throws (a configuration error) unless PLC_URL is https on a host net-guard's `plc` policy allows. */
export function createIdentityNetwork(options: IdentityNetworkOptions): IdentityNetwork {
  const { plcUrl } = options;
  if (plc.kind !== "fixed" || plcUrl.protocol !== "https:" || !plc.hosts.includes(plcUrl.hostname)) {
    throw new TypeError("PLC_URL must be https on a host net-guard's plc policy allows");
  }
  return {
    async get(url: URL, request: FetchRequest): Promise<HttpOutcome> {
      if (!allowed(url, request.target, plcUrl)) return { kind: "refused" };
      try {
        const response = await options.guard.request(request.target === "plc" ? plc : atproto, {
          url: url.href,
          method: "GET",
          headers: { accept: request.accept },
          timeoutMs: options.httpTimeoutMs,
          maxBytes: Math.min(request.maxBytes, MAX_BYTES),
        });
        return { kind: "response", status: response.status, body: response.body };
      } catch (error) {
        return { kind: failure(error) };
      }
    },
    async txt(name: string): Promise<TxtOutcome> {
      try {
        const records = await resolveTxt(name, {
          timeoutMs: options.dnsTimeoutMs,
          ...(options.createResolver ? { createResolver: options.createResolver } : {}),
        });
        return { kind: "records", records: records.map((chunks) => chunks.join("")) };
      } catch (error) {
        const kind = failure(error);
        return kind === "no_such_host" ? { kind: "no_record" } : { kind: "unavailable" };
      }
    },
  };
}
