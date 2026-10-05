// Field kinds and schema definition (P1.02).
import { describe, expect, test } from "vitest";
import {
  bool,
  ConfigError,
  defineConfig,
  defineEntrypointConfig,
  int,
  list,
  loadConfig,
  oneOf,
  origin,
  Secret,
  secret,
  secretFile,
  str,
  url,
} from "./index.ts";

const quiet = { onUnknownKeys: () => undefined };

/** The problems a load reports; fails the test when the load succeeds. */
function problems(load: () => unknown): readonly { key: string; reason: string }[] {
  try {
    load();
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
  throw new Error("expected loadConfig to refuse");
}

describe("field kinds", () => {
  test("secret_has_no_default", () => {
    // @ts-expect-error: a secret has no default, by construction.
    expect(() => secret({ minBytes: 32, default: "x" })).toThrow();
    // @ts-expect-error: nor does a secret file.
    expect(() => secretFile({ minBytes: 32, default: "x" })).toThrow();
  });

  test("invalid_url_with_userinfo", () => {
    const schema = defineConfig({ U: url({ protocols: ["https:"] }) });
    expect(problems(() => loadConfig(schema, { U: "https://a:b@x.y" }, quiet))).toEqual([
      { key: "U", reason: "invalid" },
    ]);
    expect(problems(() => loadConfig(schema, { U: "http://x.y" }, quiet))).toEqual([{ key: "U", reason: "invalid" }]);
    expect(loadConfig(schema, { U: "https://x.y/p" }, quiet).U).toBe("https://x.y/p");
  });

  test("origin_has_no_path", () => {
    const schema = defineConfig({ O: origin({ protocols: ["https:", "http:"] }) });
    for (const bad of ["https://x.y/", "https://x.y/p", "https://u@x.y", "https://x.y?q", "x.y"]) {
      expect(
        problems(() => loadConfig(schema, { O: bad }, quiet)),
        bad,
      ).toEqual([{ key: "O", reason: "invalid" }]);
    }
    expect(loadConfig(schema, { O: "http://localhost:8080" }, quiet).O).toBe("http://localhost:8080");
  });

  test("int_range", () => {
    const schema = defineConfig({ LISTEN_PORT: int({ min: 1024, max: 65535 }) });
    for (const bad of ["80", "70000", "8080.5", "0x1f90", "8e3", " 8080"]) {
      expect(
        problems(() => loadConfig(schema, { LISTEN_PORT: bad }, quiet)),
        bad,
      ).toEqual([{ key: "LISTEN_PORT", reason: "invalid" }]);
    }
  });

  test("kinds_parse_strictly", () => {
    const schema = defineConfig({
      B: bool(),
      E: oneOf(["a", "b"]),
      S: str({ pattern: /^[a-z]+$/ }),
      L: list(int({ min: 0, max: 9 })),
    });
    const config = loadConfig(schema, { B: "false", E: "b", S: "abc", L: "1,2,3" }, quiet);
    expect(config).toEqual({ B: false, E: "b", S: "abc", L: [1, 2, 3] });
    const bad = { B: "yes", E: "c", S: "ABC", L: "1,x" };
    expect(problems(() => loadConfig(schema, bad, quiet)).map((p) => p.reason)).toEqual([
      "invalid",
      "invalid",
      "invalid",
      "invalid",
    ]);
  });

  test("pattern_judges_the_whole_value", () => {
    const schema = defineConfig({ S: str({ pattern: /a|b/ }) });
    expect(loadConfig(schema, { S: "b" }, quiet).S).toBe("b");
    expect(problems(() => loadConfig(schema, { S: "axxxEVIL" }, quiet))).toEqual([{ key: "S", reason: "invalid" }]);
    for (const pattern of [/^a$/m, /^a$/g, /^a$/y]) expect(() => str({ pattern }), String(pattern)).toThrow();
  });

  test("defined_secret_default_refused", () => {
    // A default spread onto a secret field by hand (or by untyped code) is refused when the schema is defined.
    const sneaky = { ...secretFile({ minBytes: 1 }), default: new Secret("fallback") };
    expect(() => defineConfig({ S: sneaky })).toThrow();
  });

  test("list_of_secrets_refused", () => {
    expect(() => list(secret({ minBytes: 1 }))).toThrow();
    expect(() => list(secretFile({ minBytes: 1 }))).toThrow();
  });

  test("list_items_are_not_empty_or_padded", () => {
    const schema = defineConfig({ L: list(str()), U: list(url({ protocols: ["https:"] }), { default: [] }) });
    for (const L of ["a,,b", "a,", " a", "a, b"]) {
      expect(
        problems(() => loadConfig(schema, { L }, quiet)),
        L,
      ).toEqual([{ key: "L", reason: "invalid" }]);
    }
    expect(problems(() => loadConfig(schema, { L: "a", U: "https://a.b, https://c.d" }, quiet))).toEqual([
      { key: "U", reason: "invalid" },
    ]);
  });

  test("schema_keys_are_env_names", () => {
    for (const key of ["constructor", "__proto__", "lower", "A-B", "1A"]) {
      expect(() => defineConfig({ [key]: str() }), key).toThrow();
    }
  });

  test("entrypoint_fields_cannot_replace_common_keys", () => {
    const untyped = defineEntrypointConfig as (fields: object) => unknown;
    expect(() => untyped({ UNSET_COMMIT: str() })).toThrow();
  });

  test("int_and_url_refuse_lax_forms", () => {
    const schema = defineConfig({ P: int({ min: 0, max: 99999 }) });
    for (const P of ["08080", "-0"]) {
      expect(
        problems(() => loadConfig(schema, { P }, quiet)),
        P,
      ).toEqual([{ key: "P", reason: "invalid" }]);
    }
    const urls = defineConfig({ U: url({ protocols: ["https:"] }) });
    for (const U of ["https:x.y", "https:\\\\x.y", "https://x\t.y"]) {
      expect(
        problems(() => loadConfig(urls, { U }, quiet)),
        U,
      ).toEqual([{ key: "U", reason: "invalid" }]);
    }
    expect(loadConfig(urls, { U: "https://x.y" }, quiet).U).toBe("https://x.y/");
    const origins = defineConfig({ O: origin() });
    expect(problems(() => loadConfig(origins, { O: "https://x.y." }, quiet))).toEqual([
      { key: "O", reason: "invalid" },
    ]);
  });

  test("cross_field_rule", () => {
    const schema = defineEntrypointConfig({});
    const base = { UNSET_ENV: "prod", UNSET_SERVICE: "http", LISTEN_PORT: "8080" };
    expect(problems(() => loadConfig(schema, { ...base, UNSET_COMMIT: "0".repeat(40) }, quiet))).toEqual([
      { key: "UNSET_COMMIT", reason: "invalid" },
    ]);
    const dev = loadConfig(schema, { ...base, UNSET_ENV: "dev", UNSET_COMMIT: "0".repeat(40) }, quiet);
    expect(dev.UNSET_SERVICE).toBe("http");
    expect(loadConfig(schema, { ...base, UNSET_COMMIT: "a".repeat(40) }, quiet).LISTEN_PORT).toBe(8080);
  });
});
