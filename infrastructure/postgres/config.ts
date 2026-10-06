// The Postgres connection settings every process that connects merges into its schema (P1.11; moved here in P1.11p so
// the migrate CLI and each pool read the same fields). Each field carries its cross-field rule.
import { readFileSync } from "node:fs";
import { classifyAddress } from "@unset/infrastructure-net-guard";
import { type Config, int, oneOf, secretFile, str, withRule } from "@unset/shared-config";
import type pg from "pg";

/** A lowercase hostname or a Compose service name; no scheme, port or trailing dot. */
const HOSTNAME = /[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*/;
/** A Compose service name: one label, no dot, colon or bracket (architecture ruling 2026-10-06, P1.11p). */
const SERVICE_NAME = /^[a-z][a-z0-9-]{0,62}$/;
/** An unquoted Postgres identifier. */
const IDENTIFIER = /[a-z_][a-z0-9_]{0,62}/;

/**
 * Whether `disable` may reach this host: a Compose service name, or a loopback address as net-guard classifies it
 * (net-guard is the only IP class table). Not `isInternalName`, which also admits `.local`, `.internal` and metadata
 * names that can sit outside the host.
 */
function plainTcpAllowed(host: string): boolean {
  return SERVICE_NAME.test(host) || classifyAddress(host) === "loopback";
}

export const postgresFields = {
  PG_HOST: str({ pattern: HOSTNAME }),
  PG_PORT: int({ min: 1, max: 65535, default: 5432 }),
  PG_DATABASE: str({ pattern: IDENTIFIER }),
  PG_USER: str({ pattern: IDENTIFIER }),
  PG_PASSWORD: secretFile({ minBytes: 16 }),
  // Plain TCP only to a Compose service name or loopback; anything else is TLS with the server's certificate and name
  // checked. libpq's `require` (encrypt, check nothing) is left out: it stops no impostor.
  PG_SSLMODE: withRule(
    oneOf(["disable", "verify-full"]),
    (config) => config.PG_SSLMODE !== "disable" || plainTcpAllowed(String(config.PG_HOST)),
  ),
  /** A private CA's certificate file for verify-full (a managed Postgres); empty means the system CAs. */
  PG_SSLROOTCERT: withRule(
    str({ pattern: /\/[A-Za-z0-9._/-]+/, default: "" }),
    (config) => config.PG_SSLROOTCERT === "" || config.PG_SSLMODE === "verify-full",
  ),
};

/** Pool sizing (P1.11p), for processes that hold a pool; the migrate CLI has none. */
export const poolFields = {
  PG_POOL_MAX: int({ min: 1, max: 50 }),
  /** The longest wait for a pooled client. 0, which node-postgres reads as "wait forever", is outside the range. */
  PG_CONNECT_TIMEOUT_MS: int({ min: 100, max: 10_000, default: 2000 }),
  /** The most replicas of one service alive at once during a rollout. */
  PG_MAX_REPLICAS: int({ min: 1, max: 4, default: 3 }),
};

/**
 * The advisory lock pool (P1.17), for processes that serialise work per DID (the OAuth client's token refresh). Its
 * own small pool, so callers waiting on a lock cannot starve normal queries; `checkConnectionBudget` counts it with
 * PG_POOL_MAX.
 */
export const lockPoolFields = {
  LOCK_POOL_MAX: int({ min: 1, max: 20, default: 8 }),
};

/** What a client or pool needs to reach Postgres. */
export type Connection = Pick<pg.ClientConfig, "host" | "port" | "database" | "user" | "password" | "ssl">;

export type PostgresConfig = Config<typeof postgresFields>;

/**
 * libpq's sslmode in node-postgres terms: `ssl: true`, or `{ ca }` for a private CA, keeps Node's tls defaults, so the
 * chain and the host name are checked (pg 8.23.0 lib/connection.js:102-121 sets `servername`). Never
 * `rejectUnauthorized: false`. A missing CA file throws here, at boot.
 */
export function connectionOf(cfg: PostgresConfig): Connection {
  const ssl =
    cfg.PG_SSLMODE === "disable"
      ? false
      : cfg.PG_SSLROOTCERT === ""
        ? true
        : { ca: readFileSync(cfg.PG_SSLROOTCERT, "utf8") };
  return {
    host: cfg.PG_HOST,
    port: cfg.PG_PORT,
    database: cfg.PG_DATABASE,
    user: cfg.PG_USER,
    password: cfg.PG_PASSWORD.reveal(),
    ssl,
  };
}
