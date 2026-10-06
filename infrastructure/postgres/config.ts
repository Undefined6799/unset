// The Postgres connection settings every process that connects merges into its schema (P1.11; moved here in P1.11p so
// the migrate CLI and each pool read the same fields). Each field carries its cross-field rule.
import { type Config, int, oneOf, secretFile, str, withRule } from "@unset/shared-config";
import type pg from "pg";

/** A lowercase hostname or a Compose service name; no scheme, port or trailing dot. */
const HOSTNAME = /[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*/;
/** An unquoted Postgres identifier. */
const IDENTIFIER = /[a-z_][a-z0-9_]{0,62}/;

export const postgresFields = {
  PG_HOST: str({ pattern: HOSTNAME }),
  PG_PORT: int({ min: 1, max: 65535, default: 5432 }),
  PG_DATABASE: str({ pattern: IDENTIFIER }),
  PG_USER: str({ pattern: IDENTIFIER }),
  PG_PASSWORD: secretFile({ minBytes: 16 }),
  // Plain TCP only inside the Compose network, where a service name has no dot; anything else is TLS with the server's
  // certificate and name checked. libpq's `require` (encrypt, check nothing) is left out: it stops no impostor.
  PG_SSLMODE: withRule(
    oneOf(["disable", "verify-full"]),
    (config) => config.PG_SSLMODE !== "disable" || !String(config.PG_HOST).includes("."),
  ),
};

/** What a client or pool needs to reach Postgres. */
export type Connection = Pick<pg.ClientConfig, "host" | "port" | "database" | "user" | "password" | "ssl">;

export type PostgresConfig = Config<typeof postgresFields>;

/** libpq's sslmode in node-postgres terms: `ssl: true` verifies the chain and the host name (Node tls defaults). */
export function connectionOf(cfg: PostgresConfig): Connection {
  const ssl = cfg.PG_SSLMODE === "verify-full";
  return {
    host: cfg.PG_HOST,
    port: cfg.PG_PORT,
    database: cfg.PG_DATABASE,
    user: cfg.PG_USER,
    password: cfg.PG_PASSWORD.reveal(),
    ssl,
  };
}
