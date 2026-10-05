import { defineConfig, loadConfig, oneOf } from "@unset/shared-config";
import { describe, expect, test } from "vitest";
import { hostAllowed, httpKitConfig } from "./config.ts";

const ENV = {
  UNSET_ENV: "prod",
  PUBLIC_ORIGIN: "https://unset.sh",
  HTTP_ALLOWED_HOSTS: "unset.sh,.0x40.me",
};
const load = (env: Record<string, string>) =>
  loadConfig(defineConfig({ ...httpKitConfig }), env, { onUnknownKeys: () => undefined });
/** With UNSET_ENV in the schema, as an entrypoint's schema has it (P1.02 common keys). */
const loadWithEnv = (env: Record<string, string>) =>
  loadConfig(defineConfig({ ...httpKitConfig, UNSET_ENV: oneOf(["dev", "test", "prod"]) }), env, {
    onUnknownKeys: () => undefined,
  });
const problems = (env: Record<string, string>, read: (env: Record<string, string>) => unknown = loadWithEnv) => {
  try {
    read(env);
    return [];
  } catch (error) {
    return (error as { problems: { key: string; reason: string }[] }).problems;
  }
};

describe("httpKitConfig", () => {
  test("kit_config_fragment", () => {
    expect(problems({ ...ENV, REQUEST_DEADLINE_MS: "500" }, load)).toEqual([
      { key: "REQUEST_DEADLINE_MS", reason: "invalid" },
    ]);
    expect(load(ENV)).toEqual({
      PUBLIC_ORIGIN: "https://unset.sh",
      HTTP_ALLOWED_HOSTS: ["unset.sh", ".0x40.me"],
      SHUTDOWN_GRACE_MS: 10000,
      REQUEST_DEADLINE_MS: 30000,
    });
  });

  test("plain_http_only_in_dev", () => {
    const http = { ...ENV, PUBLIC_ORIGIN: "http://localhost:8080", HTTP_ALLOWED_HOSTS: "localhost" };
    expect(problems(http)).toEqual([{ key: "PUBLIC_ORIGIN", reason: "invalid" }]);
    expect(problems({ ...http, UNSET_ENV: "dev" })).toEqual([]);
    // The fragment alone has no UNSET_ENV, so the rule fails closed.
    expect(problems({ ...http, UNSET_ENV: "dev" }, load)).toEqual([{ key: "PUBLIC_ORIGIN", reason: "invalid" }]);
  });

  test("public_host_must_be_allowed", () => {
    expect(problems({ ...ENV, HTTP_ALLOWED_HOSTS: ".0x40.me" })).toEqual([
      { key: "HTTP_ALLOWED_HOSTS", reason: "invalid" },
    ]);
    for (const hosts of ["*.0x40.me", "UNSET.sh", "unset.sh:443", "unset.sh.", "..0x40.me"]) {
      expect(problems({ ...ENV, HTTP_ALLOWED_HOSTS: hosts })).toEqual([
        { key: "HTTP_ALLOWED_HOSTS", reason: "invalid" },
      ]);
    }
  });

  test("host_entries_match_one_label", () => {
    expect(hostAllowed("alice.0x40.me", [".0x40.me"])).toBe(true);
    expect(hostAllowed("a.b.0x40.me", [".0x40.me"])).toBe(false);
    expect(hostAllowed("0x40.me", [".0x40.me"])).toBe(false);
    expect(hostAllowed("evil0x40.me", [".0x40.me"])).toBe(false);
    expect(hostAllowed("unset.sh", ["unset.sh"])).toBe(true);
    expect(hostAllowed("www.unset.sh", ["unset.sh"])).toBe(false);
  });
});
