// Review-found leaks and crashes (P1.03): each case here was a real input that got through or took the logger down.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { createLogger, type LogFields } from "./index.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function capture(env: "dev" | "test" | "prod" = "test") {
  const lines: string[] = [];
  const log = createLogger({ service: "http", commit: "a".repeat(40), env, write: (line) => lines.push(line) });
  const records = (): Record<string, unknown>[] => lines.map((l) => JSON.parse(l) as Record<string, unknown>);
  return { log, lines, records };
}

const reasonOf = (value: string): string => {
  const { log, records } = capture();
  log.info("config.unknown_keys", { reason: value });
  return String(records()[0]?.reason);
};

describe("logger hardening", () => {
  test("logger_survives_closed_pipe", () => {
    const dir = mkdtempSync(join(tmpdir(), "logger-pipe-"));
    dirs.push(dir);
    const script = join(dir, "flood.ts");
    writeFileSync(
      script,
      `import { createLogger } from ${JSON.stringify(join(import.meta.dirname, "index.ts"))};\n` +
        'const log = createLogger({ service: "http", commit: "a".repeat(40), env: "prod" });\n' +
        'for (let i = 0; i < 20000; i += 1) log.info("config.unknown_keys", { count: i });\n' +
        'setTimeout(() => process.stderr.write("survived"), 50);\n',
    );
    const run = spawnSync("sh", ["-c", `"${process.execPath}" "${script}" | head -c 10 > /dev/null`], {
      encoding: "utf8",
    });
    expect(run.stderr).not.toContain("Unhandled");
    expect(run.stderr).toContain("survived");
  });

  test.each([
    ["did:plc", "user did:plc:ewvi7nxzyoun6zhxrhs64oiz"],
    ["did:web", "user did:web:alice.example.com"],
    ["ipv4 next to a word", "client_10.0.0.1"],
    ["ipv4 after a letter", "v192.168.1.1x"],
    ["basic credentials", "Basic dXNlcjpwYXNz"],
  ])("logger_scrubs_more_shapes %s", (_kind, value) => {
    const reason = reasonOf(value);
    expect(reason).toContain("[redacted]");
    expect(reason).not.toMatch(/did:|10\.0\.0\.1|192\.168|dXNlcjpwYXNz/);
  });

  test("logger_keeps_harmless_colons", () => {
    expect(reasonOf("time 12:30:45")).toBe("time 12:30:45");
  });

  test("logger_scrubs_before_truncating", () => {
    const reason = reasonOf(`${"x".repeat(185)}192.168.100.200`);
    expect(reason).not.toContain("192.16");
    expect(reasonOf("‮evil")).toBe("?evil");
  });

  test("logger_route_rejects_raw_paths", () => {
    const { log, records } = capture();
    const routes = [
      "/@alice.bsky.social",
      "/profile/did:plc:abc",
      "/u/10.0.0.1",
      `/reset/${"a1".repeat(20)}`,
      "/Login",
    ];
    for (const route of routes) log.info("config.unknown_keys", { route });
    for (const route of ["/", "/@:handle", "/settings/:section", "/.well-known/*"])
      log.info("config.unknown_keys", { route });
    expect(records().map((r) => r.route)).toEqual([
      ...routes.map(() => "[route]"),
      "/",
      "/@:handle",
      "/settings/:section",
      "/.well-known/*",
    ]);
  });

  test("logger_request_id_kept_or_refused", () => {
    const { log, records } = capture();
    const uuid = "0b6f1e4a-9c1d-4a8e-8f3b-2d7c5e9a1b04";
    log.info("config.unknown_keys", { reqId: uuid });
    log.info("config.unknown_keys", { reqId: "from 10.0.0.1" });
    expect(records().map((r) => r.reqId)).toEqual([uuid, "[reqId]"]);
  });

  test("logger_stack_frames_bounded_and_scrubbed", () => {
    const { log, records } = capture("dev");
    const error = new Error("x");
    error.stack = `Error: x\n    at evil (/home/u/did:plc:abc/10.0.0.1:1:1)\n${"    at f (/a.ts:1:1)\n".repeat(500)}`;
    log.logError(error);
    const stack = String(records()[0]?.stack);
    expect(stack).not.toMatch(/did:plc|10\.0\.0\.1/);
    expect(stack.split(" ")).toHaveLength(10);
  });

  test("logger_never_throws", () => {
    const { log, records } = capture("dev");
    const throwingGetter = Object.defineProperty({}, "reason", {
      enumerable: true,
      get: () => {
        throw new Error("boom");
      },
    });
    const throwingProxy = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error("boom");
        },
      },
    );
    expect(() => log.info("config.unknown_keys", throwingGetter as LogFields)).not.toThrow();
    expect(() => log.info("config.unknown_keys", throwingProxy as LogFields)).not.toThrow();
    const badStack = Object.assign(new Error("x"), { stack: 5 });
    expect(() => log.logError(badStack)).not.toThrow();
    const badName = Object.defineProperty(new Error("x"), "name", {
      get: () => {
        throw new Error("boom");
      },
    });
    expect(() => log.logError(badName)).not.toThrow();
    expect(records().map((r) => r.event)).toEqual([
      "log.serialize_failed",
      "log.serialize_failed",
      "error",
      "log.serialize_failed",
    ]);
  });
});
