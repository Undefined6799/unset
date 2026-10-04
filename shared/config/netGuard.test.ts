import { describe, expect, test } from "vitest";
import { ConfigError, defineEntrypointConfig, loadConfig, netGuardFields, netGuardRules } from "./index.ts";

const schema = defineEntrypointConfig(netGuardFields, { rules: netGuardRules() });
const base = { UNSET_SERVICE: "http", UNSET_COMMIT: "a".repeat(40), LISTEN_PORT: "8080" };
const quiet = { onUnknownKeys: () => undefined };

function problems(env: Record<string, string>): readonly { key: string; reason: string }[] {
  try {
    loadConfig(schema, { ...base, ...env }, quiet);
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
  return [];
}

describe("netGuardFields", () => {
  test("internal_host_required_in_prod", () => {
    expect(problems({ UNSET_ENV: "prod" })).toEqual([{ key: "NETGUARD_INTERNAL_HOSTS", reason: "invalid" }]);
    expect(problems({ UNSET_ENV: "prod", NETGUARD_INTERNAL_HOSTS: "unset.ac" })).toEqual([]);
    expect(problems({ UNSET_ENV: "dev" })).toEqual([]);
  });

  test("loopback_flag_prod_refused", () => {
    const hosts = { NETGUARD_INTERNAL_HOSTS: "unset.ac" };
    for (const env of ["prod", "test"]) {
      expect(problems({ UNSET_ENV: env, NETGUARD_ALLOW_LOOPBACK: "true", ...hosts }), env).toEqual([
        { key: "NETGUARD_ALLOW_LOOPBACK", reason: "invalid" },
      ]);
    }
    expect(problems({ UNSET_ENV: "dev", NETGUARD_ALLOW_LOOPBACK: "true" })).toEqual([]);
  });

  test("hosts_are_exact_lowercase_names", () => {
    for (const value of ["Unset.ac", "unset.ac.", "*.0x40.me", "https://unset.ac", "unset.ac:443"]) {
      expect(problems({ UNSET_ENV: "dev", NETGUARD_INTERNAL_HOSTS: value }), value).toEqual([
        { key: "NETGUARD_INTERNAL_HOSTS", reason: "invalid" },
      ]);
    }
    const config = loadConfig(
      schema,
      { ...base, UNSET_ENV: "dev", NETGUARD_INTERNAL_HOSTS: "unset.ac,pds.example" },
      quiet,
    );
    expect(config.NETGUARD_INTERNAL_HOSTS).toEqual(["unset.ac", "pds.example"]);
    expect(config.NETGUARD_ALLOW_LOOPBACK).toBe(false);
  });
});
