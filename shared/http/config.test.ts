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
  MEDIA_ORIGIN: "https://unsetcdn.net",
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
      HTTP_BODY_LIMIT_BYTES: 65_536,
      RATE_LIMIT_MAX_KEYS: 100_000,
      MEDIA_ORIGIN: "https://unsetcdn.net",
      ASSETS_BASE: "",
      DEV_VITE_ORIGIN: "",
    });
  });

  test("limit_keys_bounded", () => {
    expect(problems({ ...ENV, HTTP_BODY_LIMIT_BYTES: "1023" }, load)).toEqual([
      { key: "HTTP_BODY_LIMIT_BYTES", reason: "invalid" },
    ]);
    expect(problems({ ...ENV, HTTP_BODY_LIMIT_BYTES: "1048577" }, load)).toEqual([
      { key: "HTTP_BODY_LIMIT_BYTES", reason: "invalid" },
    ]);
    expect(problems({ ...ENV, RATE_LIMIT_MAX_KEYS: "0" }, load)).toEqual([
      { key: "RATE_LIMIT_MAX_KEYS", reason: "invalid" },
    ]);
  });

  test("media_same_site_refused", () => {
    // Plan §5.2: the media origin is another site, so an uploaded file opened directly never runs in ours.
    for (const media of ["https://media.unset.sh", "https://unset.sh", "https://a.b.unset.sh"]) {
      expect(problems({ ...ENV, MEDIA_ORIGIN: media })).toEqual([{ key: "MEDIA_ORIGIN", reason: "invalid" }]);
    }
    // A TLD outside KNOWN_TLDS cannot be compared, so it is refused rather than guessed.
    expect(problems({ ...ENV, MEDIA_ORIGIN: "https://media.example.co.uk" })).toEqual([
      { key: "MEDIA_ORIGIN", reason: "invalid" },
    ]);
    expect(problems({ ...ENV, MEDIA_ORIGIN: "http://unsetcdn.net" })).toEqual([
      { key: "MEDIA_ORIGIN", reason: "invalid" },
    ]);
    // The media process serves the media origin itself.
    const media = defineConfig({
      ...httpKitConfig,
      UNSET_ENV: oneOf(["dev", "test", "prod"]),
      UNSET_SERVICE: oneOf(["http", "media"]),
    });
    const env = { ...ENV, UNSET_SERVICE: "media", MEDIA_ORIGIN: "https://unset.sh" };
    expect(loadConfig(media, env, { onUnknownKeys: () => undefined }).MEDIA_ORIGIN).toBe("https://unset.sh");
    expect(() => loadConfig(media, { ...env, UNSET_SERVICE: "http" }, { onUnknownKeys: () => undefined })).toThrow(
      "MEDIA_ORIGIN invalid",
    );
  });

  test("dev_origin_refused_in_prod", () => {
    // bootOrExit turns this ConfigError into exit 78 (shared/config/load.ts).
    const vite = { ...ENV, DEV_VITE_ORIGIN: "http://localhost:5173" };
    expect(problems(vite)).toEqual([{ key: "DEV_VITE_ORIGIN", reason: "invalid" }]);
    expect(problems({ ...vite, UNSET_ENV: "test" })).toEqual([{ key: "DEV_VITE_ORIGIN", reason: "invalid" }]);
    expect(problems({ ...vite, UNSET_ENV: "dev" })).toEqual([]);
    expect(problems({ ...vite, UNSET_ENV: "dev", DEV_VITE_ORIGIN: "http://localhost:5173/" })).toEqual([
      { key: "DEV_VITE_ORIGIN", reason: "invalid" },
    ]);
  });

  test("assets_base_is_an_assets_folder", () => {
    expect(problems({ ...ENV, ASSETS_BASE: "https://static.unset.sh/assets/" })).toEqual([]);
    for (const bad of [
      "https://static.unset.sh/",
      "https://static.unset.sh/assets",
      "http://static.unset.sh/assets/",
    ]) {
      expect(problems({ ...ENV, ASSETS_BASE: bad })).toEqual([{ key: "ASSETS_BASE", reason: "invalid" }]);
    }
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
