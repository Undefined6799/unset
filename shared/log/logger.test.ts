import { AppError } from "@unset/shared-errors";
import { describe, expect, test } from "vitest";
import { createLogger, type LogFields } from "./index.ts";

/** A logger writing into an array, with a fixed clock. */
function capture(env: "dev" | "test" | "prod" = "test") {
  const lines: string[] = [];
  const log = createLogger({
    service: "http",
    commit: "a".repeat(40),
    env,
    write: (line) => lines.push(line),
    now: () => new Date("2026-10-04T00:00:00Z"),
  });
  const records = (): Record<string, unknown>[] => lines.map((l) => JSON.parse(l) as Record<string, unknown>);
  return { log, lines, records };
}

describe("logger", () => {
  test("logger_line_shape", () => {
    const { log, lines, records } = capture();
    log.info("config.unknown_keys", { count: 2 });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.endsWith("\n")).toBe(true);
    expect(records()).toEqual([
      {
        ts: "2026-10-04T00:00:00.000Z",
        level: "info",
        svc: "http",
        commit: "a".repeat(40),
        event: "config.unknown_keys",
        count: 2,
      },
    ]);
  });

  test("logger_drops_unlisted", () => {
    const { log, records } = capture();
    log.warn("config.unknown_keys", { ip: "1.2.3.4", ua: "Mozilla/5.0", path: "/@alice" } as unknown as LogFields);
    const [record] = records();
    expect(record).not.toHaveProperty("ip");
    expect(record).not.toHaveProperty("ua");
    expect(record).not.toHaveProperty("path");
    expect(record?.dropped).toBe(3);
  });

  test("logger_drops_non_primitive_values", () => {
    const { log, records } = capture();
    log.info("config.unknown_keys", { reason: { nested: "1.2.3.4" } } as unknown as LogFields);
    expect(records()[0]).toMatchObject({ dropped: 1 });
    expect(records()[0]).not.toHaveProperty("reason");
  });

  test.each([
    ["ipv4", "from 10.0.0.1 today"],
    ["ipv6 with zone", "peer 2001:db8::1%eth0"],
    ["ipv6 compressed", "::1"],
    ["email", "mail a@b.c now"],
    ["jwt", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl"],
    ["bearer", "Bearer abc"],
    ["hex run", "f".repeat(64)],
    ["base64url run", "Ab-_".repeat(10)],
    ["did:key", `did:key:z${"6Mk".repeat(15)}`],
  ])("logger_scrubs_values %s", (_kind, value) => {
    const { log, lines } = capture();
    log.info("config.unknown_keys", { reason: value });
    expect(lines[0]).toContain("[redacted]");
    const secretPart = value.replace(/^(from|peer|mail|Bearer) /, "").replace(/ (today|now)$/, "");
    expect(lines[0]).not.toContain(secretPart);
  });

  test("logger_truncates_and_strips_control_characters", () => {
    const { log, lines, records } = capture();
    log.info("config.unknown_keys", { reason: `a\nb\u0000c\u0085d${"x ".repeat(200)}` });
    expect(lines[0]?.split("\n")).toHaveLength(2); // the line and the empty string after its final newline
    const reason = String(records()[0]?.reason);
    expect(reason.startsWith("a?b?c?d")).toBe(true);
    expect(reason.length).toBe(200);
  });

  test("logger_one_line", () => {
    const { log, lines } = capture();
    log.error("error", { reason: "line one\nline two" });
    expect(lines[0]?.trimEnd().includes("\n")).toBe(false);
  });

  test("logger_route_template_only", () => {
    const { log, records } = capture();
    log.info("config.unknown_keys", { route: "/@:handle" });
    log.info("config.unknown_keys", { route: "/search?q=alice" });
    expect(records().map((r) => r.route)).toEqual(["/@:handle", "[route]"]);
  });

  test("logger_unknown_event", () => {
    const { log, records } = capture();
    log.info("user.did:plc:abcdefghijklmnopqrstuvwx logged in" as never);
    const [record] = records();
    expect(record?.event).toBe("log.unknown_event");
    expect(Array.from(String(record?.kind)).length).toBeLessThanOrEqual(40);
    expect(String(record?.kind)).not.toContain("did:plc");
  });

  test("logger_http_kit_events", () => {
    // P1.04k's server kit logs these; each must keep its own name rather than read as log.unknown_event.
    const { log, records } = capture();
    const events = ["http.request", "http.deadline", "http.late_result", "http.listen_failed", "http.drain"] as const;
    for (const event of events) log.info(event, { route: "/@:handle", method: "GET", status: 200, ms: 3 });
    expect(records().map((r) => r.event)).toEqual([...events]);
  });

  test("logger_trusted_proxy_event", () => {
    // P1.05's trusted proxy logs this, without an address, when a request did not come from the edge.
    const { log, records } = capture();
    log.warn("proxy.untrusted_peer");
    expect(records().map((r) => r.event)).toEqual(["proxy.untrusted_peer"]);
  });

  test("logger_rate_limit_events", () => {
    // P1.06's rate limiter logs these when it denies by failing closed: no session for a per-DID limit, or an error.
    const { log, records } = capture();
    log.error("ratelimit.no_session", { route: "/follow" });
    log.error("ratelimit.error", { reason: "bucket" });
    expect(records().map((r) => r.event)).toEqual(["ratelimit.no_session", "ratelimit.error"]);
  });

  test("logger_no_stack_message_in_prod", () => {
    const { log, lines } = capture("prod");
    log.logError(new Error("secret value"));
    expect(lines.join("")).not.toContain("secret value");
    expect(lines.join("")).not.toContain("stack");
    const dev = capture("dev");
    dev.log.logError(new AppError("csrf.denied", { cause: new Error("secret value") }));
    const [record] = dev.records();
    expect(record).toMatchObject({ event: "error", code: "csrf.denied", kind: "AppError" });
    expect(String(record?.stack)).toMatch(/logger\.test\.ts:\d+/);
    expect(dev.lines.join("")).not.toContain("secret value");
  });

  test("logger_survives_epipe", () => {
    const log = createLogger({
      service: "http",
      commit: "a".repeat(40),
      env: "prod",
      write: () => {
        throw Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
      },
    });
    expect(() => log.info("config.unknown_keys")).not.toThrow();
  });
});
