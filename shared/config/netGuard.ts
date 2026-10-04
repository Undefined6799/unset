// The net-guard settings every egress-making entrypoint merges into its schema (P1.18a; architecture ruling
// 2026-10-04 23:33Z). net-guard itself stays a leaf and receives the parsed values from the composition root.
import { bool, type Config, type Field, list, type Rule, str } from "./schema.ts";

/** Exact lowercase hostnames: no scheme, port, wildcard or trailing dot. */
const HOSTNAME = /[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*/;

export const netGuardFields = {
  /** Hosts reached inside the stack that must resolve only to private addresses (our own PDS). Required in prod. */
  NETGUARD_INTERNAL_HOSTS: list(str({ pattern: HOSTNAME }), { default: [] }),
  /** Lets dev reach loopback over plain HTTP. Refused anywhere but dev. */
  NETGUARD_ALLOW_LOOPBACK: bool({ default: false }),
};

type NetGuardSchema = typeof netGuardFields & { UNSET_ENV: Field<"dev" | "test" | "prod"> };

/** The cross-field rules: internal hosts set in prod, loopback only in dev. */
export function netGuardRules<F extends NetGuardSchema>(): Rule<F>[] {
  const env = (config: Config<F>): string => config.UNSET_ENV as string;
  return [
    {
      key: "NETGUARD_INTERNAL_HOSTS",
      holds: (config) => env(config) !== "prod" || (config.NETGUARD_INTERNAL_HOSTS as readonly string[]).length > 0,
    },
    {
      key: "NETGUARD_ALLOW_LOOPBACK",
      holds: (config) => config.NETGUARD_ALLOW_LOOPBACK !== true || env(config) === "dev",
    },
  ];
}
