// The server kit's config fragment (P1.04k). Each entrypoint's schema spreads `httpKitConfig`, so a kit key never
// arrives without its cross-field rule, and later kit steps (P1.05–P1.09) add their keys here, never in an interface.
import { int, list, oneOf, origin, str, withRule } from "@unset/shared-config";
import { parseCidr } from "./trustedProxy.ts";

const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
/** An exact lowercase host, or a leading-dot suffix entry (`.0x40.me`) matching exactly one label below it. */
const HOST_ENTRY = new RegExp(`\\.?${LABEL}(?:\\.${LABEL})*`);

/** True when `host` (lowercase, no port) is an exact entry, or one label below a leading-dot suffix entry. */
export function hostAllowed(host: string, entries: readonly string[]): boolean {
  return entries.some((entry) => {
    if (!entry.startsWith(".")) return host === entry;
    const label = host.slice(0, -entry.length);
    return host.endsWith(entry) && label !== "" && !label.includes(".");
  });
}

export const httpKitConfig = {
  /** This process's public origin. Plain http only in dev (fail closed when UNSET_ENV is absent). */
  PUBLIC_ORIGIN: withRule(
    origin({ protocols: ["https:", "http:"] }),
    (config) => String(config.PUBLIC_ORIGIN).startsWith("https:") || config.UNSET_ENV === "dev",
  ),
  /** Hosts this process answers for; anything else is 421. The public origin's own host must be one of them. */
  HTTP_ALLOWED_HOSTS: withRule(list(str({ pattern: HOST_ENTRY })), (config) =>
    hostAllowed(new URL(String(config.PUBLIC_ORIGIN)).hostname, config.HTTP_ALLOWED_HOSTS as readonly string[]),
  ),
  SHUTDOWN_GRACE_MS: int({ min: 1000, max: 30000, default: 10000 }),
  REQUEST_DEADLINE_MS: int({ min: 1000, max: 60000, default: 30000 }),
  /** Where the client address comes from (P1.05): the edge's header, or the socket where there is no edge (admin). */
  TRUSTED_PROXY_MODE: oneOf(["header", "socket"]),
  /** The one header the edge sets, lowercase (`x-forwarded-for`). Required in header mode. */
  TRUSTED_PROXY_HEADER: withRule(
    str({ pattern: /[a-z0-9-]+/, default: "" }),
    (config) => config.TRUSTED_PROXY_MODE !== "header" || config.TRUSTED_PROXY_HEADER !== "",
  ),
  /** The edge's internal addresses as CIDRs. Required in header mode; a zero-length prefix (`0.0.0.0/0`) is invalid. */
  TRUSTED_PROXY_CIDRS: withRule(list(str(), { default: [] }), (config) => {
    const cidrs = config.TRUSTED_PROXY_CIDRS as readonly string[];
    return (
      cidrs.every((c) => parseCidr(c) !== undefined) && (config.TRUSTED_PROXY_MODE !== "header" || cidrs.length > 0)
    );
  }),
  /** How many trusted proxies append to the header; the hop count is explicit, never inferred from the CIDRs. */
  TRUSTED_PROXY_HOPS: int({ min: 1, max: 3, default: 1 }),
  /** The default request body cap (P1.06); a route may set its own `bodyLimit`. */
  HTTP_BODY_LIMIT_BYTES: int({ min: 1024, max: 1_048_576, default: 65_536 }),
  /** Rate-limit buckets held at once (P1.06): about 12 MB at the default; past it, new keys share a strict bucket. */
  RATE_LIMIT_MAX_KEYS: int({ min: 1, max: 1_000_000, default: 100_000 }),
};

/** What the kit reads from an entrypoint's loaded config: the common keys (P1.02) and its own fragment. */
export type HttpKitConfig = Readonly<{
  UNSET_ENV: "dev" | "test" | "prod";
  UNSET_SERVICE: string;
  UNSET_COMMIT: string;
  LISTEN_PORT: number;
  PUBLIC_ORIGIN: string;
  HTTP_ALLOWED_HOSTS: readonly string[];
  SHUTDOWN_GRACE_MS: number;
  REQUEST_DEADLINE_MS: number;
  TRUSTED_PROXY_MODE: "header" | "socket";
  TRUSTED_PROXY_HEADER: string;
  TRUSTED_PROXY_CIDRS: readonly string[];
  TRUSTED_PROXY_HOPS: number;
  HTTP_BODY_LIMIT_BYTES: number;
  RATE_LIMIT_MAX_KEYS: number;
}>;
