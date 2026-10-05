// The net-guard settings every egress-making entrypoint merges into its schema (P1.18a; architecture ruling
// 2026-10-04 23:33Z). net-guard itself stays a leaf and receives the parsed values from the composition root. Each
// field carries its cross-field rule, so merging the fields merges the rules.
import { bool, list, str, withRule } from "./schema.ts";

/** Exact lowercase hostnames: no scheme, port, wildcard or trailing dot. */
const HOSTNAME = /[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*/;

export const netGuardFields = {
  /** Hosts reached inside the stack that must resolve only to private addresses (our own PDS). Required in prod. */
  NETGUARD_INTERNAL_HOSTS: withRule(
    list(str({ pattern: HOSTNAME }), { default: [] }),
    (config) => config.UNSET_ENV !== "prod" || (config.NETGUARD_INTERNAL_HOSTS as readonly string[]).length > 0,
  ),
  /** Lets dev reach loopback over plain HTTP. Refused anywhere but dev (fail closed when UNSET_ENV is absent). */
  NETGUARD_ALLOW_LOOPBACK: withRule(
    bool({ default: false }),
    (config) => config.NETGUARD_ALLOW_LOOPBACK !== true || config.UNSET_ENV === "dev",
  ),
};
