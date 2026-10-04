import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";
import { afterAll, describe, expect, test } from "vitest";
import {
  bool,
  ConfigError,
  defineConfig,
  defineEntrypointConfig,
  describeConfig,
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

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function tempFile(name: string, body: string, mode = 0o600): string {
  const dir = mkdtempSync(join(tmpdir(), "config-"));
  dirs.push(dir);
  const path = join(dir, name);
  writeFileSync(path, body);
  chmodSync(path, mode);
  return path;
}

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

const SECRET_32 = "s".repeat(32);
const quiet = { onUnknownKeys: () => undefined };

describe("loadConfig", () => {
  test("missing_lists_all_keys", () => {
    const schema = defineConfig({ A: str(), B: int({ min: 0, max: 9 }) });
    let error: unknown;
    try {
      loadConfig(schema, { C: "value-that-must-not-leak" }, quiet);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ConfigError);
    const configError = error as ConfigError;
    expect(configError.code).toBe("config.invalid");
    expect(configError.problems).toEqual([
      { key: "A", reason: "missing" },
      { key: "B", reason: "missing" },
    ]);
    expect(configError.message).not.toContain("value-that-must-not-leak");
    expect(JSON.stringify(configError)).not.toContain("value-that-must-not-leak");
  });

  test("blank_value_is_missing", () => {
    expect(problems(() => loadConfig(defineConfig({ A: str() }), { A: "   " }, quiet))).toEqual([
      { key: "A", reason: "missing" },
    ]);
  });

  test("defaults_apply_only_when_missing", () => {
    const schema = defineConfig({ A: int({ min: 1, max: 9, default: 3 }), B: bool({ default: false }) });
    expect(loadConfig(schema, {}, quiet)).toEqual({ A: 3, B: false });
    expect(loadConfig(schema, { A: "7", B: "true" }, quiet)).toEqual({ A: 7, B: true });
  });

  test("secret_has_no_default", () => {
    // @ts-expect-error: a secret has no default, by construction.
    expect(() => secret({ minBytes: 32, default: "x" })).toThrow();
    // @ts-expect-error: nor does a secret file.
    expect(() => secretFile({ minBytes: 32, default: "x" })).toThrow();
  });

  test("secret_min_bytes", () => {
    const schema = defineConfig({ S: secret({ minBytes: 32 }) });
    expect(problems(() => loadConfig(schema, { S: "short" }, quiet))).toEqual([{ key: "S", reason: "invalid" }]);
    expect(loadConfig(schema, { S: SECRET_32 }, quiet).S.reveal()).toBe(SECRET_32);
  });

  test("secret_in_env_forbidden_in_prod", () => {
    const schema = defineConfig({ S: secret({ minBytes: 32 }) });
    expect(problems(() => loadConfig(schema, { UNSET_ENV: "prod", S: SECRET_32 }, quiet))).toEqual([
      { key: "S", reason: "forbidden_in_env" },
    ]);
  });

  test("secret_file_read", () => {
    const schema = defineConfig({ S: secretFile({ minBytes: 32 }) });
    const config = loadConfig(schema, { S_FILE: tempFile("s", `${"a".repeat(32)}\n`) }, quiet);
    expect(config.S.reveal()).toBe("a".repeat(32));
  });

  test("secret_file_unreadable", () => {
    const schema = defineConfig({ S: secretFile({ minBytes: 1 }) });
    const dir = mkdtempSync(join(tmpdir(), "config-"));
    dirs.push(dir);
    for (const path of [join(dir, "missing"), dir, tempFile("big", "x".repeat(64 * 1024 + 1))]) {
      expect(
        problems(() => loadConfig(schema, { S_FILE: path }, quiet)),
        path,
      ).toEqual([{ key: "S", reason: "unreadable" }]);
    }
  });

  test("secret_file_world_writable_is_unreadable", () => {
    const schema = defineConfig({ S: secretFile({ minBytes: 1 }) });
    const path = tempFile("w", "value", 0o666);
    chmodSync(path, 0o666);
    expect(problems(() => loadConfig(schema, { S_FILE: path }, quiet))).toEqual([{ key: "S", reason: "unreadable" }]);
  });

  test("secret_file_symlink_followed", () => {
    const schema = defineConfig({ S: secretFile({ minBytes: 1 }) });
    const target = tempFile("t", "value\n");
    const link = `${target}.link`;
    symlinkSync(target, link);
    expect(loadConfig(schema, { S_FILE: link }, quiet).S.reveal()).toBe("value");
  });

  test("secret_file_empty_is_missing", () => {
    const schema = defineConfig({ S: secretFile({ minBytes: 1 }) });
    expect(problems(() => loadConfig(schema, { S_FILE: tempFile("e", "\n") }, quiet))).toEqual([
      { key: "S", reason: "missing" },
    ]);
  });

  test("secret_file_in_env_forbidden_in_prod", () => {
    const schema = defineConfig({ X: secretFile({ minBytes: 1 }) });
    const env = { UNSET_ENV: "prod", X: "plain", X_FILE: tempFile("x", "value") };
    expect(problems(() => loadConfig(schema, env, quiet))).toEqual([{ key: "X", reason: "forbidden_in_env" }]);
  });

  test("secret_never_printed", () => {
    const s = new Secret("hunter2-hunter2");
    for (const shown of [String(s), `${s}`, JSON.stringify({ s }), inspect(s), inspect({ s })]) {
      expect(shown).not.toContain("hunter2");
      expect(shown).toContain("[secret]");
    }
    const config = loadConfig(defineConfig({ S: secret({ minBytes: 1 }) }), { S: "hunter2" }, quiet);
    expect(JSON.stringify(config)).toBe('{"S":"[secret]"}');
  });

  test("secret_equals", () => {
    expect(new Secret("abc").equals(new Secret("abc"))).toBe(true);
    expect(new Secret("abc").equals(new Secret("abd"))).toBe(false);
    expect(new Secret("abc").equals(new Secret("abcd"))).toBe(false);
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

  test("unanchored_pattern_refused", () => {
    expect(() => str({ pattern: /[a-z]+/ })).toThrow();
  });

  test("frozen", () => {
    const config = loadConfig(defineConfig({ A: str(), L: list(str()) }), { A: "x", L: "a,b" }, quiet);
    expect(() => {
      (config as { A: string }).A = "y";
    }).toThrow(TypeError);
    expect(() => (config.L as string[]).push("c")).toThrow(TypeError);
  });

  test("unknown_keys_warn", () => {
    const seen: string[][] = [];
    const config = loadConfig(
      defineConfig({ UNSET_KNOWN: str(), S: secretFile({ minBytes: 1 }) }),
      { UNSET_KNOWN: "x", UNSET_FOO: "1", S_FILE: tempFile("s", "v"), HOME: "/root" },
      { onUnknownKeys: (keys) => seen.push(keys) },
    );
    expect(config.UNSET_KNOWN).toBe("x");
    expect(seen).toEqual([["UNSET_FOO"]]);
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

  test("describe_config_has_no_values", () => {
    const schema = defineConfig({ A: str(), S: secretFile({ minBytes: 1 }) });
    const described = describeConfig(schema, { A: "visible-value", S_FILE: "/run/secrets/s" });
    expect(described).toEqual([
      { key: "A", kind: "str", set: true },
      { key: "S", kind: "secretFile", set: true },
    ]);
    expect(JSON.stringify(describeConfig(schema, {}))).toBe(
      '[{"key":"A","kind":"str","set":false},{"key":"S","kind":"secretFile","set":false}]',
    );
  });
});

describe("bootOrExit", () => {
  const boot = (env: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), "config-boot-"));
    dirs.push(dir);
    mkdirSync(dir, { recursive: true });
    const script = join(dir, "boot.ts");
    const index = join(import.meta.dirname, "index.ts");
    writeFileSync(
      script,
      `import { bootOrExit, defineConfig, secret, str } from ${JSON.stringify(index)};\n` +
        "bootOrExit(defineConfig({ NEEDED: str(), TOKEN: secret({ minBytes: 32 }) }));\n" +
        'process.stdout.write("booted");\n',
    );
    return spawnSync(process.execPath, [script], { env: { PATH: process.env.PATH, ...env }, encoding: "utf8" });
  };

  test("boot_exit_code", () => {
    const run = boot({ TOKEN: "leaky-short-token" });
    expect(run.status).toBe(78);
    expect(run.stdout).toBe("");
    const lines = run.stderr
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(lines).toEqual([
      { event: "config.invalid", key: "NEEDED", reason: "missing" },
      { event: "config.invalid", key: "TOKEN", reason: "invalid" },
    ]);
    expect(run.stderr).not.toContain("leaky-short-token");
  });

  test("boot_succeeds", () => {
    const run = boot({ NEEDED: "x", TOKEN: SECRET_32 });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toBe("booted");
  });
});
