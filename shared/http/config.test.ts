import { defineConfig, loadConfig, oneOf } from "@unset/shared-config";
import { describe, expect, test } from "vitest";
import { hostAllowed, httpKitConfig } from "./config.ts";

const ENV = {
  UNSET_ENV: "prod",
  PUBLIC_ORIGIN: "https://unset.sh",
  HTTP_ALLOWED_HOSTS: "unset.sh,.0x40.me",
  TRUSTED_PROXY_MODE: "header",
  TRUSTED_PROXY_HEADER: "x-forwarded-for",
  TRUSTED_PROXY_CIDRS: "10.0.0.0/8,fd00::/8",
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
      TRUSTED_PROXY_MODE: "header",
      TRUSTED_PROXY_HEADER: "x-forwarded-for",
      TRUSTED_PROXY_CIDRS: ["10.0.0.0/8", "fd00::/8"],
      TRUSTED_PROXY_HOPS: 1,
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

  test("config_rejects_any_cidr", () => {
    for (const cidrs of ["0.0.0.0/0", "::/0", "10.0.0.0/8,0.0.0.0/0", "10.0.0.0/33", "fd00::/129", "10.0.0.0", "a/8"]) {
      expect(problems({ ...ENV, TRUSTED_PROXY_CIDRS: cidrs })).toEqual([
        { key: "TRUSTED_PROXY_CIDRS", reason: "invalid" },
      ]);
    }
  });

  test("proxy_mode_required", () => {
    const { TRUSTED_PROXY_MODE: _mode, ...noMode } = ENV;
    expect(problems(noMode)).toEqual([{ key: "TRUSTED_PROXY_MODE", reason: "missing" }]);
  });

  test("header_mode_needs_header_and_cidrs", () => {
    const { TRUSTED_PROXY_HEADER: _header, TRUSTED_PROXY_CIDRS: _cidrs, ...bare } = ENV;
    expect(problems(bare)).toEqual([
      { key: "TRUSTED_PROXY_HEADER", reason: "invalid" },
      { key: "TRUSTED_PROXY_CIDRS", reason: "invalid" },
    ]);
    expect(problems({ ...ENV, TRUSTED_PROXY_HEADER: "X-Forwarded-For" })).toEqual([
      { key: "TRUSTED_PROXY_HEADER", reason: "invalid" },
    ]);
    expect(problems({ ...bare, TRUSTED_PROXY_MODE: "socket" })).toEqual([]);
  });

  test("proxy_hops_bounded", () => {
    for (const hops of ["0", "4"]) {
      expect(problems({ ...ENV, TRUSTED_PROXY_HOPS: hops })).toEqual([
        { key: "TRUSTED_PROXY_HOPS", reason: "invalid" },
      ]);
    }
    expect(problems({ ...ENV, TRUSTED_PROXY_HOPS: "2" })).toEqual([]);
  });
});
